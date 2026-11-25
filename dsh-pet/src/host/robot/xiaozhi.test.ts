/** Exercise the XiaoZhi controller with the Go manager's HTTP response shapes. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PollStateStore } from '../state.ts';
import { defaultRobotConfig } from './config.ts';
import { createRobotService } from './service.ts';
import { runRobotWorker } from './worker.ts';
import type { RobotConfig } from '../../shared/robot.ts';

const deviceId = '9007199254740993123';
const toolName = 'self_arm_raise';
const apiRoot = '/api/open/v1/';
const config: RobotConfig = {
  ...defaultRobotConfig(),
  xiaozhi: { deviceId },
  enabled: true,
  chatActions: true,
  chatSpeech: true,
  actions: [
    { key: 'raise', name: '抬手', tool: 'xiaozhiMcp', target: toolName, arguments: { arm: 'left' }, petAnimation: '' },
  ],
};

async function mockManager(t: TestContext, options: { isError?: boolean } = {}) {
  const requests: { path: string; method: string; token?: string | string[]; body?: unknown }[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? '';
    const method = request.method ?? '';
    const raw = await new Promise<string>((resolve, reject) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (body += chunk));
      request.once('end', () => resolve(body));
      request.once('error', reject);
    });
    requests.push({ path, method, token: request.headers['x-api-token'], body: raw ? JSON.parse(raw) : undefined });
    response.setHeader('Content-Type', 'application/json');
    if (path === `${apiRoot}devices/${deviceId}/mcp-tools` && method === 'GET') {
      response.end(
        JSON.stringify({
          data: {
            tools: [
              {
                name: toolName,
                input_schema: {
                  type: 'object',
                  properties: { arm: { type: 'string', enum: ['left', 'right'] } },
                  required: ['arm'],
                  additionalProperties: false,
                },
              },
            ],
          },
        }),
      );
    } else if (path === `${apiRoot}devices/${deviceId}/mcp-call` && method === 'POST') {
      response.end(
        JSON.stringify({
          data: {
            result: JSON.stringify({
              content: [{ type: 'text', text: 'test tool receipt' }],
              isError: options.isError ?? false,
            }),
          },
        }),
      );
    } else if (path === `${apiRoot}devices` && method === 'GET') {
      response.end(JSON.stringify({ data: [{ id: deviceId, device_name: 'test-device' }] }));
    } else if (path === `${apiRoot}devices/inject-message` && method === 'POST') {
      response.end(JSON.stringify({ success: true }));
    } else {
      response.writeHead(404).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const socketAddress = server.address();
  assert.ok(socketAddress && typeof socketAddress !== 'string');
  const previousUrl = process.env.DSH_PET_XIAOZHI_OPENAPI_URL;
  const previousToken = process.env.DSH_PET_XIAOZHI_API_TOKEN;
  process.env.DSH_PET_XIAOZHI_OPENAPI_URL = `http://127.0.0.1:${socketAddress.port}${apiRoot}`;
  process.env.DSH_PET_XIAOZHI_API_TOKEN = 'test-token';
  t.after(() => {
    if (previousUrl === undefined) delete process.env.DSH_PET_XIAOZHI_OPENAPI_URL;
    else process.env.DSH_PET_XIAOZHI_OPENAPI_URL = previousUrl;
    if (previousToken === undefined) delete process.env.DSH_PET_XIAOZHI_API_TOKEN;
    else process.env.DSH_PET_XIAOZHI_API_TOKEN = previousToken;
  });
  return requests;
}

async function waitFor(predicate: () => boolean) {
  const deadline = AbortSignal.timeout(3000);
  while (!predicate()) await setImmediate(undefined, { signal: deadline });
}

test('XiaoZhi sends the pet utterance verbatim and waits for confirmation before a mapped action', async (t) => {
  const requests = await mockManager(t);
  const root = mkdtempSync(join(tmpdir(), 'xiaozhi-robot-'));
  const state = new PollStateStore();
  const service = createRobotService({ userRoot: root, state });
  t.after(async () => {
    await service.dispose();
    rmSync(root, { force: true, recursive: true });
  });
  await service.submit({ action: 'configure', config });
  const chat = await service.prepareChat('main');
  assert.ok(chat);
  assert.deepEqual(chat.actions, [{ key: 'raise', name: '抬手' }]);
  assert.deepEqual(service.snapshot().catalog?.xiaozhiTools, [
    { name: toolName, arguments: ['arm'], required: ['arm'] },
  ]);
  service.completeChat(chat, { text: '我来抬手。', actionKey: 'raise' });
  state.writePet('main', 'say', { text: '我来抬手。' });
  await waitFor(() => service.snapshot().chatSpeech?.state === 'reported-success');
  assert.deepEqual(
    requests.filter(({ method }) => method === 'POST').map(({ body }) => body),
    [{ device_id: 'test-device', message: '我来抬手。', mode: 'notify', skip_llm: true, auto_listen: false }],
  );
  const { session, pendingAction } = service.snapshot();
  assert.ok(pendingAction);
  await service.submit({ action: 'confirm-chat-action', session, id: pendingAction.id, confirmed: true });
  await waitFor(() =>
    service.snapshot().commands.some(({ kind, state }) => kind === 'execute' && state === 'reported-success'),
  );
  assert.deepEqual(
    requests.filter(({ path }) => path.endsWith('/mcp-call')).map(({ body }) => body),
    [{ tool_name: toolName, arguments: { arm: 'left' } }],
  );
  assert.ok(requests.every(({ token }) => token === 'test-token'));
  assert.equal(JSON.stringify(service.snapshot()).includes('test-token'), false);
});

test('XiaoZhi rejects invalid arguments before dispatch and keeps a device tool error uncertain', async (t) => {
  const requests = await mockManager(t, { isError: true });
  const call = { operation: 'execute', tool: 'xiaozhiMcp', target: toolName } as const;
  const invalid = await runRobotWorker(config, { ...call, arguments: { arm: 1 } });
  assert.equal(invalid.code, 'invalid_target');
  assert.equal(
    requests.some(({ method }) => method === 'POST'),
    false,
  );
  const failed = await runRobotWorker(config, { ...call, arguments: { arm: 'right' } });
  assert.equal(failed.code, 'execution_unknown');
  assert.equal(requests.filter(({ method }) => method === 'POST').length, 1);
});
