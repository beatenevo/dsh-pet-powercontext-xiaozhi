import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { PetObservability } from './service.ts';
import { DEFAULT_OBSERVABILITY } from '../../shared/observability.ts';

const agentId = '11111111-1111-4111-8111-111111111111';
const spaceId = '22222222-2222-4222-8222-222222222222';
const settings = {
  enabled: true,
  baseUrl: 'https://vision.example',
  agentId,
  spaceId,
  allowInsecureHttp: false,
  spaceKey: 'private-test-key',
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pet-observability-'));
  const service = new PetObservability(root);
  t.after(async () => {
    await service.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  return { root, service };
}

test('disabled observation preserves results and exceptions without configuring the host provider', async (t) => {
  const { service } = await fixture(t);
  const provider = trace.getTracerProvider();
  assert.equal(await service.run('chat', async () => 42), 42);
  const failure = new Error('original exception');
  await assert.rejects(
    service.run('chat', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(service.reference(), undefined);
  assert.deepEqual(service.snapshot().interactions, []);
  assert.equal(trace.getTracerProvider(), provider);
});

test('credentials are write-only, private on disk, and never reused for a new destination', async (t) => {
  const { service, root } = await fixture(t);
  service.configure(settings);
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /private-test-key/);
  const path = join(root, 'observability.json');
  assert.match(await readFile(path, 'utf8'), /private-test-key/);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.throws(
    () => service.configure({ ...settings, baseUrl: 'https://other.example', spaceKey: undefined }),
    /key_required/,
  );
  assert.throws(() => service.configure({ ...settings, baseUrl: 'https://user:password@vision.example' }));
  assert.throws(() => service.configure({ ...settings, baseUrl: 'http://vision.example' }));
  assert.throws(() => service.configure({ ...settings, baseUrl: 'https://vision.example?secret=value' }));
  service.configure({ ...settings, enabled: false, clearKey: true });
  assert.equal(service.snapshot().hasKey, false);
});

test('concurrent turns, delayed voice and background capture preserve actual causal identities and usage', async (t) => {
  const spans: ReadableSpan[] = [];
  t.mock.method(
    OTLPTraceExporter.prototype,
    'export',
    (batch: ReadableSpan[], done: (result: { code: number }) => void) => {
      spans.push(...batch);
      done({ code: 0 });
    },
  );
  const { service } = await fixture(t);
  const hostProvider = trace.getTracerProvider();
  service.configure(settings);
  let first: ReturnType<PetObservability['reference']>;
  let second: ReturnType<PetObservability['reference']>;
  await Promise.all([
    service.run(
      'chat',
      async () => {
        first = service.reference();
        await service.run(
          'model',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            service.usage({
              inputTokens: 10,
              outputTokens: 4,
              cacheReadTokens: 20,
              cacheWriteTokens: 3,
              prompt: 'never-export-content',
            });
          },
          { model: { provider: 'test', model: 'test-model' }, attempt: 1 },
        );
      },
      { conversationKey: 'private-local-partition-one' },
    ),
    service.run(
      'chat',
      async () => {
        second = service.reference();
        await service.run('model', async () => undefined, { model: { provider: 'test', model: 'test-model' } });
      },
      { conversationKey: 'private-local-partition-two' },
    ),
  ]);
  assert.ok(first && second);
  assert.notEqual(first.traceparent, second.traceparent);
  assert.notEqual(first.conversationId, second.conversationId);
  const firstTrace = first.traceparent.split('-')[1];
  await service.run('voice.speak', async () => ({ ok: true }), { parentInteractionId: firstTrace });
  await service.run('memory.capture', async () => undefined, { link: first });
  assert.equal((await service.check()).accepted, true);
  const model = spans.find((span) => span.name === 'dsh_pet.model' && span.spanContext().traceId === firstTrace)!;
  const voice = spans.find((span) => span.name === 'dsh_pet.voice.speak')!;
  const capture = spans.find((span) => span.name === 'dsh_pet.memory.capture')!;
  assert.equal(model.parentSpanContext?.spanId, first.traceparent.split('-')[2]);
  assert.equal(voice.spanContext().traceId, firstTrace);
  assert.equal(voice.parentSpanContext?.spanId, first.traceparent.split('-')[2]);
  assert.notEqual(capture.spanContext().traceId, firstTrace);
  assert.equal(capture.links[0].context.traceId, firstTrace);
  assert.equal(model.attributes['gen_ai.usage.input_tokens'], 33);
  assert.equal(model.attributes['gen_ai.usage.output_tokens'], 4);
  const unknown = spans.find((span) => span.name === 'dsh_pet.model' && span.spanContext().traceId !== firstTrace)!;
  assert.equal(unknown.attributes['gen_ai.usage.input_tokens'], undefined);
  assert.doesNotMatch(
    JSON.stringify(spans.map((span) => span.attributes)),
    /never-export-content|private-local|private-test-key/,
  );
  assert.equal(trace.getTracerProvider(), hostProvider);
});

test('real OTLP HTTP export authenticates, reports rejection and keeps business results available', async (t) => {
  const requests: Array<{ url?: string; authorization?: string; type?: string; body: Buffer }> = [];
  let status = 200;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    await once(request, 'end');
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      type: request.headers['content-type'],
      body: Buffer.concat(chunks),
    });
    response.writeHead(status, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { service } = await fixture(t);
  service.configure({ ...settings, baseUrl: `http://127.0.0.1:${address.port}` });
  assert.equal((await service.check()).accepted, true);
  assert.equal(requests[0].url, '/api/public/otel/v1/traces');
  assert.equal(requests[0].authorization, 'Basic ' + Buffer.from(agentId + ':private-test-key').toString('base64'));
  assert.equal(requests[0].type, 'application/x-protobuf');
  assert.ok(requests[0].body.includes(Buffer.from('dsh_pet.connection.check')));
  assert.ok(!requests[0].body.includes(Buffer.from('private-test-key')));
  status = 401;
  assert.deepEqual(await service.run('chat', async () => ({ ok: true, text: 'private-reply' })), {
    ok: true,
    text: 'private-reply',
  });
  assert.equal((await service.check()).accepted, false);
  assert.equal(service.snapshot().error, 'export_failed');
  for (const request of requests) assert.ok(!request.body.includes(Buffer.from('private-reply')));
  service.configure({ ...DEFAULT_OBSERVABILITY });
  assert.equal(await service.run('chat', async () => 'still available'), 'still available');
});

test('robot observation waits for the worker result instead of treating queue admission as success', async (t) => {
  const { createRobotService } = await import('../robot/service.ts');
  const { defaultRobotConfig } = await import('../robot/config.ts');
  const { setImmediate } = await import('node:timers/promises');
  const { service, root } = await fixture(t);
  t.mock.method(
    OTLPTraceExporter.prototype,
    'export',
    (_batch: ReadableSpan[], done: (result: { code: number }) => void) => done({ code: 0 }),
  );
  service.configure(settings);
  let finish!: () => void;
  const { PollStateStore } = await import('../state.ts');
  const robot = createRobotService({
    userRoot: root,
    state: new PollStateStore(),
    observability: service,
    run: async (_config, call) => {
      if (call.operation === 'status')
        return {
          ok: true,
          code: 'status',
          message: 'ready',
          telemetry: { actionCode: 520000, description: 'idle', modes: [1] },
        };
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: false, code: 'transport_error', message: 'private worker detail' };
    },
  });
  t.after(() => robot.dispose());
  await robot.submit({
    action: 'configure',
    config: {
      ...defaultRobotConfig(),
      enabled: true,
      address: 'http://127.0.0.1:8182/mcp',
      actions: [{ key: 'greet', name: 'Greet', tool: 'startTeachProgram', target: '100', petAnimation: '' }],
    },
  });
  await robot.submit({ action: 'check' });
  const session = robot.snapshot().session;
  await robot.submit({ action: 'arm', session, confirmed: true });
  const queued = await robot.submit({
    action: 'execute',
    session,
    id: '11111111-1111-4111-8111-111111111111',
    key: 'greet',
    petId: 'main',
    confirmed: true,
  });
  assert.equal(queued.busy, true);
  assert.equal(service.snapshot().interactions[0].outcome, 'running');
  finish();
  await setImmediate();
  assert.equal(service.snapshot().interactions[0].outcome, 'error');
  assert.equal(robot.snapshot().commands[0].state, 'unknown');
});
