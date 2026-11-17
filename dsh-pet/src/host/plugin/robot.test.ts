/** Robot feedback must reach the normal pet routes, including when the SDK is unavailable. */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { registerRobot } from './robot.ts';
import { createHttpRoute } from './http-route.ts';
import { createPetLookup } from './pet-lookup.ts';
import { PollStateStore } from '../state.ts';
import { defaultRobotConfig } from '../robot/config.ts';
import type { PetRouteDeps } from '../routes/types.ts';
import type { RouteResult } from '../http.ts';
import { handleRobotRoutes } from '../routes/robot.ts';

async function harness(t: TestContext, display: string) {
  const root = mkdtempSync(join(tmpdir(), 'astra-pet-feedback-'));
  const configPaths = {
    defaultFile: join(root, 'default.jsonc'),
    userFile: join(root, 'main-config.jsonc'),
    petDir: join(root, 'pet'),
  };
  // Include query punctuation to verify that feedback still targets the configured pet.
  const petId = 'robot & pet';
  writeFileSync(configPaths.defaultFile, JSON.stringify({ pets: [{ id: petId, name: 'Robot pet', display }] }));
  const state = new PollStateStore();
  const lookup = createPetLookup({ state, configPaths });
  const { handlePetRoute } = createHttpRoute({
    ...lookup,
    state,
    configPaths,
    memeDirsFor: () => [],
  } as unknown as PetRouteDeps);
  const responses: RouteResult[] = [];
  const service = registerRobot({ effect: (effect: () => unknown) => effect() }, root, state, () => async (...args) => {
    const response = await handlePetRoute(...args);
    responses.push(response);
    return response;
  });
  t.after(async () => {
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  await service.submit({
    action: 'configure',
    config: {
      ...defaultRobotConfig(),
      address: '127.0.0.1:1',
      // No installed interpreter or hardware is used by this test.
      python: join(root, 'missing', 'python3'),
      petId,
    },
  });
  const stop = async () => {
    const result = await service.submit({ action: 'stop' });
    assert.equal(result.stopResult?.ok, false);
    await setImmediate();
    assert.equal(responses.length, 1);
    return result.stopResult!;
  };
  return { state, lookup, petId, responses, stop, service, configPaths };
}

for (const display of ['web', 'desktop', 'both']) {
  test(`robot feedback appears on a pet displayed on ${display}`, async (t) => {
    const h = await harness(t, display);
    const result = await h.stop();
    assert.equal(h.responses[0].kind, 'json');
    assert.deepEqual((h.responses[0] as { obj: unknown }).obj, { ok: true });
    assert.deepEqual(h.state.read().pets[h.petId]?.say?.data, {
      text: result.message,
      duration: 10_000,
      anim: false,
    });
  });
}

test('robot feedback respects exclusive pet ownership', async (t) => {
  const h = await harness(t, 'web');
  assert.equal(h.lookup.lock.acquire({ petId: h.petId }).ok, true);
  const before = h.state.read().pets[h.petId].say;
  await h.stop();
  assert.equal(h.responses[0].kind, 'json');
  assert.equal((h.responses[0] as { obj: { reason: string } }).obj.reason, 'lock-required');
  assert.deepEqual(h.state.read().pets[h.petId].say, before);
});

test('confirming an old proposal cannot move a robot for a deleted pet', async (t) => {
  const h = await harness(t, 'web');
  await h.service.submit({
    action: 'configure',
    config: {
      ...h.service.snapshot().config,
      enabled: true,
      chatActions: true,
      actions: [{ key: 'greet', name: 'Greeting', actionIds: [100], petAnimation: '' }],
    },
  });
  const context = h.service.beginChat(h.petId)!;
  h.service.completeChat(context, { text: 'Hello', actionKey: 'greet' });
  const id = h.service.snapshot().pendingAction!.id;
  writeFileSync(h.configPaths.defaultFile, JSON.stringify({ pets: [] }));
  const result = await handleRobotRoutes(
    {
      robot: h.service,
      requirePet: h.lookup.requirePet,
      configPaths: h.configPaths,
    } as unknown as PetRouteDeps,
    {
      rest: 'robot',
      method: 'POST',
      url: new URL('http://localhost/dsh-pet-7340/robot'),
      body: JSON.stringify({ action: 'confirm-chat-action', session: context.session, id, confirmed: true }),
    },
  );
  assert.equal(result?.kind, 'json');
  assert.equal((result as { obj: { reason: string } }).obj.reason, 'unknown-pet');
  assert.equal(h.service.snapshot().commands.length, 0);
});
