/** Isolated, bounded experiments. Starting one explicitly writes a Source and flushes its private scope. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ComparisonInput, ComparisonRun, ComparisonStrategy, MemoryUsage } from '../../shared/comparison.ts';
import type { ChatMemoryConfig } from '../../shared/chat-memory-config.ts';
import { chatMemoryConfigValid, DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';
import { readAllConfig, type ConfigPaths } from '../config.ts';
import { configuredModel, currentModel, type ModelRef } from '../model-selection.ts';
import type { HostContext } from '../plugin/context.ts';
import { PowerContextClient, type MemorySyncState } from '../powercontext.ts';
import { PetObservability } from '../observability/service.ts';
import { observationUrl } from '../observability/config.ts';
import { comparisonModel } from './model.ts';
import type { ReportedTokenUsage } from '../../shared/token-usage.ts';

const inputSchema = z
  .object({
    corpus: z
      .string()
      .refine((value) => value.trim().length > 0)
      .refine((value) => Buffer.byteLength(value) <= 49152),
    questions: z.array(z.string().trim().min(1).max(1000)).min(1).max(8),
    recentBytes: z.number().int().min(128).max(8192),
  })
  .strict();
const usageSchema = z.object({
  requests: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
});
const statsSchema = z.object({
  inventory: z.object({
    sources: z.object({ memory_pending: z.number().int().nonnegative() }),
    memory: z.object({ entries: z.object({ active: z.number().int().nonnegative() }) }),
  }),
  usage: z.object({ totals: z.object({ generation: usageSchema, embedding: usageSchema }) }),
});
/** Validate ledger counters without turning missing or unsupported fields into free work. */
export function memoryUsage(value: unknown): MemoryUsage {
  const parsed = statsSchema.parse(value);
  const convert = (usage: z.infer<typeof usageSchema>) => ({
    requests: usage.requests,
    input: usage.input_tokens,
    output: usage.output_tokens,
  });
  return {
    generation: convert(parsed.usage.totals.generation),
    embedding: convert(parsed.usage.totals.embedding),
    activeMemories: parsed.inventory.memory.entries.active,
    pendingSources: parsed.inventory.sources.memory_pending,
  };
}
/** Preserve whole Unicode code points while bounding the recent-history strategy by UTF-8 bytes. */
export function recentContext(text: string, maxBytes: number): string {
  const points = [...text];
  let bytes = 0;
  let index = points.length;
  while (index > 0 && bytes + Buffer.byteLength(points[index - 1]) <= maxBytes)
    bytes += Buffer.byteLength(points[--index]);
  return points.slice(index).join('');
}
export interface ComparisonDependencies {
  model: () => ModelRef | undefined;
  config: () => ChatMemoryConfig;
  client: (
    config: ChatMemoryConfig,
  ) => Pick<
    PowerContextClient,
    'createComparisonScope' | 'captureComparison' | 'flushComparison' | 'comparisonStats' | 'prepare'
  >;
  answer: (
    model: ModelRef,
    context: string,
    question: string,
    signal: AbortSignal,
    usage: (value: ReportedTokenUsage) => void,
  ) => Promise<string>;
  observation: PetObservability;
}

export class ComparisonService {
  private latest?: ComparisonRun;
  private controller?: AbortController;
  private frozenConfig?: ChatMemoryConfig;
  private disposed = false;
  private readonly deps: ComparisonDependencies;
  constructor(deps: ComparisonDependencies) {
    this.deps = deps;
  }
  snapshot(): ComparisonRun | null {
    return this.latest ? structuredClone(this.latest) : null;
  }
  start(value: unknown): ComparisonRun {
    if (this.disposed) throw new Error('comparison_unavailable');
    if (this.controller) throw new Error('comparison_busy');
    const input: ComparisonInput = inputSchema.parse(value);
    const model = this.deps.model();
    if (!model) throw new Error('comparison_model_required');
    const config = structuredClone(this.deps.config());
    const run: ComparisonRun = {
      id: randomUUID(),
      status: 'preparing',
      startedAt: Date.now(),
      model: { ...model },
      input,
      rounds: input.questions.map((question) => ({
        question,
        answers: (['full', 'memory', 'short'] as ComparisonStrategy[]).map((strategy) => ({
          strategy,
          status: 'pending',
        })),
      })),
    };
    this.latest = run;
    this.frozenConfig = config;
    this.launch(run, config);
    return this.snapshot()!;
  }
  /** Reuse the exact corpus, scope and model without another capture or preparation. */
  continue(value: unknown): ComparisonRun {
    if (this.disposed) throw new Error('comparison_unavailable');
    if (this.controller) throw new Error('comparison_busy');
    const request = z.object({ id: z.string().uuid(), questions: inputSchema.shape.questions }).strict().parse(value);
    const run = this.latest;
    if (
      !run ||
      run.id !== request.id ||
      run.status !== 'complete' ||
      !this.frozenConfig ||
      !run.scopeId ||
      run.rounds.length + request.questions.length > 32
    )
      throw new Error('comparison_not_reusable');
    const offset = run.rounds.length;
    run.input.questions.push(...request.questions);
    run.rounds.push(
      ...request.questions.map((question) => ({
        question,
        answers: (['full', 'memory', 'short'] as ComparisonStrategy[]).map((strategy) => ({
          strategy,
          status: 'pending' as const,
        })),
      })),
    );
    run.status = 'running';
    delete run.finishedAt;
    this.launch(run, this.frozenConfig, offset);
    return this.snapshot()!;
  }
  private launch(run: ComparisonRun, config: ChatMemoryConfig, offset?: number): void {
    const controller = new AbortController();
    this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
    void (offset === undefined ? this.execute(run, config, signal) : this.answerRounds(run, config, signal, offset))
      .catch(() => {
        run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = controller.signal.aborted ? 'comparison_cancelled' : 'comparison_processing_failed';
      })
      .finally(() => {
        run.finishedAt = Date.now();
        this.controller = undefined;
      });
  }
  cancel(): void {
    this.controller?.abort();
  }
  shutdown(): void {
    this.disposed = true;
    this.cancel();
  }
  private traceUrl(): string | undefined {
    const ref = this.deps.observation.reference();
    if (!ref) return;
    return observationUrl(this.deps.observation.snapshot().config, ref.traceparent.split('-')[1], Date.now());
  }
  private fields(run: ComparisonRun, strategy: ComparisonStrategy | 'prepare', round: number): void {
    this.deps.observation.fields({
      'dsh_pet.comparison.id': run.id,
      'dsh_pet.comparison.strategy': strategy,
      'dsh_pet.comparison.round': round,
    });
  }
  private async stats(
    run: ComparisonRun,
    config: ChatMemoryConfig,
    signal: AbortSignal,
  ): Promise<MemoryUsage | undefined> {
    try {
      return memoryUsage(
        await this.deps
          .client(config)
          .comparisonStats(run.scopeId!, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
      );
    } catch {
      run.accountingError = 'memory_usage_unavailable';
      return;
    }
  }
  private async execute(run: ComparisonRun, config: ChatMemoryConfig, signal: AbortSignal): Promise<void> {
    await this.deps.observation.run(
      'comparison.prepare',
      async () => {
        this.fields(run, 'prepare', 0);
        run.preparationTraceUrl = this.traceUrl();
        const client = this.deps.client(config);
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
        run.scopeId = await client.createComparisonScope(run.id, deadline);
        await client.captureComparison(run.scopeId, run.id, run.input.corpus, deadline);
        await client.flushComparison(run.scopeId, deadline);
        run.preparation = await this.stats(run, config, signal);
        if (!run.preparation || run.preparation.activeMemories === 0 || run.preparation.pendingSources !== 0)
          throw new Error('memory_not_ready');
        run.memoryUsage = run.preparation;
        if (run.preparation.generation.requests === 0) run.accountingError = 'memory_usage_incomplete';
      },
      { conversationKey: 'comparison:' + run.id },
    );
    run.status = 'running';
    await this.answerRounds(run, config, signal, 0);
  }
  private async answerRounds(
    run: ComparisonRun,
    config: ChatMemoryConfig,
    signal: AbortSignal,
    offset: number,
  ): Promise<void> {
    const state: MemorySyncState = {
      version: 1,
      scopeKey: 'dsh-pet-comparison:' + run.id,
      scopeId: run.scopeId,
      pending: [],
      captured: 0,
      skipped: 0,
    };
    const recent = recentContext(run.input.corpus, run.input.recentBytes);
    for (let index = offset; index < run.rounds.length; index++) {
      const round = run.rounds[index];
      // Rotate order to expose order/cache effects; never reuse another arm's generated answer.
      const order: ComparisonStrategy[] = index % 2 === 0 ? ['full', 'memory', 'short'] : ['memory', 'short', 'full'];
      for (const strategy of order) {
        signal.throwIfAborted();
        const answer = round.answers.find((entry) => entry.strategy === strategy)!;
        answer.status = 'running';
        const started = Date.now();
        try {
          await this.deps.observation.run(
            'comparison.answer',
            async () => {
              this.fields(run, strategy, index + 1);
              answer.traceUrl = this.traceUrl();
              let context = strategy === 'full' ? run.input.corpus : recent;
              if (strategy === 'memory') {
                const recalled = await this.deps.observation.run('memory.recall', () =>
                  this.deps.client(config).prepare(state, round.question, signal),
                );
                answer.recallBytes = Buffer.byteLength(recalled ?? '');
                if (recalled) context += '\n\nRecalled reference material:\n' + recalled;
              }
              answer.contextBytes = Buffer.byteLength(context);
              answer.text = await this.deps.observation.run(
                'model',
                () => {
                  this.fields(run, strategy, index + 1);
                  return this.deps.answer(
                    run.model,
                    context,
                    round.question,
                    AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
                    (usage) => {
                      answer.usage = { ...answer.usage, ...usage };
                    },
                  );
                },
                { model: run.model },
              );
              answer.status = 'complete';
            },
            { conversationKey: 'comparison:' + run.id },
          );
        } catch {
          answer.status = 'failed';
          answer.error = signal.aborted ? 'comparison_cancelled' : 'answer_failed';
        }
        answer.durationMs = Date.now() - started;
      }
      run.memoryUsage = await this.stats(run, config, signal);
    }
    signal.throwIfAborted();
    run.status = run.rounds.every((round) => round.answers.every((answer) => answer.status === 'complete'))
      ? 'complete'
      : 'failed';
  }
}

export function createComparisonService(
  ctx: HostContext,
  paths: ConfigPaths,
  observation: PetObservability,
): ComparisonService {
  return new ComparisonService({
    model: () => configuredModel(readAllConfig(paths).main, 'chatModel') ?? currentModel(ctx),
    config: () => {
      const value = readAllConfig(paths).main?.chatMemory;
      return chatMemoryConfigValid(value) ? value : { ...DEFAULT_CHAT_MEMORY };
    },
    client: (config) => new PowerContextClient(config, fetch, observation.reference()),
    answer: (model, context, question, signal, usage) =>
      comparisonModel(ctx, model, context, question, signal, usage, observation),
    observation,
  });
}
