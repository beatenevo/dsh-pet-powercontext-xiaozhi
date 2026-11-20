/** 验证推理预算、正文边界和失败调用的用量保留。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonModel } from './model.ts';
import type { HostContext } from '../plugin/context.ts';
import type { ReportedTokenUsage } from '../../shared/token-usage.ts';

function fixture(supportsOff = false, truncated = false) {
  const calls: Record<string, unknown>[] = [];
  const usage: ReportedTokenUsage[] = [];
  const ctx = {
    llm: {
      resolveModelInfo: async () => (supportsOff ? { reasoning: { efforts: [{ id: 'off' }] } } : {}),
      async *stream(options: Record<string, unknown>) {
        calls.push(options);
        yield { type: 'reasoning-delta', index: 0, text: 'Internal reasoning' };
        const exhausted = truncated || Number(options.maxTokens) <= 1024;
        if (!exhausted) yield { type: 'text-delta', index: 1, text: '一楼阅读角。' };
        yield { type: 'usage', usage: { inputTokens: 122, outputTokens: exhausted ? 1024 : 1200 } };
        yield { type: 'finish', reason: { kind: exhausted ? 'max-tokens' : 'stop' } };
      },
    },
  } as unknown as HostContext;
  const run = () =>
    comparisonModel(
      ctx,
      { provider: 'custom', model: 'qwen3.7-flash' },
      '活动地点为一楼阅读角。',
      '活动在什么地点举行？',
      new AbortController().signal,
      (value) => usage.push(value),
    );
  return { calls, usage, run };
}

test('reasoning beyond 1024 tokens can finish with visible text and full provider usage', async () => {
  const { calls, usage, run } = fixture();
  assert.equal(await run(), '一楼阅读角。');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxTokens, 8192);
  assert.equal(calls[0].reasoningEffort, undefined);
  assert.deepEqual(usage, [{ inputTokens: 122, outputTokens: 1200 }]);
});

test('declared reasoning-off support preserves the same comparison budget', async () => {
  const { calls, run } = fixture(true);
  await run();
  assert.equal(calls[0].reasoningEffort, 'off');
  assert.equal(calls[0].maxTokens, 8192);
});

test('exhausted reasoning-only response fails once while retaining billed usage', async () => {
  const { calls, usage, run } = fixture(false, true);
  await assert.rejects(run, /answer_unavailable/);
  assert.equal(calls.length, 1);
  assert.deepEqual(usage, [{ inputTokens: 122, outputTokens: 1024 }]);
});
