/**
 * Own the optional robot connection, one-shot motion authorization and command receipts.
 * Calls never retry automatically; losing a result consumes authorization and leaves an unknown receipt.
 * Cancelling a wait never establishes physical stop. Host restart always disarms control.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPrivateJson, writePrivateJson } from '../../standalone/ai-storage.ts';
import type { RobotChatSpeech, RobotPendingAction, RobotResult, RobotSnapshot } from '../../shared/robot.ts';
import type { RobotChatContext } from './chat.ts';
import { defaultRobotConfig, robotConfigSchema, robotRequestSchema, type RobotRequest } from './config.ts';
import { readRobotJournal, writeRobotJournal, type RobotReceipt } from './journal.ts';
import { runRobotWorker, type RobotRunner, type RobotCall } from './worker.ts';
import type { PetObservability } from '../observability/service.ts';
import type { PollStateStore } from '../state.ts';

/** Pet feedback is best-effort and never changes the recorded physical command result. */
export interface RobotFeedback {
  petId: string;
  text: string;
  animation?: string;
}

/** Controller lifecycle and user operations shared by both host modes. */
export interface RobotService {
  snapshot(): RobotSnapshot;
  submit(input: unknown): Promise<RobotSnapshot>;
  beginChat(petId: string): RobotChatContext | undefined;
  completeChat(context: RobotChatContext, reply: { text: string; actionKey?: string }): void;
  dispose(): Promise<void>;
}

/** Create a controller with an injectable MCP transport; no movement is sent during construction. */
export function createRobotService(options: {
  userRoot: string;
  state: PollStateStore;
  observability?: PetObservability;
  run?: RobotRunner;
  feedback?: (event: RobotFeedback) => Promise<void>;
  now?: () => number;
  monitor?: boolean;
}): RobotService {
  const transport = options.run ?? runRobotWorker;
  const run: RobotRunner = (config, call, signal) => {
    if (!options.observability || call.operation === 'status') return transport(config, call, signal);
    return options.observability.run(`robot.${call.operation}`, async () => {
      const result = await transport(config, call, signal);
      options.observability?.fields({ 'dsh_pet.robot.evidence': 'worker_result' });
      return result;
    });
  };
  const now = options.now ?? Date.now;
  const configFile = join(options.userRoot, 'astra-robot.json');
  const journalFile = join(options.userRoot, 'astra-commands.json');
  let config = defaultRobotConfig();
  let receipts: RobotReceipt[] = [];
  let storageError = false;
  let error = '';
  try {
    const saved = readPrivateJson(configFile);
    if (saved !== undefined) {
      if (typeof saved === 'object' && saved !== null && 'python' in saved) {
        // SDK 动作 ID 与示教程序主键不兼容，不能自动转换并继续执行。
        error = 'robot_mcp_setup_required';
      } else config = robotConfigSchema.parse(saved);
    }
    receipts = readRobotJournal(journalFile);
  } catch {
    storageError = true;
    error = 'robot_storage_unavailable';
  }
  let session = randomUUID();
  let armed = false;
  let disposed = false;
  let active: { receipt: RobotReceipt; abort: AbortController } | undefined;
  let checking = false;
  let stopping = false;
  let checkedAt = 0;
  let connected = false;
  let telemetry: RobotSnapshot['telemetry'];
  let catalog: RobotSnapshot['catalog'];
  let stopResult: RobotResult | undefined;
  let stopOperation: Promise<RobotResult> | undefined;
  let statusAbort: AbortController | undefined;
  let statusOperation: Promise<void> | undefined;
  let previousStatus: string | undefined;
  let chatContext: RobotChatContext | undefined;
  let chatCompleted = false;
  let pendingAction: RobotPendingAction | undefined;
  let chatSpeech: RobotChatSpeech | undefined;
  // Bound transient speech to 100 chunks (at most 50,000 UTF-16 code units), never persisted or replayed.
  const speechQueue: Array<{ id: string; petId: string; text: string; expiresAt: number }> = [];
  let speechEpoch = 0;
  let speechDraining = false;
  const cancelSpeech = (): void => {
    speechEpoch++;
    speechQueue.length = 0;
    if (chatSpeech?.state === 'checking' || chatSpeech?.state === 'queued')
      chatSpeech = { ...chatSpeech, state: 'skipped', reason: 'cancelled' };
  };
  const cancelChat = (): void => {
    chatContext = undefined;
    pendingAction = undefined;
  };
  const currentChat = (context: RobotChatContext): boolean =>
    !disposed && config.enabled && context.session === session && context.id === chatContext?.id;
  const notify = (event: RobotFeedback): void => {
    void Promise.resolve()
      .then(() => options.feedback?.(event))
      .catch(() => {});
  };
  const snapshot = (): RobotSnapshot => ({
    session,
    config: structuredClone(config),
    armed,
    busy: !!active,
    checking,
    stopping,
    checkedAt,
    connected: connected && now() - checkedAt < 15_000,
    telemetry,
    catalog,
    error,
    stopResult,
    pendingAction: pendingAction && pendingAction.expiresAt > now() ? { ...pendingAction } : undefined,
    chatSpeech: chatSpeech ? { ...chatSpeech } : undefined,
    commands: receipts.slice(-20).map((item) => ({
      id: item.id,
      kind: item.kind,
      key: item.key,
      petId: item.petId,
      state: item.state,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      message: item.message,
    })),
  });
  const persist = (): void => {
    try {
      writeRobotJournal(journalFile, receipts);
    } catch {
      storageError = true;
      armed = false;
      error = 'robot_storage_unavailable';
      throw new Error(error);
    }
  };
  const check = (): Promise<void> => {
    if (!config.enabled || stopping || disposed || storageError) return Promise.resolve();
    if (statusOperation) return statusOperation;
    checking = true;
    const abort = new AbortController();
    statusAbort = abort;
    // Share an in-flight monitor check with chat speech instead of dropping the reply as busy.
    statusOperation = Promise.resolve()
      .then(async () => {
        if (disposed || abort.signal.aborted) return;
        try {
          const result = await run(config, { operation: 'status' }, abort.signal);
          if (disposed || abort.signal.aborted) return;
          checkedAt = now();
          connected = result.ok;
          catalog = result.catalog;
          telemetry = result.telemetry;
          error = connected ? '' : result.code;
          if (
            !connected ||
            (telemetry && (telemetry.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1)))
          )
            armed = false;
          // Speech acknowledgements can change the free-form description. Only actual controller
          // state transitions create status bubbles; speech's own checks/receipts never feed TTS again.
          const status = connected && telemetry ? JSON.stringify([telemetry.actionCode, telemetry.modes]) : undefined;
          if (
            status &&
            previousStatus !== undefined &&
            status !== previousStatus &&
            !speechDraining &&
            active?.receipt.kind !== 'speak'
          )
            notify({ petId: config.petId, text: `Robot: ${telemetry!.description}` });
          previousStatus = status;
        } catch {
          connected = false;
          armed = false;
          error = 'robot_connection_failed';
        }
      })
      .finally(() => {
        checking = false;
        statusAbort = undefined;
        statusOperation = undefined;
      });
    return statusOperation;
  };
  const finish = async (
    item: RobotReceipt,
    call: RobotCall,
    abort: AbortController,
    automaticSpeech: boolean,
  ): Promise<void> => {
    let result: RobotResult;
    try {
      result = await run(config, call, abort.signal);
    } catch {
      result = { ok: false, code: 'transport_error', message: 'Execution state is unknown.' };
    }
    // A late successful response must not erase an operator stop or host shutdown.
    if (item.state === 'running') {
      item.state = result.ok
        ? 'reported-success'
        : result.code === 'rejected' || result.code === 'unsupported_tool' || result.code === 'invalid_target'
          ? 'failed'
          : 'unknown';
      item.message = result.message;
      item.finishedAt = now();
    }
    active = undefined;
    if (automaticSpeech && (chatSpeech?.id === item.id || chatSpeech?.state === 'queued'))
      chatSpeech = { id: item.id, petId: item.petId, state: item.state };
    // The old idle sample must not authorize another motion after a command returns.
    statusAbort?.abort();
    connected = false;
    try {
      persist();
    } catch {
      /* The storage fault blocks future commands. */
    }
    // Automatic speech receipts belong in the panel; they must not replace the pet's answer bubble.
    if (!disposed && !automaticSpeech)
      notify({ petId: item.petId, text: `Robot ${item.key}: ${item.state}. ${item.message}` });
    void drainSpeech();
  };
  const command = (
    request: Extract<RobotRequest, { action: 'execute' | 'speak' }>,
    automaticSpeech = false,
  ): Promise<void> => {
    if (storageError) throw new Error('robot_storage_unavailable');
    const action = request.action === 'execute' ? config.actions.find((item) => item.key === request.key) : undefined;
    if (request.action === 'execute' && !action) throw new Error('robot_unknown_action');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          kind: request.action,
          address: config.address,
          pet: request.petId,
          payload: request.action === 'speak' ? request.text : action && [action.tool, action.target],
        }),
      )
      .digest('hex');
    const existing = receipts.find((item) => item.id === request.id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('robot_request_conflict');
      return Promise.resolve();
    }
    if (active || stopping) throw new Error('robot_busy');
    if (!config.enabled || !snapshot().connected) throw new Error('robot_not_connected');
    if (request.action === 'execute' && !armed) throw new Error('robot_not_armed');
    if (
      request.action === 'execute' &&
      telemetry &&
      (telemetry.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1))
    )
      throw new Error('robot_not_ready');
    if (receipts.length >= 1000) throw new Error('robot_receipt_limit');
    armed = false;
    const item: RobotReceipt = {
      id: request.id,
      fingerprint,
      kind: request.action,
      key: action?.name ?? 'speech',
      petId: request.petId,
      state: 'running',
      startedAt: now(),
      message: '',
    };
    receipts.push(item);
    try {
      persist();
    } catch (cause) {
      item.state = 'failed';
      item.message = 'Receipt could not be saved; no command was sent.';
      item.finishedAt = now();
      throw cause;
    }
    const abort = new AbortController();
    statusAbort?.abort();
    connected = false;
    active = { receipt: item, abort };
    stopResult = undefined;
    const call: RobotCall =
      request.action === 'execute'
        ? { operation: 'execute', requestId: request.id, tool: action!.tool, target: action!.target }
        : { operation: 'speak', text: request.text };
    if (!automaticSpeech)
      notify({
        petId: request.petId,
        text: `Robot: ${item.key} requested.`,
        animation: action?.petAnimation || undefined,
      });
    return finish(item, call, abort, automaticSpeech);
  };
  const stop = async (): Promise<void> => {
    cancelChat();
    cancelSpeech();
    armed = false;
    if (stopping) return;
    if (!config.address) throw new Error('robot_address_required');
    stopping = true;
    statusAbort?.abort();
    if (active) {
      active.receipt.state = 'unknown';
      active.receipt.message = 'Local wait cancelled; robot may still be running. Verify on site.';
      active.receipt.finishedAt = now();
      active.abort.abort();
      try {
        persist();
      } catch {
        /* Storage failure must never prevent a stop request. */
      }
    }
    try {
      stopOperation = run(config, { operation: 'stop' });
      stopResult = await stopOperation;
    } catch {
      stopResult = {
        ok: false,
        code: 'stop_unconfirmed',
        message: 'Stop could not be confirmed. Check the robot locally.',
      };
    } finally {
      stopping = false;
      connected = false;
      stopOperation = undefined;
    }
    notify({ petId: config.petId, text: stopResult.message });
  };
  const drainSpeech = async (): Promise<void> => {
    if (speechDraining || active || stopping || disposed || storageError) return;
    speechDraining = true;
    const epoch = speechEpoch;
    try {
      while (speechQueue.length && epoch === speechEpoch && !active && !stopping && !disposed) {
        const item = speechQueue[0];
        const skip = (reason: RobotChatSpeech['reason']): void => {
          chatSpeech = { id: item.id, petId: item.petId, state: 'skipped', reason };
        };
        if (item.expiresAt <= now()) {
          speechQueue.shift();
          skip('expired');
          continue;
        }
        chatSpeech = { id: item.id, petId: item.petId, state: 'checking' };
        await check();
        if (epoch !== speechEpoch || disposed || !config.enabled || !config.chatSpeech) return;
        if (active || stopping) return;
        if (item.expiresAt <= now()) continue;
        if (!snapshot().connected) {
          speechQueue.length = 0;
          skip('offline');
          return;
        }
        speechQueue.shift();
        chatSpeech = { id: item.id, petId: item.petId, state: 'running' };
        try {
          await command(
            { action: 'speak', session, id: item.id, petId: item.petId, text: item.text, confirmed: true },
            true,
          );
        } catch {
          chatSpeech = { id: item.id, petId: item.petId, state: 'failed' };
          speechQueue.length = 0;
          return;
        }
        if (epoch !== speechEpoch) return;
        if (receipts.find((receipt) => receipt.id === item.id)?.state !== 'reported-success') {
          speechQueue.length = 0;
          return;
        }
      }
    } finally {
      speechDraining = false;
      // A stop can replace the queue while the previous check/worker is unwinding.
      if (speechQueue.length && !active && !stopping && !disposed && !storageError) void drainSpeech();
    }
  };
  const unsubscribe = options.state.onPetWrite((petId, leaf, data) => {
    if (leaf !== 'say' || !data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string')
      return;
    if (disposed || storageError || !config.enabled || !config.chatSpeech || config.petId !== petId || stopping) return;
    // Mirrored robot speech must not be sent back to the robot's speaker.
    if ('source' in data && data.source === 'robot-input') return;
    const text = data.text.trim();
    if (!text || ('clear' in data && data.clear === true)) return;
    const id = randomUUID();
    if (text.length > 50_000) {
      chatSpeech = { id, petId, state: 'skipped', reason: 'too_long' };
      return;
    }
    const chunks: string[] = [];
    let chunk = '';
    // Code-point iteration avoids splitting a UTF-16 surrogate pair at the configured 500-unit chunk limit.
    for (const point of text) {
      if (chunk.length + point.length > 500) {
        chunks.push(chunk);
        chunk = '';
      }
      chunk += point;
    }
    if (chunk) chunks.push(chunk);
    if (speechQueue.length + chunks.length > 100) {
      chatSpeech = { id, petId, state: 'skipped', reason: 'queue_full' };
      return;
    }
    speechQueue.push(
      ...chunks.map((text, index) => ({
        id: index === 0 ? id : randomUUID(),
        petId,
        text,
        expiresAt: now() + 120_000,
      })),
    );
    chatSpeech = { id, petId, state: 'queued' };
    void drainSpeech();
  });
  const confirmChatAction = async (id: string): Promise<void> => {
    const proposal = pendingAction;
    if (!proposal || proposal.id !== id || proposal.expiresAt <= now()) throw new Error('robot_proposal_expired');
    if (!config.enabled || !config.chatActions) throw new Error('robot_chat_disabled');
    if (active || stopping || checking) throw new Error('robot_busy');
    // Confirmation is bound to this proposal and a new status sample, never to a previous generic arm.
    await check();
    if (disposed || pendingAction !== proposal || proposal.expiresAt <= now())
      throw new Error('robot_proposal_expired');
    if (
      active ||
      stopping ||
      !snapshot().connected ||
      (telemetry && (telemetry.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1)))
    )
      throw new Error('robot_not_ready');
    armed = true;
    try {
      command({
        action: 'execute',
        session,
        id: proposal.id,
        key: proposal.key,
        petId: proposal.petId,
        confirmed: true,
      });
      cancelChat();
    } finally {
      armed = false;
    }
  };
  const timer = options.monitor === false ? undefined : setInterval(() => void check(), 5000);
  timer?.unref();
  return {
    snapshot,
    beginChat(petId) {
      if (
        disposed ||
        storageError ||
        !config.enabled ||
        config.petId !== petId ||
        (!config.chatSpeech && !config.chatActions)
      )
        return;
      cancelChat();
      armed = false;
      chatCompleted = false;
      chatContext = {
        id: randomUUID(),
        session,
        petId,
        actions: config.chatActions ? config.actions.map(({ key, name }) => ({ key, name })) : [],
      };
      return structuredClone(chatContext);
    },
    completeChat(context, reply) {
      if (!currentChat(context) || storageError || chatCompleted) return;
      chatCompleted = true;
      const action = config.chatActions && config.actions.find((item) => item.key === reply.actionKey);
      if (action)
        pendingAction = {
          id: randomUUID(),
          petId: context.petId,
          key: action.key,
          name: action.name,
          expiresAt: now() + 120_000,
        };
    },
    async submit(input) {
      const request = robotRequestSchema.parse(input);
      if (disposed) throw new Error('robot_disposed');
      if (request.action === 'stop') {
        await stop();
        return snapshot();
      }
      if (request.action === 'disarm') {
        armed = false;
        cancelChat();
        return snapshot();
      }
      if (storageError) throw new Error('robot_storage_unavailable');
      if ('session' in request && request.session !== session) throw new Error('robot_session_changed');
      if (request.action === 'confirm-chat-action') await confirmChatAction(request.id);
      else if (request.action === 'dismiss-chat-action') {
        if (pendingAction?.id !== request.id) throw new Error('robot_proposal_expired');
        pendingAction = undefined;
      } else if (request.action === 'configure') {
        if (active || checking || stopping) throw new Error('robot_busy');
        mkdirSync(options.userRoot, { recursive: true, mode: 0o700 });
        writePrivateJson(configFile, request.config);
        config = request.config;
        cancelChat();
        cancelSpeech();
        chatSpeech = undefined;
        session = randomUUID();
        armed = connected = false;
        telemetry = undefined;
        catalog = undefined;
        stopResult = undefined;
        previousStatus = undefined;
        error = '';
      } else if (request.action === 'check') await check();
      else if (request.action === 'arm') {
        if (
          active ||
          stopping ||
          !config.enabled ||
          !snapshot().connected ||
          (telemetry && (telemetry.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1)))
        )
          throw new Error('robot_not_ready');
        armed = true;
      } else {
        cancelChat();
        command(request);
      }
      return snapshot();
    },
    async dispose() {
      disposed = true;
      unsubscribe();
      cancelSpeech();
      cancelChat();
      armed = false;
      clearInterval(timer);
      statusAbort?.abort();
      if (stopping) await stopOperation?.catch(() => {});
      else if (active) await stop();
    },
  };
}
