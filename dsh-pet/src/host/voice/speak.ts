/**
 * 语音服务：校验输入、解析音色、串行排队、查缓存、调实现，把结果收敛成「文件路径或失败原因」。
 *
 * 队列放在这里而不是路由里：并发上限是资源约束，与 HTTP 无关。串行保证同一时刻只有一条
 * 上游连接，也保证先点先响——并发合成会让顺序不可预测。
 * 不负责把音频交给客户端：那是路由与 bridge 的事。
 * @module dsh-pet/src/host/voice/speak
 */
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import { FORMAT_INFO, cacheKey, cachePath, ensureCacheDir, pruneCache } from './cache.ts';
import { listCatalog, resolveVoice } from './registry.ts';
import { DEFAULT_PROVIDER_TIMEOUT_MS, type ResolvedVoice, type VoiceCatalog, type VoiceFormat } from './types.ts';

/** The maximum text length allowed in a single request (character, in UTF-16). */
export const MAX_TEXT_CHARS = 500;
/** The upper limit of the synthesis queued at the same time (including the running one); if it is exceeded, it will be directly rejected and there will be no infinite accumulation. */
export const MAX_QUEUE = 3;

/** Speech rate expression: `+N%` or `-N%`. */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** Lower bound of speaking speed (percentage). */
const RATE_MIN_PERCENT = -50;
/** Upper limit of speaking speed (percentage). */
const RATE_MAX_PERCENT = 100;
/** 排队超过这么久还没轮到就丢弃（ms）：比客户端等合成结果的上限（30s）略短，超了它早已放弃。 */
const STALE_WAIT_MS = 28_000;

/** Input to a synthesis (verified). */
interface SpeakInput {
  readonly text: string;
  readonly voice?: string;
  readonly rate: number;
}

/** Reason for failure; route layer is mapped to reason of `result.ts` as it is. */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';

/** 合成结果：成功时给出最终音频的绝对路径与应答 MIME。 */
export type SpeakResult =
  { ok: true; file: string; contentType: string } | { ok: false; reason: SpeakFailure; message: string };

/** Voice service: The route layer only relies on these two methods. */
export interface VoiceService {
  /** 合成一段文本；同一输入命中缓存时不再调用实现。 */
  speak(raw: unknown): Promise<SpeakResult>;
  /** 当前音色目录（由注册表提供）。 */
  list(): VoiceCatalog;
}

/** Analysis conclusion: Verified input will be given if successful, and an explanation will be given directly back to the caller if failed. */
type ParseResult = { ok: true; value: SpeakInput } | { ok: false; message: string };

/** 一次请求解析完毕后的结果：要么能合成，要么已经是可直接回给调用方的失败。 */
type PreparedCall =
  | {
      ok: true;
      text: string;
      rate: number;
      resolved: ResolvedVoice;
      format: VoiceFormat;
      target: string;
      contentType: string;
    }
  | { ok: false; result: SpeakResult };

/** Verify the request body; only recognize the three fields `text` / `voice` / `rate`, and ignore the rest. */
function parseSpeakInput(raw: unknown): ParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, message: `text too long (max ${MAX_TEXT_CHARS} chars)` };
  // 音色的存在性不在这一层判：它只在注册表里有答案，这里只管类型。
  const voice = body.voice;
  if (voice !== undefined && typeof voice !== 'string') {
    return { ok: false, message: 'voice must be a string' };
  }
  const rate = body.rate === undefined ? '+0%' : body.rate;
  if (typeof rate !== 'string' || !RATE_PATTERN.test(rate)) {
    return { ok: false, message: 'rate must look like +0% or -10%' };
  }
  const percent = Number(rate.slice(0, -1));
  if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) {
    return { ok: false, message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)` };
  }
  // `-0%` 与 `+0%` 是同一个语义：归一成正零，免得 -0 一路传到实现与日志里
  const ratePercent = percent === 0 ? 0 : percent;
  return { ok: true, value: { text, rate: ratePercent, ...(voice === undefined ? {} : { voice }) } };
}

/** 断言用：丢弃分支只经这里构造，避免各处手写同一句文案。 */
function dropped(): SpeakResult {
  return { ok: false, reason: 'voice-busy', message: 'queued too long, dropped' };
}

/**
 * Have you waited too long in this queue?
 *
 * 等得比客户端愿意等的还久，那边早已超时放弃：再合成只是白烧上游，
 * 而且声音出来时说的已经是上一件事。
 *
 * @param queuedMs - Time to join the team.
 * @param nowMs - The moment when it's your turn.
 * @param waitMs - the maximum allowed queuing time; the default is {@link STALE_WAIT_MS} , test injecting shorter
 * values.
 * @returns should be discarded as true .
 * @internal
 */
export function isQueueStale(queuedMs: number, nowMs: number, waitMs: number = STALE_WAIT_MS): boolean {
  return nowMs - queuedMs > waitMs;
}

/** 给一个 Promise 套超时；超时 reject，原 Promise 不被取消（实现自己该处理放弃）。 */
function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('voice provider timed out')), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 先写 `<target>.part` 再改名：`target` 一旦出现就是完整文件。
 *
 * 不这样做的话，写盘中途失败会留下非空半截文件，而缓存命中只判「文件存在且非空」，
 * 那半截音频会被当成有效结果一直命中。
 */
async function writeAtomically(target: string, bytes: Uint8Array): Promise<void> {
  const staging = `${target}.part`;
  try {
    await writeFile(staging, bytes);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Create voice service. */
export function createVoiceService(options: {
  /** User data root; cache falls at `<userRoot>/voice-cache/`. */
  userRoot: string;
  /** Used to leave traces; if not passed, it will be silent. Only the character count and results are recorded, not the text (user content is not entered into the log). */
  log?: { info?(message: string): void; warn?(message: string): void };
  /** 请求没带 `voice` 时用的音色；缺省视为没有配置。 */
  configuredVoice?: () => string | undefined;
  /** The maximum allowed queuing time (ms); the default is {@link STALE_WAIT_MS}, which is used for testing to force out the discard branch. */
  staleWaitMs?: number;
}): VoiceService {
  const { userRoot, log, configuredVoice } = options;
  const staleWaitMs = options.staleWaitMs ?? STALE_WAIT_MS;
  /** The occupied queue quota (including the one currently running). */
  let queueUsed = 0;
  /** Serial chain: After the previous thing cleanup (success or failure), it is the turn of the next thing. */
  let chain: Promise<void> = Promise.resolve();

  /** Queue a synthesis into the serial chain; release the quota regardless of success or failure. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queueUsed += 1;
    const run = chain.then(task, task);
    // The chain itself cannot contain rejections, otherwise subsequent tasks will inherit the same failure; rejections are only given to this caller.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      queueUsed -= 1;
    });
  }

  /** Cache hit returns file path; non-existent or empty file returns undefined. */
  async function findCached(target: string): Promise<string | undefined> {
    try {
      const info = await stat(target);
      return info.isFile() && info.size > 0 ? target : undefined;
    } catch {
      return undefined;
    }
  }

  /** 校验请求、解析音色、算出落盘目标；任何一步不成立都直接给出可回给调用方的结论。 */
  function prepareCall(raw: unknown): PreparedCall {
    const parsed = parseSpeakInput(raw);
    if (!parsed.ok) return { ok: false, result: { ok: false, reason: 'bad-request', message: parsed.message } };
    const { text, rate } = parsed.value;
    // 唯一的「默认」来源：调用方显式给的，或者用户配置里那个值。查不到就是查不到，不替他挑。
    const limitedId = parsed.value.voice ?? configuredVoice?.();
    if (!limitedId) return { ok: false, result: { ok: false, reason: 'bad-request', message: 'voice is required' } };
    const resolved = resolveVoice(limitedId);
    if (!resolved) {
      return { ok: false, result: { ok: false, reason: 'bad-request', message: `voice not found: ${limitedId}` } };
    }
    const format = resolved.provider.format ?? 'mp3';
    return {
      ok: true,
      text,
      rate,
      resolved,
      format,
      target: cachePath(userRoot, cacheKey(limitedId, rate, text), format),
      contentType: FORMAT_INFO[format].mime,
    };
  }

  /** 排队、合成、原子落盘；失败已归一成结论，不向外抛。 */
  async function runSynthesis(call: Extract<PreparedCall, { ok: true }>): Promise<SpeakResult> {
    const { text, rate, resolved, target } = call;
    const { provider, voice } = resolved;
    const queue = { dropped: false };
    const queuedMs = Date.now();
    const startedMs = queuedMs;
    try {
      await enqueue(async () => {
        if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
          queue.dropped = true;
          return;
        }
        const dir = await ensureCacheDir(userRoot);
        const timeoutMs = provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
        // signal 让实现能提前收手；withTimeout 兜住「它根本不理这个 signal」的情况
        const bytes = await withTimeout(
          provider.synthesize({ text, voice: voice.id, rate, signal: AbortSignal.timeout(timeoutMs) }),
          timeoutMs,
        );
        // 空字节按失败处理：0 字节文件会被缓存命中逻辑反复重合成，白烧上游
        if (bytes.length === 0) throw new Error('voice provider returned empty audio');
        await writeAtomically(target, bytes);
        // Elimination is placed after success: on failure, you should not delete the still usable cache to make room.
        await pruneCache(dir);
      });
    } catch (error) {
      // Upstream details (including URL and status code) are not leaked and are only kept in the log.
      log?.warn?.(
        `[dsh-pet] voice speak: failed chars=${text.length} voice=${resolved.limitedId} ` +
          `ms=${Date.now() - startedMs} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
    if (queue.dropped) {
      log?.warn?.(
        `[dsh-pet] voice speak: dropped chars=${text.length} voice=${resolved.limitedId} ` +
          `queued=${Date.now() - queuedMs}ms`,
      );
      return dropped();
    }
    log?.info?.(
      `[dsh-pet] voice speak: cache=miss chars=${text.length} voice=${resolved.limitedId} ` +
        `ms=${Date.now() - startedMs}`,
    );
    return { ok: true, file: target, contentType: call.contentType };
  }

  async function speak(raw: unknown): Promise<SpeakResult> {
    const call = prepareCall(raw);
    if (!call.ok) return call.result;

    const cached = await findCached(call.target);
    if (cached) {
      log?.info?.(`[dsh-pet] voice speak: cache=hit chars=${call.text.length} voice=${call.resolved.limitedId}`);
      return { ok: true, file: cached, contentType: call.contentType };
    }
    if (queueUsed >= MAX_QUEUE) {
      log?.warn?.(
        `[dsh-pet] voice speak: queue full (max ${MAX_QUEUE}) chars=${call.text.length} ` +
          `voice=${call.resolved.limitedId}`,
      );
      return { ok: false, reason: 'voice-busy', message: 'voice queue is full, retry later' };
    }
    return runSynthesis(call);
  }

  return { list: listCatalog, speak };
}
