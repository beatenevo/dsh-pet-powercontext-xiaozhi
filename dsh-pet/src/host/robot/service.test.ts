/** Test authorization, uncertainty, duplicate delivery and stop isolation without a robot. */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createRobotService, type RobotFeedback } from './service.ts';
import { PollStateStore } from '../state.ts';
import { defaultRobotConfig, robotConfigSchema } from './config.ts';
import type { RobotCall, RobotRunner } from './worker.ts';
import type { RobotResult } from '../../shared/robot.ts';

const healthy: RobotResult = {
  ok: true,
  code: 'status',
  message: 'ready',
  telemetry: { actionCode: 520000, description: 'idle', modes: [1, 1, 1] },
};
const success: RobotResult = { ok: true, code: 'reported_success', message: 'Controller reported success.' };

function deferred() {
  let resolve!: (value: RobotResult) => void;
  const promise = new Promise<RobotResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness(t: TestContext, transport?: RobotRunner, mirrorFeedback = false) {
  const root = mkdtempSync(join(tmpdir(), 'astra-service-'));
  const calls: RobotCall[] = [];
  const feedback: RobotFeedback[] = [];
  let now = 100_000;
  const run: RobotRunner = async (config, call, signal) => {
    calls.push(call);
    return transport ? transport(config, call, signal) : call.operation === 'status' ? healthy : success;
  };
  const state = new PollStateStore();
  const options = {
    userRoot: root,
    state,
    run,
    monitor: false,
    now: () => now,
    feedback: async (event: RobotFeedback) => {
      feedback.push(event);
      if (mirrorFeedback) state.writePet(event.petId, 'say', { text: event.text });
    },
  };
  const service = createRobotService(options);
  t.after(() => {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  await service.submit({
    action: 'configure',
    config: {
      ...defaultRobotConfig(),
      enabled: true,
      address: 'http://127.0.0.1:8182/mcp',
      actions: [
        { key: 'greet', name: 'Greet', tool: 'startTeachProgram', target: '100', petAnimation: 'Wave' },
        { key: 'bow', name: 'Bow', tool: 'startTeachProgram', target: '102', petAnimation: '' },
      ],
    },
  });
  const arm = async () => {
    await service.submit({ action: 'check' });
    await service.submit({ action: 'arm', session: service.snapshot().session, confirmed: true });
  };
  const execute = (id = randomUUID(), key = 'greet') =>
    service.submit({ action: 'execute', session: service.snapshot().session, id, key, petId: 'main', confirmed: true });
  return {
    service,
    state,
    calls,
    feedback,
    root,
    options,
    arm,
    execute,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('configuration cannot select arbitrary commands or unverified IDs', () => {
  for (const patch of [
    { python: 'bash' },
    { address: 'host:99999' },
    { timeoutSeconds: 0 },
    { actions: [{ key: 'raw', name: 'Raw', tool: 'invalid', target: '-1', petAnimation: '' }] },
  ])
    assert.equal(robotConfigSchema.safeParse({ ...defaultRobotConfig(), ...patch }).success, false);
});

test('connection checks do not authorize motion and confirmation is mandatory', async (t) => {
  const h = await harness(t);
  assert.equal(h.service.snapshot().armed, false);
  await h.service.submit({ action: 'check' });
  await assert.rejects(h.execute(), /robot_not_armed/);
  await assert.rejects(h.service.submit({ action: 'arm', session: h.service.snapshot().session }), /true/);
  await h.arm();
  await assert.rejects(h.execute(randomUUID(), 'arbitrary'), /robot_unknown_action/);
  assert.equal(
    h.calls.some((call) => call.operation === 'execute'),
    false,
  );
});

test('one authorization permits one allowlisted group and duplicate delivery cannot replay it', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await h.arm();
  const id = randomUUID();
  await h.execute(id);
  await h.execute(id);
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
  assert.deepEqual(h.calls[h.calls.length - 1]?.target, '100');
  assert.equal(h.service.snapshot().armed, false);
  await assert.rejects(h.execute(id, 'bow'), /robot_request_conflict/);
  await assert.rejects(h.execute(), /robot_busy/);
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'reported-success');
  await assert.rejects(h.execute(), /robot_not_connected/);
  await h.service.submit({ action: 'check' });
  await assert.rejects(h.execute(), /robot_not_armed/);
});

test('a timeout remains unknown, sends no retry and consumes authorization', async (t) => {
  const h = await harness(t, async (_config, call) =>
    call.operation === 'status' ? healthy : { ok: false, code: 'timeout', message: 'Unknown physical state.' },
  );
  await h.arm();
  await h.execute();
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().armed, false);
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
});

test('stop bypasses an unresolved action and a late success cannot erase uncertainty', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) =>
    call.operation === 'execute'
      ? pending.promise
      : call.operation === 'status'
        ? healthy
        : {
            ok: false,
            code: 'stop_unconfirmed',
            message: 'AGV unreachable.',
            stops: { upperBody: { ok: true, message: '' }, agv: { ok: false, message: 'unreachable' } },
          },
  );
  await h.arm();
  await h.execute();
  await h.service.submit({ action: 'stop' });
  assert.equal(h.calls[h.calls.length - 1]?.operation, 'stop');
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().stopResult?.stops?.agv.ok, false);
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().connected, false);
});

test('stale telemetry and configuration changes invalidate authorization', async (t) => {
  const h = await harness(t);
  await h.arm();
  h.advance(16_000);
  await assert.rejects(h.execute(), /robot_not_connected/);
  const session = h.service.snapshot().session;
  await h.service.submit({ action: 'configure', config: h.service.snapshot().config });
  await assert.rejects(h.service.submit({ action: 'arm', session, confirmed: true }), /robot_session_changed/);
});

test('restart preserves uncertain receipts, disarms control and rejects the old session', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await h.arm();
  const oldSession = h.service.snapshot().session;
  const id = randomUUID();
  await h.execute(id);
  const restarted = createRobotService(h.options);
  assert.equal(restarted.snapshot().commands[0].state, 'unknown');
  assert.equal(restarted.snapshot().armed, false);
  await assert.rejects(
    restarted.submit({ action: 'execute', session: oldSession, id, key: 'greet', petId: 'main', confirmed: true }),
    /robot_session_changed/,
  );
  restarted.dispose();
  pending.resolve(success);
  await setImmediate();
});

test('status changes drive pet feedback without sending movement', async (t) => {
  let description = 'idle';
  let actionCode = 520000;
  const h = await harness(t, async () => ({
    ...healthy,
    telemetry: { ...healthy.telemetry!, description, actionCode },
  }));
  await h.service.submit({ action: 'check' });
  description = 'working';
  actionCode = 520001;
  await h.service.submit({ action: 'check' });
  await setImmediate();
  assert.equal(h.feedback.length, 1);
  assert.equal(h.feedback[0].text, 'Robot: working');
  assert.equal(
    h.calls.every((call) => call.operation === 'status'),
    true,
  );
});

test('a corrupt journal blocks motion but not independent stop requests', async (t) => {
  const h = await harness(t);
  writeFileSync(join(h.root, 'astra-commands.json'), 'invalid json', { mode: 0o600 });
  const broken = createRobotService(h.options);
  await assert.rejects(broken.submit({ action: 'check' }), /robot_storage_unavailable/);
  await broken.submit({ action: 'stop' });
  assert.equal(h.calls[h.calls.length - 1]?.operation, 'stop');
  broken.dispose();
});

test('a status response from before a stop cannot restore connected state', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'status' ? pending.promise : success));
  const checking = h.service.submit({ action: 'check' });
  await h.service.submit({ action: 'stop' });
  pending.resolve(healthy);
  await checking;
  assert.equal(h.service.snapshot().connected, false);
});

test('an externally started movement revokes an outstanding authorization', async (t) => {
  let code = 520000;
  const h = await harness(t, async () => ({ ...healthy, telemetry: { ...healthy.telemetry!, actionCode: code } }));
  await h.arm();
  code = 520001;
  await h.service.submit({ action: 'check' });
  assert.equal(h.service.snapshot().armed, false);
  await assert.rejects(h.execute(), /robot_not_armed/);
  assert.equal(
    h.calls.some((call) => call.operation === 'execute'),
    false,
  );
});

test('host shutdown awaits the independent stop response for an outstanding command', async (t) => {
  const movement = deferred();
  const stop = deferred();
  const h = await harness(t, async (_config, call) =>
    call.operation === 'status' ? healthy : call.operation === 'execute' ? movement.promise : stop.promise,
  );
  await h.arm();
  await h.execute();
  let disposed = false;
  const shutdown = h.service.dispose().then(() => {
    disposed = true;
  });
  await setImmediate();
  assert.equal(disposed, false);
  assert.equal(h.calls[h.calls.length - 1].operation, 'stop');
  stop.resolve(success);
  await shutdown;
  assert.equal(disposed, true);
  movement.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
});

async function enableChat(h: Awaited<ReturnType<typeof harness>>, speech = true) {
  await h.service.submit({
    action: 'configure',
    config: { ...h.service.snapshot().config, chatSpeech: speech, chatActions: true },
  });
}

test('old configurations keep chat forwarding off and only the linked pet can start a robot turn', async (t) => {
  const old: Record<string, unknown> = { ...defaultRobotConfig() };
  delete old.chatSpeech;
  delete old.chatActions;
  assert.equal(robotConfigSchema.parse(old).chatSpeech, false);
  assert.equal(robotConfigSchema.parse(old).chatActions, false);
  const h = await harness(t);
  assert.equal(h.service.beginChat('main'), undefined);
  await enableChat(h);
  assert.equal(h.service.beginChat('another-pet'), undefined);
  assert.equal(h.calls.length, 0);
});

test('chat speech runs once, preserves the reply bubble and proposes movement until fresh on-site confirmation', async (t) => {
  const h = await harness(t);
  await enableChat(h);
  const turn = h.service.beginChat('main')!;
  assert.deepEqual(turn.actions, [
    { key: 'greet', name: 'Greet' },
    { key: 'bow', name: 'Bow' },
  ]);
  h.state.writePet('main', 'say', { text: 'Hello, I am your guide.' });
  h.service.completeChat(turn, { text: 'Hello, I am your guide.', actionKey: 'greet' });
  h.service.completeChat(turn, { text: 'Duplicate', actionKey: 'bow' });
  await setImmediate();
  assert.deepEqual(
    h.calls.map((call) => call.operation),
    ['status', 'speak'],
  );
  assert.equal(h.calls[1].text, 'Hello, I am your guide.');
  assert.equal(h.feedback.length, 0, 'Automatic speech must not overwrite the answer bubble');
  assert.equal(h.service.snapshot().chatSpeech?.state, 'reported-success');
  assert.equal(h.service.snapshot().armed, false);
  const proposal = h.service.snapshot().pendingAction!;
  assert.equal(proposal.key, 'greet');
  const request = { action: 'confirm-chat-action', session: turn.session, id: proposal.id, confirmed: true };
  await assert.rejects(h.service.submit({ ...request, confirmed: false }));
  await h.service.submit(request);
  await setImmediate();
  assert.deepEqual(
    h.calls.map((call) => call.operation),
    ['status', 'speak', 'status', 'execute'],
  );
  assert.deepEqual(h.calls[3].target, '100');
  assert.ok(h.feedback.some((event) => event.animation === 'Wave'));
  assert.equal(h.service.snapshot().pendingAction, undefined);
  await assert.rejects(h.service.submit(request), /robot_proposal_expired/);
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
});

for (const cancel of ['stop', 'disarm', 'configure', 'new-chat', 'dismiss']) {
  test(`${cancel} invalidates a proposed action and cannot replay a late completion`, async (t) => {
    const h = await harness(t);
    await enableChat(h, false);
    const turn = h.service.beginChat('main')!;
    h.service.completeChat(turn, { text: 'Ready?', actionKey: 'greet' });
    const proposal = h.service.snapshot().pendingAction!;
    if (cancel === 'configure') await h.service.submit({ action: 'configure', config: h.service.snapshot().config });
    else if (cancel === 'new-chat') h.service.beginChat('main');
    else if (cancel === 'dismiss')
      await h.service.submit({ action: 'dismiss-chat-action', session: turn.session, id: proposal.id });
    else await h.service.submit({ action: cancel });
    h.service.completeChat(turn, { text: 'Late', actionKey: 'greet' });
    assert.equal(h.service.snapshot().pendingAction, undefined);
    await assert.rejects(
      h.service.submit({ action: 'confirm-chat-action', session: turn.session, id: proposal.id, confirmed: true }),
    );
    assert.equal(
      h.calls.some((call) => call.operation === 'execute'),
      false,
    );
  });
}

test('unknown keys and expired proposals cannot request movement', async (t) => {
  const h = await harness(t);
  await enableChat(h, false);
  h.service.completeChat(h.service.beginChat('main')!, { text: 'Unknown', actionKey: 'unconfigured' });
  assert.equal(h.service.snapshot().pendingAction, undefined);
  const turn = h.service.beginChat('main')!;
  h.service.completeChat(turn, { text: 'Hello', actionKey: 'greet' });
  const id = h.service.snapshot().pendingAction!.id;
  h.advance(120_001);
  assert.equal(h.service.snapshot().pendingAction, undefined);
  await assert.rejects(
    h.service.submit({ action: 'confirm-chat-action', session: turn.session, id, confirmed: true }),
    /robot_proposal_expired/,
  );
  assert.equal(h.calls.length, 0);
});

test('a stop while confirmation is checking status cancels the exact proposed action', async (t) => {
  const status = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'status' ? status.promise : success));
  await enableChat(h, false);
  const turn = h.service.beginChat('main')!;
  h.service.completeChat(turn, { text: 'Hello', actionKey: 'greet' });
  const confirmation = h.service.submit({
    action: 'confirm-chat-action',
    session: turn.session,
    id: h.service.snapshot().pendingAction!.id,
    confirmed: true,
  });
  await h.service.submit({ action: 'stop' });
  status.resolve(healthy);
  await assert.rejects(confirmation, /robot_proposal_expired/);
  assert.equal(
    h.calls.some((call) => call.operation === 'execute'),
    false,
  );
});

test('stop cancels speech waiting on a connection check without sending it later', async (t) => {
  const status = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'status' ? status.promise : success));
  await enableChat(h);
  h.state.writePet('main', 'say', { text: 'Hello' });
  await h.service.submit({ action: 'stop' });
  status.resolve(healthy);
  await setImmediate();
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'cancelled');
  assert.equal(
    h.calls.some((call) => call.operation === 'speak'),
    false,
  );
});

for (const stopBeforeReady of [false, true]) {
  test(`speech shares an ongoing monitor check${stopBeforeReady ? ' and respects a subsequent stop' : ''}`, async (t) => {
    const status = deferred();
    const h = await harness(t, async (_config, call) => (call.operation === 'status' ? status.promise : success));
    await enableChat(h);
    const monitoring = h.service.submit({ action: 'check' });
    h.state.writePet('main', 'say', { text: 'Hello after checking' });
    assert.equal(h.service.snapshot().chatSpeech?.state, 'checking');
    if (stopBeforeReady) await h.service.submit({ action: 'stop' });
    status.resolve(healthy);
    await monitoring;
    await setImmediate();
    assert.equal(h.calls.filter((call) => call.operation === 'speak').length, stopBeforeReady ? 0 : 1);
    assert.equal(h.service.snapshot().chatSpeech?.state, stopBeforeReady ? 'skipped' : 'reported-success');
    if (stopBeforeReady) assert.equal(h.service.snapshot().chatSpeech?.reason, 'cancelled');
  });
}

test('offline and over-limit utterances are skipped without automatic retry', async (t) => {
  const h = await harness(t, async () => ({ ok: false, code: 'offline', message: 'Offline' }));
  await enableChat(h);
  h.state.writePet('main', 'say', { text: 'x'.repeat(50_001) });
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'too_long');
  assert.equal(h.calls.length, 0);
  h.state.writePet('main', 'say', { text: 'Hello' });
  await setImmediate();
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'offline');
  assert.equal(
    h.calls.some((call) => call.operation === 'speak'),
    false,
  );
});

test('pet speech waits for an active motion request without authorizing another movement', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await enableChat(h);
  await h.arm();
  await h.execute();
  h.state.writePet('main', 'say', { text: 'Queued status feedback' });
  assert.equal(h.service.snapshot().chatSpeech?.state, 'queued');
  pending.resolve(success);
  await setImmediate();
  assert.equal(
    h.calls.some((call) => call.operation === 'speak'),
    true,
  );
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
});

test('unreadable robot receipts disable automatic chat forwarding as well as manual commands', async (t) => {
  const h = await harness(t);
  await enableChat(h);
  writeFileSync(join(h.root, 'astra-commands.json'), '{invalid');
  const robot = createRobotService(h.options);
  t.after(() => robot.dispose());
  assert.equal(robot.snapshot().error, 'robot_storage_unavailable');
  assert.equal(robot.beginChat('main'), undefined);
  assert.equal(h.calls.length, 0);
});

test('one opt-in speaks every new linked-pet utterance once, without history, clears or image-only events', async (t) => {
  const h = await harness(t);
  h.state.writePet('main', 'say', { text: 'Before enabling' });
  await enableChat(h);
  h.state.read();
  h.state.writePet('another-pet', 'say', { text: 'Not the linked pet' });
  h.state.writePet('main', 'say', { clear: true });
  h.state.writePet('main', 'say', { image: 'image.png' });
  h.state.writePet('main', 'anim', { text: 'Not speech' });
  for (const text of ['回答', '碎碎念', '梦话', '机器人状态', '同一句', '同一句'])
    h.state.writePet('main', 'say', { text });
  h.state.read();
  await setImmediate();
  assert.deepEqual(
    h.calls.filter((call) => call.operation === 'speak').map((call) => call.text),
    ['回答', '碎碎念', '梦话', '机器人状态', '同一句', '同一句'],
  );
  await h.service.submit({ action: 'configure', config: { ...h.service.snapshot().config, chatSpeech: false } });
  h.state.writePet('main', 'say', { text: 'After disabling' });
  await setImmediate();
  assert.equal(h.calls.filter((call) => call.operation === 'speak').length, 6);
});

test('long Unicode utterances are sent in order without truncation or split surrogate pairs', async (t) => {
  const h = await harness(t);
  await enableChat(h);
  const text = '中'.repeat(499) + '🐱' + '好'.repeat(700);
  h.state.writePet('main', 'say', { text });
  h.state.writePet('main', 'say', { text: '接下来的碎碎念' });
  await setImmediate();
  const speech = h.calls.filter((call) => call.operation === 'speak').map((call) => call.text!);
  assert.equal(speech.slice(0, -1).join(''), text);
  assert.equal(speech[speech.length - 1], '接下来的碎碎念');
  for (const chunk of speech) {
    assert.ok(chunk.length <= 500);
    assert.equal(chunk, Buffer.from(chunk, 'utf8').toString('utf8'));
  }
  assert.equal(h.service.snapshot().chatSpeech?.state, 'reported-success');
});

test('stop discards queued speech even when the old transport ignores cancellation', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) =>
    call.operation === 'speak' ? pending.promise : call.operation === 'status' ? healthy : success,
  );
  await enableChat(h);
  h.state.writePet('main', 'say', { text: 'Already sent' });
  await setImmediate();
  h.state.writePet('main', 'say', { text: 'Must not send after stop' });
  await h.service.submit({ action: 'stop' });
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.calls.filter((call) => call.operation === 'speak').length, 1);
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'cancelled');
});

test('uncertain speech is not retried and clears its remaining chunks and backlog', async (t) => {
  const h = await harness(t, async (_config, call) =>
    call.operation === 'status' ? healthy : { ok: false, code: 'timeout', message: 'Unknown playback' },
  );
  await enableChat(h);
  h.state.writePet('main', 'say', { text: '长'.repeat(1001) });
  h.state.writePet('main', 'say', { text: 'Queued' });
  await setImmediate();
  await h.service.submit({ action: 'check' });
  assert.equal(h.calls.filter((call) => call.operation === 'speak').length, 1);
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
});

test('speech queues are bounded and old messages expire instead of playing at a later exhibition moment', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await enableChat(h);
  await h.arm();
  await h.execute();
  h.state.writePet('main', 'say', { text: '字'.repeat(50_000) });
  h.state.writePet('main', 'say', { text: 'Queue overflow' });
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'queue_full');
  h.advance(120_001);
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().chatSpeech?.reason, 'expired');
  assert.equal(h.calls.filter((call) => call.operation === 'speak').length, 0);
});

test('robot status and action feedback are spoken, but TTS acknowledgement descriptions cannot echo forever', async (t) => {
  let telemetry = { ...healthy.telemetry! };
  let acknowledgements = 0;
  const h = await harness(
    t,
    async (_config, call) => {
      if (call.operation === 'status') return { ...healthy, telemetry: { ...telemetry } };
      if (call.operation === 'speak') telemetry.description = 'TTS acknowledgement ' + ++acknowledgements;
      return success;
    },
    true,
  );
  await enableChat(h);
  await h.service.submit({ action: 'check' });
  telemetry = { ...telemetry, actionCode: 520001, description: 'Robot working' };
  await h.service.submit({ action: 'check' });
  await setImmediate();
  for (let i = 0; i < 5; i++) {
    await h.service.submit({ action: 'check' });
    await setImmediate();
  }
  assert.deepEqual(
    h.calls.filter((call) => call.operation === 'speak').map((call) => call.text),
    ['Robot: Robot working'],
  );
  assert.equal(h.feedback.length, 1);
  telemetry = { ...telemetry, actionCode: 520000, description: 'Idle' };
  await h.service.submit({ action: 'check' });
  await setImmediate();
  await h.arm();
  await h.execute();
  await setImmediate();
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
  const spoken = h.calls.filter((call) => call.operation === 'speak').map((call) => call.text!);
  assert.ok(spoken.includes('Robot: Greet requested.'));
  assert.ok(spoken.some((text) => text.startsWith('Robot Greet: reported-success')));
  const count = spoken.length;
  await h.service.submit({ action: 'check' });
  await setImmediate();
  assert.equal(h.calls.filter((call) => call.operation === 'speak').length, count);
});

test('legacy SDK configuration is disabled but can be replaced with MCP configuration', async (t) => {
  const h = await harness(t);
  writeFileSync(
    join(h.root, 'astra-robot.json'),
    JSON.stringify({ enabled: true, python: 'bundled', address: 'localhost:50051', actions: [{ actionIds: [100] }] }),
  );
  const migrated = createRobotService(h.options);
  t.after(() => migrated.dispose());
  assert.equal(migrated.snapshot().config.enabled, false);
  assert.equal(migrated.snapshot().error, 'robot_mcp_setup_required');
  assert.deepEqual(migrated.snapshot().config.actions, []);
  await migrated.submit({
    action: 'configure',
    config: { ...defaultRobotConfig(), enabled: true, address: 'http://localhost:8182/mcp' },
  });
  assert.equal(migrated.snapshot().error, '');
});
