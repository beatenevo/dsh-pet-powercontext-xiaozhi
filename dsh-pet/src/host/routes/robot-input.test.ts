/** Ingress contract tests: ASR dispatch, guarded effects and direct presentation. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PetRouteDeps } from './types.ts';
import { handleRobotInputRoutes } from './robot-input.ts';
import { failResult } from './result.ts';

/** Isolated route dependencies record externally visible effects without a model or physical robot. */
function harness() {
  const writes: unknown[][] = [];
  const chats: unknown[][] = [];
  const heard: unknown[] = [];
  let locked = false;
  const deps = {
    requirePet: () => ({ ok: true, petId: 'main', conf: { animations: { clicks: ['wave'] } } }),
    lockBlocked: () => (locked ? failResult('bad-request', 'locked') : null),
    sleepBlocked: () => null,
    speech: {
      hear: async (raw: unknown) => {
        heard.push(raw);
        return { ok: true, text: '你好' };
      },
    },
    chatWithPet: async (...args: unknown[]) => {
      chats.push(args);
      return { ok: true, text: '欢迎' };
    },
    state: {
      writePet: (...args: unknown[]) => {
        writes.push(args);
      },
    },
    playback: { create: () => ({ playbackId: 'receipt-1' }) },
  } as unknown as PetRouteDeps;
  return {
    deps,
    writes,
    chats,
    heard,
    lock: () => {
      locked = true;
    },
    call: (body: unknown, signal?: AbortSignal) =>
      handleRobotInputRoutes(deps, {
        rest: 'robot/input',
        method: 'POST',
        url: new URL('http://localhost/robot/input?pet=main&surface=desktop&session=astra'),
        body: JSON.stringify(body),
        signal,
      }),
  };
}

test('text conversation preserves session and avoids ASR', async () => {
  const h = harness();
  assert.deepEqual(await h.call({ text: '  你好  ' }), {
    kind: 'json',
    status: 200,
    headers: undefined,
    obj: { ok: true, text: '欢迎', inputText: '你好' },
  });
  assert.deepEqual(h.chats, [['main', '你好', undefined, 'astra']]);
  assert.equal(h.heard.length, 0);
});

test('audio is transcribed before direct speech and explicit animation', async () => {
  const h = harness();
  await h.call({ audio: 'AAAA', provider: 'test', mode: 'say', animation: 'wave' });
  assert.deepEqual(h.heard, [{ audio: 'AAAA', provider: 'test' }]);
  assert.deepEqual(h.writes, [
    ['main', 'anim', { name: 'wave', playbackId: 'receipt-1' }],
    ['main', 'say', { text: '你好', duration: 10000, anim: false, source: 'robot-input', voiceTo: 'desktop' }],
  ]);
  assert.equal(h.chats.length, 0);
});

test('invalid payloads and unknown animations produce no effects', async () => {
  const h = harness();
  for (const body of [
    {},
    { text: 'hi', audio: 'AAAA' },
    { text: 'hi', provider: 'test' },
    { text: 'hi', animation: 'wave' },
    { text: 'hi', mode: 'say', animation: 'missing' },
    { text: 'hi', extra: true },
  ]) {
    const result = await h.call(body);
    assert.equal(result?.kind === 'json' && (result.obj as { ok: boolean }).ok, false);
  }
  assert.deepEqual([h.writes, h.chats, h.heard], [[], [], []]);
});

test('silence, cancellation and occupancy changes after ASR never dispatch', async () => {
  for (const scenario of ['silence', 'cancel', 'lock', 'failure']) {
    const h = harness();
    const controller = new AbortController();
    h.deps.speech.hear = async () => {
      if (scenario === 'cancel') controller.abort();
      if (scenario === 'lock') h.lock();
      return scenario === 'failure'
        ? { ok: false, reason: 'unsupported', message: 'no provider' }
        : { ok: true, text: scenario === 'silence' ? '' : 'hello' };
    };
    const result = await h.call({ audio: 'AAAA' }, controller.signal);
    assert.equal(result?.kind === 'json' && (result.obj as { ok: boolean }).ok, scenario === 'silence');
    assert.deepEqual([h.writes, h.chats], [[], []]);
  }
});

test('direct speech can disable TTS', async () => {
  const h = harness();
  await h.call({ text: 'hello', mode: 'say', speak: false });
  assert.deepEqual(h.writes, [['main', 'say', { text: 'hello', duration: 10000, anim: true, source: 'robot-input' }]]);
});

test('locked or already cancelled requests do not call ASR', async () => {
  for (const locked of [true, false]) {
    const h = harness();
    const controller = new AbortController();
    if (locked) h.lock();
    else controller.abort();
    await h.call({ audio: 'AAAA' }, controller.signal);
    assert.deepEqual([h.heard, h.chats, h.writes], [[], [], []]);
  }
});
