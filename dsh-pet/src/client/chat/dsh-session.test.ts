/** The client forwards a unique visible session, never a guessed project identity. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeDshSession } from './dsh-session.ts';

test('reads the current main view and handles absent or ambiguous sessions', () => {
  const byId = { a: { id: 'a', retainedBy: { mainView: 0 } }, b: { id: 'b', retainedBy: { mainView: 1 } } };
  const get = () => ({ list: { getSnapshot: () => ({ byId }) } });
  assert.equal(activeDshSession(get), 'b');
  byId.a.retainedBy.mainView = 1;
  assert.equal(activeDshSession(get), undefined);
  assert.equal(
    activeDshSession(() => undefined),
    undefined,
  );
  assert.equal(
    activeDshSession(() => {
      throw new Error('unavailable');
    }),
    undefined,
  );
});
