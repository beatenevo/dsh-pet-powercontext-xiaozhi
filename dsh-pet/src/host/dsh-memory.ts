/** Optional, read-only recall through the running PowerContext DSH plugin. */
import type { ChatMemoryConfig } from '../shared/chat-memory-config.ts';
import type { TraceReference } from '../shared/observability.ts';

export const DSH_MEMORY_SERVICE = 'powercontextCompanionMemory';
export const DSH_MEMORY_PROTOCOL = 'powercontext.companion-memory.v1';

/** Credential-free status shared with the settings and chat panels. */
export type DshMemoryResult =
  | { status: 'connected' | 'ready' | 'empty'; bindingId: string; scopeId: string; workspace: string; content?: string }
  | { status: 'unavailable'; reason: string };

interface DshMemoryService {
  protocol?: unknown;
  prepare?: (input: {
    sessionId: string;
    query?: string;
    maxBytes: number;
    signal: AbortSignal;
    traceContext?: TraceReference;
  }) => Promise<unknown>;
}

/** Validate the versioned boundary; never pass raw errors or connection configuration to clients. */
function parseResult(value: unknown, maxBytes: number): DshMemoryResult {
  const invalid: DshMemoryResult = { status: 'unavailable', reason: 'invalid-response' };
  if (!value || typeof value !== 'object') return invalid;
  const item = value as Record<string, unknown>;
  if (item.status === 'unavailable') {
    const reasons = ['session-required', 'workspace-unavailable', 'scope-unavailable', 'connection-unavailable'];
    return {
      status: 'unavailable',
      reason: reasons.includes(String(item.reason)) ? String(item.reason) : 'connection-unavailable',
    };
  }
  if (item.status !== 'connected' && item.status !== 'ready' && item.status !== 'empty') return invalid;
  if (typeof item.bindingId !== 'string' || !/^[a-f0-9]{64}$/.test(item.bindingId)) return invalid;
  if (typeof item.scopeId !== 'string' || !item.scopeId || item.scopeId.length > 256) return invalid;
  if (typeof item.workspace !== 'string' || !item.workspace || item.workspace.length > 1024) return invalid;
  if (
    item.status === 'ready' &&
    (typeof item.content !== 'string' || !item.content.trim() || Buffer.byteLength(item.content) > maxBytes)
  )
    return invalid;
  return {
    status: item.status,
    bindingId: item.bindingId,
    scopeId: item.scopeId,
    workspace: item.workspace,
    ...(item.status === 'ready' ? { content: item.content as string } : {}),
  };
}

/** Soft lookup on every request supports late plugin installation, reload and removal. */
export async function prepareDshMemory(
  getService: (name: string) => unknown,
  config: ChatMemoryConfig,
  sessionId?: string,
  query?: string,
  traceContext?: TraceReference,
): Promise<DshMemoryResult> {
  if (!sessionId) return { status: 'unavailable', reason: 'session-required' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const service = getService(DSH_MEMORY_SERVICE) as DshMemoryService | undefined;
    if (!service) return { status: 'unavailable', reason: 'plugin-missing' };
    if (service.protocol !== DSH_MEMORY_PROTOCOL || typeof service.prepare !== 'function')
      return { status: 'unavailable', reason: 'plugin-incompatible' };
    const timeout = new Promise<DshMemoryResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: 'unavailable', reason: 'timeout' });
      }, config.timeoutMs);
    });
    const pending = Promise.resolve()
      .then(() =>
        service.prepare!({
          sessionId,
          query,
          maxBytes: config.maxRecallBytes,
          signal: controller.signal,
          ...(traceContext ? { traceContext } : {}),
        }),
      )
      .then((value) => {
        if (getService(DSH_MEMORY_SERVICE) !== service)
          return { status: 'unavailable', reason: 'plugin-missing' } as const;
        return parseResult(value, config.maxRecallBytes);
      });
    return await Promise.race([pending, timeout]);
  } catch {
    return { status: 'unavailable', reason: 'connection-unavailable' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
