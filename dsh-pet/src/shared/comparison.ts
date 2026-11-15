/** Explicit context-strategy replay, separate from normal DSH agent execution. */
import type { ReportedTokenUsage } from './token-usage.ts';
export type ComparisonStrategy = 'full' | 'memory' | 'short';
export interface ComparisonInput {
  corpus: string;
  questions: string[];
  recentBytes: number;
}
export interface ComparisonAnswer {
  strategy: ComparisonStrategy;
  status: 'pending' | 'running' | 'complete' | 'failed';
  text?: string;
  error?: string;
  usage?: ReportedTokenUsage;
  contextBytes?: number;
  recallBytes?: number;
  durationMs?: number;
  traceUrl?: string;
}
export interface MemoryUsage {
  generation: { requests: number; input: number | null; output: number | null };
  embedding: { requests: number; input: number | null; output: number | null };
  activeMemories: number;
  pendingSources: number;
}
export interface ComparisonRun {
  id: string;
  status: 'preparing' | 'running' | 'complete' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  model: { provider: string; model: string };
  input: ComparisonInput;
  scopeId?: string;
  preparation?: MemoryUsage;
  memoryUsage?: MemoryUsage;
  accountingError?: string;
  preparationTraceUrl?: string;
  error?: string;
  rounds: { question: string; answers: ComparisonAnswer[] }[];
}
/** DSH reports uncached input separately from its cache buckets. Missing input is not zero. */
export function comparisonInputTokens(usage?: ReportedTokenUsage): number | undefined {
  if (usage?.inputTokens === undefined) return;
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** Only completed, paired measurements contribute to the displayed answer-input reduction. */
export function comparisonTotals(
  run: ComparisonRun,
  strategy: ComparisonStrategy,
): {
  input?: number;
  output?: number;
  cacheRead?: number;
  completed: number;
} {
  const answers = run.rounds.map((round) => round.answers.find((answer) => answer.strategy === strategy)!);
  const complete = answers.every((answer) => answer.status === 'complete');
  const sum = (values: (number | undefined)[]): number | undefined =>
    complete && values.every((value) => value !== undefined) ? values.reduce<number>((a, b) => a + b!, 0) : undefined;
  return {
    input: sum(answers.map((answer) => comparisonInputTokens(answer.usage))),
    output: sum(answers.map((answer) => answer.usage?.outputTokens)),
    cacheRead: sum(answers.map((answer) => answer.usage?.cacheReadTokens)),
    completed: answers.filter((answer) => answer.status === 'complete').length,
  };
}

/** Observed input only, not currency or cross-model equivalence. Preparation is included exactly once. */
export function comparisonObservedInput(run: ComparisonRun): number | undefined {
  const answers = comparisonTotals(run, 'memory').input;
  const usage = run.memoryUsage;
  if (
    run.status !== 'complete' ||
    run.accountingError ||
    answers === undefined ||
    !usage ||
    usage.pendingSources ||
    usage.generation.requests === 0 ||
    usage.generation.input === null ||
    usage.embedding.input === null
  )
    return;
  return answers + usage.generation.input + usage.embedding.input;
}
