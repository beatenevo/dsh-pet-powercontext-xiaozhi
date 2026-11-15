/**
 * Standalone mode model transport layer: encapsulates streaming calls of OpenAI compatible and Anthropic protocols.
 *
 * It is not responsible for setting validation and rate limiting (see ai-provider), nor is it responsible for
 * selecting models. Must always be true: requests can only be sent to the endpoint inferred from the configuration;
 * the authentication header is reconstructed by this layer and never relies on credentials inferred by SDK from the
 * environment or configuration directory.
 * @module dsh-pet/src/standalone/ai-transport
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { StandaloneAiSettings } from './ai-config.ts';
import { BUILTIN_SERVICES, sameEndpoint } from './services.ts';
import { tokenCount, type ReportedTokenUsage } from '../shared/token-usage.ts';

/** The shape of fetch is convenient for testing and replacement. */
export type AiFetch = typeof globalThis.fetch;
/** A plain text message. */
export interface AiTextMessage {
  role: 'user' | 'assistant';
  content: string;
}
/** System prompts and message sequence for a request. */
export interface AiRequest {
  system: string;
  messages: AiTextMessage[];
}
/** Transfer event: text, refusal, or usage reported by the provider. */
export type AiTransportEvent = { text?: string; refusal?: boolean; usage?: ReportedTokenUsage };
/** Silence logger for SDK to avoid writing request details to the log. */
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** 会话 ID：进程内只生成一次，保证同一家服务商的每个请求都带同一个值。 */
let sessionId: string | undefined;

/**
 * 目标地址要求的额外请求头。
 *
 * 只有名录里声明了 `sessionHeader` 的服务商才会带；opencode Go 缺这个头会 400（无法路由）。
 * @param baseUrl - 本次请求的地址。
 * @returns 需要附加的头；不需要时为空对象。
 */
export function serviceHeaders(baseUrl: string): Record<string, string> {
  // 先按整条地址匹配；用户手改过路径（比如换成 zen 地址）时，同源也算命中——
  // 这个头是 opencode 侧的入口要求，跟具体路径无关。
  const def = BUILTIN_SERVICES.find((entry) => {
    if (!entry.sessionHeader) return false;
    if (sameEndpoint(baseUrl, entry.baseUrl)) return true;
    try {
      return new URL(baseUrl).origin === new URL(entry.baseUrl).origin;
    } catch {
      return false;
    }
  });
  if (!def?.sessionHeader) return {};
  sessionId ??= randomUUID();
  return { [def.sessionHeader]: sessionId };
}

/**
 * Reconstruct fetch wrapper of request target and authentication header.
 * @param settings - off-the-shelf configuration.
 * @param fetcher - underlying fetch.
 * @returns is only allowed to configure the endpoint through fetch .
 */
export function isolatedFetch(settings: Readonly<StandaloneAiSettings>, fetcher: AiFetch): AiFetch {
  // The endpoint is deduced from the configuration. The address spelled out by SDK must be hit one by one, otherwise it will be rejected.
  const base = settings.baseUrl.replace(/\/+$/, '');
  const expected = base + (settings.protocol === 'anthropic' ? '/v1/messages' : '/chat/completions');
  return async (url, init) => {
    const beta =
      settings.protocol === 'anthropic' &&
      new URL(base).origin === 'https://api.anthropic.com' &&
      settings.model === 'claude-opus-5-5';
    const urlStr = String(url);
    const validOpenAi =
      settings.protocol === 'openai-compatible' &&
      (urlStr === expected || urlStr === base + '/chat/completions' || urlStr === base + '/v1/chat/completions');
    const validAnthropic =
      settings.protocol === 'anthropic' &&
      (urlStr === expected + (beta ? '?beta=true' : '') ||
        urlStr === base + '/messages' ||
        urlStr === base + '/v1/messages' + (beta ? '?beta=true' : ''));
    if (!validOpenAi && !validAnthropic) throw new Error('Unexpected standalone AI endpoint.');
    // All headers are reconstructed by this layer: SDK may inherit custom authentication headers from the environment even if an explicit key has been given.
    // 服务商要求的会话头也在这里补上，缺它会被直接判 400。
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json',
      ...serviceHeaders(base),
    });
    if (settings.protocol === 'anthropic') {
      headers.set('x-api-key', settings.apiKey);
      headers.set('anthropic-version', '2023-06-01');
      if (new URL(base).origin === 'https://api.anthropic.com' && settings.model === 'claude-opus-5-5') {
        // Server-side fallback beta is enabled only for first-party Opus, third-party endpoints should not receive this header.
        headers.set('anthropic-beta', 'server-side-fallback-2026-07-01');
      }
    } else headers.set('authorization', `Bearer ${settings.apiKey}`);
    return fetcher(url, { method: 'POST', body: init?.body, headers, signal: init?.signal, redirect: 'error' });
  };
}

/**
 * Call the official SDK according to the protocol, and output text increment and rejection events.
 * @param settings - off-the-shelf configuration.
 * @param request - Normalized request.
 * @param signal - Cancel signal.
 * @param fetcher - underlying fetch.
 * @returns Asynchronous sequence of text increments.
 * Thrown when the @throws endpoint does not match or the SDK call fails.
 */
export async function* sdkTextStream(
  settings: Readonly<StandaloneAiSettings>,
  request: AiRequest,
  signal: AbortSignal,
  fetcher: AiFetch,
): AsyncIterable<AiTransportEvent> {
  // SDK’s built-in retries and logs will bypass the boundary control of this layer and be turned off.
  const shared = {
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    maxRetries: 0,
    timeout: settings.timeoutMs,
    fetch: isolatedFetch(settings, fetcher),
    logger: quiet,
    logLevel: 'off' as const,
  };
  if (settings.protocol === 'openai-compatible') {
    const client = new OpenAI({ ...shared, organization: null, project: null, webhookSecret: null });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages,
    ];
    const stream = await client.chat.completions.create(
      {
        model: settings.model,
        messages,
        stream: true,
        max_tokens: settings.maxTokens,
        n: 1,
      },
      { signal },
    );
    for await (const event of stream) {
      const delta = event.choices.find((choice) => choice.index === 0)?.delta;
      if (delta?.refusal) yield { refusal: true };
      if (delta?.content) yield { text: delta.content };
      if (event.usage) {
        const totalInput = tokenCount(event.usage.prompt_tokens);
        const read = tokenCount(
          event.usage.prompt_tokens_details?.cached_tokens ??
            (event.usage as unknown as Record<string, unknown>).prompt_cache_hit_tokens,
        );
        const output = tokenCount(event.usage.completion_tokens);
        yield {
          usage: {
            ...(totalInput !== undefined && (read === undefined || read <= totalInput)
              ? { inputTokens: totalInput - (read ?? 0) }
              : {}),
            ...(read !== undefined ? { cacheReadTokens: read } : {}),
            ...(output !== undefined ? { outputTokens: output } : {}),
          },
        };
      }
    }
    return;
  }
  // Explicitly blanking authToken blocks SDK from resolving credentials from the environment, OAuth, or configuration directories.
  const client = new Anthropic({ ...shared, authToken: null, webhookKey: null });
  const opus = settings.model === 'claude-opus-5-5';
  const firstParty = new URL(settings.baseUrl).origin === 'https://api.anthropic.com';
  const parameters = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: request.system,
    messages: request.messages,
    stream: true as const,
    ...(opus ? { thinking: { type: 'adaptive' as const }, output_config: { effort: 'low' as const } } : {}),
  };
  const stream =
    opus && firstParty
      ? await client.beta.messages.create(
          { ...parameters, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : await client.messages.create(parameters, { signal });
  const usage: ReportedTokenUsage = {};
  for await (const event of stream) {
    if (event.type === 'message_start') {
      usage.inputTokens = tokenCount(event.message?.usage?.input_tokens);
      usage.cacheReadTokens = tokenCount(event.message?.usage?.cache_read_input_tokens);
      usage.cacheWriteTokens = tokenCount(event.message?.usage?.cache_creation_input_tokens);
    }
    if (event.type === 'message_delta') usage.outputTokens = tokenCount(event.usage?.output_tokens);
    if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') yield { refusal: true };
    // Only forward incremental text: Repeated forwarding of accumulated content and thinking blocks will cause the caller to get duplicate text.
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { text: event.delta.text };
  }
  if (Object.values(usage).some((value) => value !== undefined)) yield { usage };
}

/** Determine whether authentication failed. */
export function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  );
}
/** Determining whether rate limiting failed. */
export function isRateLimitFailure(error: unknown): boolean {
  return error instanceof OpenAI.RateLimitError || error instanceof Anthropic.RateLimitError;
}
