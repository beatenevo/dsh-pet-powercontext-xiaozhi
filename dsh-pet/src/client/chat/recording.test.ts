/** Recording lifecycle contracts: explicit recognition, cancellation races, silence and resource cleanup. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecording, type RecordingPorts } from './recording.ts';
import { MAX_RECORD_MS, type HearRecorder } from '../../shared/hear.ts';

/** Fake microphone and recognizer record effects without device access or API charges. */
function harness() {
  const phases: string[] = [];
  const errors: string[] = [];
  const texts: string[] = [];
  let calls = 0;
  let cancelled = 0;
  const recorder: HearRecorder = {
    elapsedMs: () => 1000,
    stop: async () => ({ wave: new Uint8Array([1, 2, 3]), peak: 0.4 }),
    cancel: () => {
      cancelled++;
    },
  };
  const ports: RecordingPorts = {
    available: () => true,
    start: async () => recorder,
    hear: async () => {
      calls++;
      return { ok: true, text: 'hello' };
    },
    phase: (phase) => {
      phases.push(phase);
    },
    error: (message) => {
      errors.push(message);
    },
    append: (text) => {
      texts.push(text);
    },
  };
  return { ports, recorder, phases, errors, texts, calls: () => calls, cancelled: () => cancelled };
}

test('only explicit stop transcribes once and returns text for review', async () => {
  const h = harness();
  const recording = createRecording(h.ports);
  await recording.toggle();
  assert.equal(h.calls(), 0);
  assert.equal(recording.active(), true);
  await Promise.all([recording.toggle(), recording.toggle()]);
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.texts, ['hello']);
  assert.deepEqual(h.phases, ['permission', 'recording', 'recognizing', 'ready']);
  assert.equal(recording.active(), false);
  assert.equal(h.cancelled(), 1);
});

test('cancel during permission acquisition releases a late microphone', async () => {
  const h = harness();
  let grant!: (recorder: HearRecorder) => void;
  h.ports.start = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const recording = createRecording(h.ports);
  const pending = recording.toggle();
  recording.cancel(false);
  grant(h.recorder);
  await pending;
  assert.equal(h.cancelled(), 1);
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.phases, ['permission']);
});

test('cancel aborts recognition and ignores late results', async () => {
  const h = harness();
  let finish!: (value: { ok: true; text: string }) => void;
  let signal: AbortSignal | undefined;
  h.ports.hear = (_audio, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const recording = createRecording(h.ports);
  await recording.toggle();
  const pending = recording.toggle();
  await Promise.resolve();
  recording.cancel();
  assert.equal(signal?.aborted, true);
  finish({ ok: true, text: 'stale' });
  await pending;
  assert.deepEqual(h.texts, []);
});

test('short or silent recordings never call recognition', async () => {
  for (const short of [true, false]) {
    const h = harness();
    if (short) h.recorder.elapsedMs = () => 100;
    else h.recorder.stop = async () => ({ wave: new Uint8Array(), peak: 0 });
    const recording = createRecording(h.ports);
    await recording.toggle();
    await recording.toggle();
    assert.equal(h.calls(), 0);
    assert.deepEqual(h.errors, ['silent']);
  }
});

test('unsupported, permission denied and provider failures remain recoverable without retries', async () => {
  for (const kind of ['unsupported', 'permission', 'failed'] as const) {
    const h = harness();
    if (kind === 'unsupported') h.ports.available = () => false;
    if (kind === 'permission')
      h.ports.start = async () => {
        throw new Error('denied');
      };
    if (kind === 'failed') h.ports.hear = async () => ({ ok: false, reason: 'unsupported', message: 'no provider' });
    const recording = createRecording(h.ports);
    await recording.toggle();
    if (kind === 'failed') await recording.toggle();
    assert.deepEqual(h.errors, [kind]);
    assert.equal(recording.active(), false);
    assert.deepEqual(h.texts, []);
  }
});

test('duration limit releases microphone without paid recognition', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const recording = createRecording(h.ports);
  await recording.toggle();
  t.mock.timers.tick(MAX_RECORD_MS);
  assert.equal(recording.active(), false);
  assert.equal(h.cancelled(), 1);
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.errors, ['limit']);
});
