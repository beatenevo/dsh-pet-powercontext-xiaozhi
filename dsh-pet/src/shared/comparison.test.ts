import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonObservedInput, comparisonTotals, type ComparisonRun } from './comparison.ts';
test('observed input counts cached input and preparation once, and never hides unknown overhead', () => {
  const run: ComparisonRun = {
    id: 'example',
    status: 'complete',
    startedAt: 0,
    model: { provider: 'example', model: 'example' },
    input: { corpus: 'context', questions: ['question'], recentBytes: 128 },
    rounds: [
      {
        question: 'question',
        answers: ['full', 'memory', 'short'].map((strategy) => ({
          strategy: strategy as 'full' | 'memory' | 'short',
          status: 'complete',
          usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 20, cacheWriteTokens: 5 },
        })),
      },
    ],
    preparation: {
      generation: { requests: 1, input: 100, output: 20 },
      embedding: { requests: 1, input: 5, output: null },
      activeMemories: 1,
      pendingSources: 0,
    },
    memoryUsage: {
      generation: { requests: 1, input: 100, output: 20 },
      embedding: { requests: 2, input: 8, output: null },
      activeMemories: 1,
      pendingSources: 0,
    },
  };
  assert.equal(comparisonTotals(run, 'memory').input, 35);
  assert.equal(comparisonObservedInput(run), 143);
  run.memoryUsage!.embedding.input = null;
  assert.equal(comparisonObservedInput(run), undefined);
  run.memoryUsage!.embedding.input = 8;
  run.accountingError = 'incomplete';
  assert.equal(comparisonObservedInput(run), undefined);
});
