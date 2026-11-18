/** Chat receives host changes without a pet renderer, coalesces reloads and cancels its own long poll. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createChatEffects, type ChatEffectsInput } from './effects.ts';
import type { ChatPanelRuntime } from './runtime.ts';

test('standalone chat follows state changes and cleans up without page-local snapshots', async (t) => {
  const requests: { url: string; signal?: AbortSignal | null; resolve: (value: Response) => void }[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        requests.push({ url, signal: init?.signal, resolve });
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  );
  let effect: (() => void | (() => void)) | undefined;
  const rt = {
    useEffect: (run: () => void | (() => void), deps: readonly unknown[]) => {
      if (deps[0] === 'main') effect = run;
    },
  } as ChatPanelRuntime;
  let reloads = 0;
  let release: (() => void) | undefined;
  createChatEffects(rt)({
    data: { petId: 'main', messages: [], draft: '' },
    reload: async (pet: string) => {
      assert.equal(pet, 'main');
      reloads++;
      if (reloads === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
  } as unknown as ChatEffectsInput);
  const cleanup = effect!();
  t.after(() => {
    if (typeof cleanup === 'function') cleanup();
  });
  const respond = async (index: number, counter: number, say: number, anim = 0) => {
    requests[index].resolve(
      new Response(
        JSON.stringify({
          counter,
          sections: {},
          pets: { main: { say: { counter: say, data: {} }, anim: { counter: anim, data: {} } } },
        }),
      ),
    );
    await setImmediate();
  };
  await respond(0, 1, 1);
  assert.equal(reloads, 1, 'The initial state closes the history/subscription race');
  assert.match(requests[1].url, /since=1&timeout=/);
  await respond(1, 2, 2);
  assert.equal(reloads, 2);
  await respond(2, 3, 3);
  await respond(3, 4, 4);
  assert.equal(reloads, 2, 'History reloads never overlap');
  release!();
  await setImmediate();
  assert.equal(reloads, 3, 'Changes during a reload trigger one more read');
  await respond(4, 4, 4);
  assert.equal(reloads, 3, 'Unchanged long-poll responses do not reread history');
  await respond(5, 5, 4, 5);
  assert.equal(reloads, 4, 'Action-only replies also refresh history');
  if (typeof cleanup === 'function') cleanup();
  await setImmediate();
  assert.equal(requests[6].signal?.aborted, true);
  assert.equal(requests.length, 7);
});
