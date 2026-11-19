import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComparisonService, recentContext, memoryUsage, type ComparisonDependencies } from './service.ts';
import { DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';
import { comparisonTotals } from '../../shared/comparison.ts';
import type { PetObservability } from '../observability/service.ts';

const ledger = {
  inventory: { sources: { memory_pending: 0 }, memory: { entries: { active: 1 } } },
  usage: {
    totals: {
      generation: { requests: 1, input_tokens: 400, output_tokens: 40 },
      embedding: { requests: 1, input_tokens: 25, output_tokens: null },
    },
  },
};
function setup(overrides: Partial<ComparisonDependencies> = {}) {
  const calls: { context: string; question: string; model: string }[] = [];
  const captures: string[] = [];
  const scopes: string[] = [];
  const service = new ComparisonService({
    model: () => ({ provider: 'provider', model: 'same-model' }),
    config: () => ({ ...DEFAULT_CHAT_MEMORY }),
    observation: {
      run: async (_operation: string, task: () => Promise<unknown>) => task(),
      fields() {},
      reference() {},
      content() {},
    } as unknown as PetObservability,
    client: () => ({
      createComparisonScope: async (id) => {
        scopes.push(id);
        return 'isolated:' + id;
      },
      captureComparison: async (_scope, _id, content) => {
        captures.push(content);
      },
      flushComparison: async () => {},
      comparisonStats: async () => ledger,
      prepare: async (state) => {
        assert.ok(state.scopeId?.startsWith('isolated:'));
        return 'Recalled old fact';
      },
    }),
    answer: async (model, context, question, _signal, usage) => {
      calls.push({ context, question, model: model.model });
      usage({ inputTokens: 50, outputTokens: 10, cacheReadTokens: 20 });
      return 'Independent answer';
    },
    ...overrides,
  });
  return { service, calls, captures, scopes };
}
const input = {
  corpus: 'Old fact: the number is 42.\n' + 'Recent unrelated context. '.repeat(20),
  questions: ['What is the number?', 'What was decided?'],
  recentBytes: 128,
};
async function settled(service: ComparisonService) {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const run = service.snapshot()!;
    if (run.finishedAt) return run;
  }
  throw new Error('experiment did not settle');
}
test('same frozen corpus, questions and model; independent scope and generated answers never leak between arms', async () => {
  const { service, calls, captures, scopes } = setup();
  service.start(input);
  assert.throws(() => service.start(input), /busy/);
  const run = await settled(service);
  assert.equal(run.status, 'complete');
  assert.deepEqual(captures, [input.corpus]);
  assert.equal(scopes.length, 1);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => call.model === 'same-model' && !call.context.includes('Independent answer')));
  for (const question of input.questions) {
    const contexts = calls.filter((call) => call.question === question).map((call) => call.context);
    assert.ok(contexts.includes(input.corpus));
    assert.ok(contexts.includes(recentContext(input.corpus, 128)));
    assert.ok(contexts.some((context) => context.endsWith('Recalled old fact')));
  }
  assert.equal(comparisonTotals(run, 'full').input, 140);
  assert.equal(run.memoryUsage?.generation.input, 400);
  assert.equal(run.memoryUsage?.embedding.output, null);
  service.start(input);
  await settled(service);
  assert.notEqual(scopes[0], scopes[1]);
});
test('missing provider usage remains unknown; partial failures do not produce a savings total or trigger retry', async () => {
  let calls = 0;
  const { service } = setup({
    answer: async () => {
      if (++calls === 2) throw new Error('provider timeout');
      return 'Answer';
    },
  });
  service.start(input);
  const run = await settled(service);
  assert.equal(calls, 6);
  assert.equal(run.status, 'failed');
  assert.equal(comparisonTotals(run, 'full').input, undefined);
  assert.equal(comparisonTotals(run, 'memory').output, undefined);
});
test('stop cancels the active model and does not start the remaining arms', async () => {
  let calls = 0;
  const { service } = setup({
    answer: async (_model, _context, _question, signal) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  service.start(input);
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 5));
  service.cancel();
  const run = await settled(service);
  assert.equal(run.status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(run.rounds[0].answers[0].status, 'failed');
});
test('UTF-8 recent context does not break characters or exceed its limit', () => {
  assert.equal(recentContext('a你好🙂', 7), '好🙂');
  assert.equal(recentContext('🙂', 3), '');
});
test('unreported memory counts cannot become zeros', () => {
  assert.throws(() => memoryUsage({}));
  const value = structuredClone(ledger);
  value.usage.totals.generation.input_tokens = null as unknown as number;
  assert.equal(memoryUsage(value).generation.input, null);
});
test('input limits reject oversized experiments before creating any scope', () => {
  const { service, scopes } = setup();
  assert.throws(() => service.start({ ...input, corpus: '🙂'.repeat(13000) }));
  assert.throws(() => service.start({ ...input, questions: Array(9).fill('question') }));
  assert.equal(scopes.length, 0);
});
test('additional questions reuse the same scope, corpus and frozen model without another preparation', async () => {
  const { service, captures, calls, scopes } = setup();
  const first = service.start(input);
  await settled(service);
  assert.throws(() => service.continue({ id: '00000000-0000-4000-8000-000000000000', questions: ['Unrelated'] }));
  service.continue({ id: first.id, questions: ['Another question'] });
  const run = await settled(service);
  assert.equal(run.status, 'complete');
  assert.equal(run.rounds.length, 3);
  assert.equal(captures.length, 1);
  assert.equal(scopes.length, 1);
  assert.equal(calls.length, 9);
  assert.equal(run.id, first.id);
  assert.ok(calls.slice(-3).some((call) => call.context === input.corpus));
  assert.equal(run.preparation?.generation.input, 400);
});
