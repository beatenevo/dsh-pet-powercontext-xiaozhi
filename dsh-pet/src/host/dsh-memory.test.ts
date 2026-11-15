/** Verify the optional host-service boundary and bounded fallback behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDshMemory, DSH_MEMORY_PROTOCOL } from './dsh-memory.ts';
import { DEFAULT_CHAT_MEMORY } from '../shared/chat-memory-config.ts';

const config = { ...DEFAULT_CHAT_MEMORY, timeoutMs: 20 };
const ready = {
  status: 'ready',
  bindingId: 'a'.repeat(64),
  scopeId: 'project-a',
  workspace: 'alpha',
  content: 'Useful memory',
};

test('missing, incompatible and throwing plugins fail open without disclosing errors', async () => {
  assert.deepEqual(await prepareDshMemory(() => undefined, config), {
    status: 'unavailable',
    reason: 'session-required',
  });
  assert.deepEqual(await prepareDshMemory(() => undefined, config, 's'), {
    status: 'unavailable',
    reason: 'plugin-missing',
  });
  assert.deepEqual(await prepareDshMemory(() => ({}), config, 's'), {
    status: 'unavailable',
    reason: 'plugin-incompatible',
  });
  const result = await prepareDshMemory(
    () => {
      throw new Error('secret-token');
    },
    config,
    's',
  );
  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('a hanging plugin is cancelled without delaying ordinary chat indefinitely', async () => {
  let signal: AbortSignal | undefined;
  const service = {
    protocol: DSH_MEMORY_PROTOCOL,
    prepare: async (input: { signal: AbortSignal }) => {
      signal = input.signal;
      return new Promise(() => {});
    },
  };
  assert.deepEqual(await prepareDshMemory(() => service, config, 's', 'hello'), {
    status: 'unavailable',
    reason: 'timeout',
  });
  assert.equal(signal?.aborted, true);
});

test('prepared evidence is bounded and a removed plugin cannot return a stale result', async () => {
  let current: unknown;
  const service = { protocol: DSH_MEMORY_PROTOCOL, prepare: async () => ready };
  current = service;
  assert.deepEqual(await prepareDshMemory(() => current, config, 's', 'hello'), ready);
  service.prepare = async () => ({ ...ready, content: 'a'.repeat(config.maxRecallBytes + 1) });
  assert.equal((await prepareDshMemory(() => current, config, 's', 'hello')).status, 'unavailable');
  service.prepare = async () => {
    current = undefined;
    return ready;
  };
  assert.deepEqual(await prepareDshMemory(() => current, config, 's', 'hello'), {
    status: 'unavailable',
    reason: 'plugin-missing',
  });
});
