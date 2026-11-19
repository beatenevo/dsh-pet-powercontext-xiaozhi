/** A bounded, opt-in content exporter owned by the pet; never registers global OTel providers. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Span, type SpanContext } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { readPrivateJson, writePrivateJson } from '../../standalone/ai-storage.ts';
import {
  DEFAULT_OBSERVABILITY,
  type ObservabilityConfig,
  type ObservabilityStatus,
  type ObservedInteraction,
  type PetOperation,
  type TraceReference,
} from '../../shared/observability.ts';
import { observationUrl, observabilityUpdateSchema, publicConfig } from './config.ts';

interface ActiveObservation {
  span: Span;
  provider: BasicTracerProvider;
  conversationId?: string;
}
interface RunOptions {
  /** Only identities issued by this host and retained in its bounded recent list may be joined. */
  parentInteractionId?: string;
  /** Local partition key, never exported. Conversation identities are random and process-local. */
  conversationKey?: string;
  /** Deferred capture retains the originating trace, even after its parent span ends. */
  link?: TraceReference;
  model?: { provider: string; model: string };
  attempt?: number;
}

/** Validate the W3C v00 identity before it crosses the companion/HTTP boundary. */
export function referenceContext(value: unknown): SpanContext | undefined {
  const parent = (value as TraceReference | undefined)?.traceparent;
  if (typeof parent !== 'string') return;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(parent);
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return;
  return { traceId: match[1], spanId: match[2], traceFlags: parseInt(match[3], 16), isRemote: true };
}

/** All metadata fields are explicitly owned here; callers cannot export arbitrary objects or errors. */
export interface PetObservationFields {
  'dsh_pet.comparison.id'?: string;
  'dsh_pet.comparison.strategy'?: 'prepare' | 'full' | 'memory' | 'short';
  'dsh_pet.comparison.round'?: number;
  'dsh_pet.memory.backend'?: 'native' | 'powercontext' | 'dsh-powercontext';
  'dsh_pet.memory.status'?: 'ready' | 'empty' | 'unavailable' | 'skipped' | 'accepted';
  'dsh_pet.memory.context_bytes'?: number;
  'dsh_pet.robot.evidence'?: 'worker_result';
}

/** Mutable service configuration is private to the host and never part of GET /config. */
export class PetObservability {
  private config: ObservabilityConfig = { ...DEFAULT_OBSERVABILITY };
  private spaceKey = '';
  private readonly file: string;
  private readonly active = new AsyncLocalStorage<ActiveObservation>();
  private readonly conversations = new Map<string, string>();
  private readonly parents = new Map<string, ActiveObservation>();
  private provider?: BasicTracerProvider;
  private interactions: ObservedInteraction[] = [];
  private error?: ObservabilityStatus['error'];
  private lastExportAt?: number;
  private disposed = false;

  constructor(userRoot: string) {
    this.file = join(userRoot, 'observability.json');
    try {
      const saved = readPrivateJson(this.file);
      if (saved !== undefined) {
        const parsed = observabilityUpdateSchema.parse(saved);
        this.config = publicConfig(parsed);
        this.spaceKey = parsed.spaceKey ?? '';
        this.start();
      }
    } catch {
      this.error = 'configuration_invalid';
    }
  }

  snapshot(): ObservabilityStatus {
    return {
      config: { ...this.config },
      hasKey: !!this.spaceKey,
      ...(this.error ? { error: this.error } : {}),
      ...(this.lastExportAt ? { lastExportAt: this.lastExportAt } : {}),
      interactions: this.interactions.map((entry) => ({ ...entry })),
      ...(this.config.baseUrl && this.config.agentId && this.config.spaceId
        ? { memoryUrl: observationUrl(this.config) }
        : {}),
    };
  }

  configure(value: unknown): ObservabilityStatus {
    if (this.disposed) throw new Error('observability_unavailable');
    const parsed = observabilityUpdateSchema.parse(value);
    // Older clients omit this field; preserve the saved choice instead of silently enabling capture.
    const config = publicConfig({ ...parsed, captureContent: parsed.captureContent ?? this.config.captureContent });
    // Never silently forward a saved key to a different destination or Agent.
    const sameTarget =
      config.baseUrl === this.config.baseUrl &&
      config.agentId === this.config.agentId &&
      config.spaceId === this.config.spaceId;
    const key = parsed.clearKey ? '' : (parsed.spaceKey ?? (sameTarget ? this.spaceKey : ''));
    if (config.enabled && !key) throw new Error('observability_key_required');
    mkdirSync(join(this.file, '..'), { recursive: true });
    writePrivateJson(this.file, { ...config, ...(key ? { spaceKey: key } : {}) });
    const previous = this.provider;
    this.provider = undefined;
    this.config = config;
    this.spaceKey = key;
    this.error = undefined;
    this.lastExportAt = undefined;
    this.interactions = [];
    this.parents.clear();
    this.conversations.clear();
    if (previous) void previous.shutdown().catch(() => {});
    try {
      this.start();
    } catch {
      this.error = 'configuration_invalid';
    }
    return this.snapshot();
  }

  private start(): void {
    if (!this.config.enabled || this.disposed) return;
    if (!this.spaceKey) throw new Error('observability_key_required');
    const delegate = new OTLPTraceExporter({
      url: this.config.baseUrl + '/api/public/otel/v1/traces',
      headers: { Authorization: 'Basic ' + Buffer.from(this.config.agentId + ':' + this.spaceKey).toString('base64') },
      timeoutMillis: 2000,
      concurrencyLimit: 1,
    });
    const exporter: SpanExporter = {
      export: (spans, done) =>
        delegate.export(spans, (result) => {
          if (this.provider === provider) {
            const accepted = result.code === 0;
            this.error = accepted ? undefined : 'export_failed';
            if (accepted) this.lastExportAt = Date.now();
            const ids = new Set(spans.map((span) => span.spanContext().traceId));
            for (const entry of this.interactions)
              if (ids.has(entry.traceId)) entry.delivery = accepted ? 'accepted' : 'failed';
          }
          // Never expose SDK exception text, request headers or remote response bodies.
          done({ code: result.code });
        }),
      shutdown: () => delegate.shutdown(),
    };
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'service.name': 'dsh-pet-powercontext' }),
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          maxQueueSize: 256,
          maxExportBatchSize: 64,
          scheduledDelayMillis: 1000,
          exportTimeoutMillis: 2500,
        }),
      ],
      spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 32768, eventCountLimit: 0 },
    });
    this.provider = provider;
  }

  reference(): TraceReference | undefined {
    if (!this.provider || !this.config.enabled) return;
    const active = this.active.getStore();
    if (active?.provider !== this.provider) return;
    const context = active.span.spanContext();
    if (!context) return;
    return {
      traceparent: `00-${context.traceId}-${context.spanId}-${(context.traceFlags & 1).toString(16).padStart(2, '0')}`,
      ...(active?.conversationId ? { conversationId: active.conversationId } : {}),
    };
  }

  fields(fields: PetObservationFields): void {
    try {
      const active = this.active.getStore();
      if (!active || active.provider !== this.provider) return;
      const allowed: Record<string, readonly unknown[]> = {
        'dsh_pet.memory.backend': ['native', 'powercontext', 'dsh-powercontext'],
        'dsh_pet.memory.status': ['ready', 'empty', 'unavailable', 'skipped', 'accepted'],
        'dsh_pet.comparison.strategy': ['prepare', 'full', 'memory', 'short'],
        'dsh_pet.robot.evidence': ['worker_result'],
      };
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'dsh_pet.comparison.id' && typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value))
          active.span.setAttribute(key, value);
        if (typeof value === 'string' && allowed[key]?.includes(value)) active.span.setAttribute(key, value);
        if (
          (key === 'dsh_pet.memory.context_bytes' || key === 'dsh_pet.comparison.round') &&
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          active.span.setAttribute(key, value);
      }
    } catch {
      /* Telemetry cannot change the operation's result. */
    }
  }

  /** Export bounded current-turn text only after explicit consent; never infer prompts or memory contents. */
  content(role: 'user' | 'assistant', text: string): void {
    const active = this.active.getStore();
    if (!this.config.captureContent || !active || active.provider !== this.provider) return;
    const limit = 4000;
    // AI Vision's preview and execution views both accept role/content messages.
    const value = JSON.stringify([{ role, content: text.slice(0, limit) }]);
    active.span.setAttribute(role === 'user' ? 'gen_ai.input.messages' : 'gen_ai.output.messages', value);
    if (text.length > limit) active.span.setAttribute('dsh_pet.content.truncated', true);
  }

  /** DSH input excludes cache reads/writes; GenAI input includes them. Missing usage remains absent. */
  usage(value: unknown): void {
    try {
      const active = this.active.getStore();
      if (!active || active.provider !== this.provider || !value || typeof value !== 'object') return;
      const span = active.span;
      const usage = value as Record<string, unknown>;
      const count = (key: string): number | undefined => {
        const value = usage[key];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      };
      const input = count('inputTokens');
      const output = count('outputTokens');
      const read = count('cacheReadTokens');
      const write = count('cacheWriteTokens');
      const total = input === undefined ? undefined : input + (read ?? 0) + (write ?? 0);
      if (total !== undefined && Number.isSafeInteger(total)) span.setAttribute('gen_ai.usage.input_tokens', total);
      if (output !== undefined) span.setAttribute('gen_ai.usage.output_tokens', output);
      if (read !== undefined) span.setAttribute('gen_ai.usage.cache_read.input_tokens', read);
      if (write !== undefined) span.setAttribute('gen_ai.usage.cache_creation.input_tokens', write);
      span.setAttribute('dsh_pet.usage.reported', input !== undefined || output !== undefined);
    } catch {
      /* Invalid counters never interrupt generation. */
    }
  }

  async run<T>(operation: PetOperation, task: () => Promise<T>, options: RunOptions = {}): Promise<T> {
    const provider = this.provider;
    if (!provider || this.disposed) return task();
    let active: ActiveObservation;
    let interaction: ObservedInteraction | undefined;
    try {
      const candidateParent = options.link
        ? undefined
        : options.parentInteractionId
          ? this.parents.get(options.parentInteractionId)
          : this.active.getStore();
      const parent = candidateParent?.provider === provider ? candidateParent : undefined;
      let conversationId = parent?.conversationId;
      if (options.conversationKey !== undefined) {
        conversationId = this.conversations.get(options.conversationKey);
        if (!conversationId) {
          conversationId = randomUUID();
          if (this.conversations.size >= 256) this.conversations.delete(this.conversations.keys().next().value!);
          this.conversations.set(options.conversationKey, conversationId);
        }
      }
      if (options.link?.conversationId && /^[a-f0-9-]{36}$/.test(options.link.conversationId))
        conversationId = options.link.conversationId;
      const link = referenceContext(options.link);
      if (
        !parent &&
        !link &&
        !this.config.includeBackground &&
        ['whisper', 'sleep_talk', 'memory.capture', 'memory.recall', 'model'].includes(operation)
      )
        // Defer invocation so a synchronous business error cannot enter telemetry fallback and run twice.
        return Promise.resolve().then(task);
      const span = provider.getTracer('dsh-pet-powercontext').startSpan(
        'dsh_pet.' + operation,
        {
          kind: operation === 'model' ? SpanKind.CLIENT : SpanKind.INTERNAL,
          links: [],
          attributes: {
            'dsh_pet.operation': operation,
            ...(conversationId ? { 'gen_ai.conversation.id': conversationId } : {}),
            ...(!parent && !link
              ? { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'dsh-pet-powercontext' }
              : {}),
            ...(options.model
              ? {
                  'gen_ai.operation.name': 'chat',
                  'gen_ai.provider.name': options.model.provider.slice(0, 200),
                  'gen_ai.request.model': options.model.model.slice(0, 200),
                  'dsh_pet.usage.reported': false,
                }
              : {}),
            ...(options.attempt !== undefined ? { 'dsh_pet.model.attempt': options.attempt } : {}),
          },
        },
        parent
          ? trace.setSpan(ROOT_CONTEXT, parent.span)
          : link
            ? trace.setSpanContext(ROOT_CONTEXT, link)
            : ROOT_CONTEXT,
      );
      active = { span, provider, conversationId };
      if (!parent && !link) {
        const startedAt = Date.now();
        interaction = {
          traceId: span.spanContext().traceId,
          operation,
          startedAt,
          outcome: 'running',
          delivery: 'pending',
          url: observationUrl(this.config, span.spanContext().traceId, startedAt),
        };
        this.interactions.unshift(interaction);
        this.parents.set(interaction.traceId, active);
        const expired = this.interactions[30];
        if (expired) this.parents.delete(expired.traceId);
        this.interactions.length = Math.min(this.interactions.length, 30);
      }
    } catch {
      return task();
    }
    let outcome: ObservedInteraction['outcome'] = 'success';
    try {
      const result = await this.active.run(active, task);
      if (
        result === false ||
        (result &&
          typeof result === 'object' &&
          (('ok' in result && result.ok === false) || ('status' in result && result.status === 'unavailable')))
      )
        outcome = 'error';
      return result;
    } catch (error) {
      outcome = error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error';
      throw error;
    } finally {
      try {
        active.span.setAttribute('dsh_pet.outcome', outcome);
        active.span.setStatus({ code: outcome === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
        active.span.end();
        if (interaction) {
          interaction.outcome = outcome;
          interaction.durationMs = Math.max(0, Date.now() - interaction.startedAt);
        }
      } catch {
        /* Preserve the original result, exception and cancellation. */
      }
    }
  }

  /** Exercises authenticated OTLP export, not storage/query acceptance or model calls. */
  async check(): Promise<{ accepted: boolean; status: ObservabilityStatus }> {
    const provider = this.provider;
    if (!provider) throw new Error('observability_disabled');
    let traceId: string | undefined;
    await this.run('connection.check', async () => {
      traceId = this.reference()?.traceparent.split('-')[1];
    });
    try {
      await provider.forceFlush();
    } catch {
      this.error = 'export_failed';
    }
    return {
      accepted: this.interactions.some((entry) => entry.traceId === traceId && entry.delivery === 'accepted'),
      status: this.snapshot(),
    };
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    const provider = this.provider;
    this.provider = undefined;
    if (provider) await provider.shutdown().catch(() => {});
  }
}
