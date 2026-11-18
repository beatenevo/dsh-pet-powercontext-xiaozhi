/** 用真实 HTTP 验证 MCP 初始化、会话、目录与执行边界。 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runRobotWorker } from './mcp.ts';
import { defaultRobotConfig } from './config.ts';

const programId = '9223372036854775807';
async function server(
  t: TestContext,
  options: {
    sse?: boolean;
    structured?: boolean;
    failList?: boolean;
    failCall?: boolean;
    slow?: boolean;
    schemaMismatch?: boolean;
  } = {},
) {
  const calls: { method: string; params?: { name: string; arguments: Record<string, string> } }[] = [];
  let initialized = false;
  let deleted = false;
  const http = createServer(async (req, res) => {
    if (req.method === 'DELETE') {
      deleted = true;
      res.writeHead(200).end();
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    await once(req, 'end');
    const message = JSON.parse(body);
    calls.push(message);
    if (message.method !== 'initialize') assert.equal(req.headers['mcp-session-id'], 'robot-session');
    if (message.method === 'notifications/initialized') {
      initialized = true;
      res.writeHead(202).end();
      return;
    }
    if (!('id' in message)) {
      res.writeHead(202).end();
      return;
    }
    let result: unknown;
    if (message.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', 'robot-session');
      result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'robot', version: '1' },
      };
    } else {
      assert.equal(initialized, true);
      if (message.method === 'tools/list')
        result = {
          tools: [
            ...['getTeachProgramList', 'getAreaInfo'].map((name) => ({
              name,
              inputSchema: { type: 'object', properties: {} },
            })),
            ...[
              ['startTeachProgram', 'teachProgramId'],
              ['RobotAgvMove', 'station'],
              ['textToSpeech', 'text'],
            ].map(([name, field]) => ({
              name,
              inputSchema: {
                type: 'object',
                properties: { [field]: { type: options.schemaMismatch ? 'number' : 'string' } },
                required: [field],
              },
            })),
          ],
        };
      else {
        const name = message.params.name;
        const isList = name === 'getTeachProgramList' || name === 'getAreaInfo';
        if (options.slow && !isList) return;
        const data =
          name === 'getTeachProgramList'
            ? [{ id: programId, name: 'Welcome' }]
            : [{ areaName: 'Reception', parameter: 'A01' }];
        result = isList
          ? options.failList
            ? { isError: true, content: [{ type: 'text', text: 'query failed' }] }
            : options.structured
              ? { content: [], structuredContent: { result: data } }
              : { content: [{ type: 'text', text: JSON.stringify(data) }] }
          : { isError: !!options.failCall, content: name === 'textToSpeech' ? [] : [{ type: 'text', text: '完成' }] };
      }
    }
    const response = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
    res.setHeader('Content-Type', options.sse ? 'text/event-stream' : 'application/json');
    res.end(options.sse ? `event: message\ndata: ${response}\n\n` : response);
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => {
    http.closeAllConnections();
    http.close();
  });
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  return {
    config: { ...defaultRobotConfig(), address: `http://127.0.0.1:${address.port}/mcp` },
    calls,
    deleted: () => deleted,
  };
}

for (const sse of [false, true])
  test(`initialize and preserve program IDs over ${sse ? 'SSE' : 'JSON'}`, async (t) => {
    const h = await server(t, { sse });
    const result = await runRobotWorker(h.config, {
      operation: 'execute',
      tool: 'startTeachProgram',
      target: programId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      h.calls.filter((c) => c.method === 'tools/call').map((c) => c.params),
      [
        { name: 'getTeachProgramList', arguments: {} },
        { name: 'startTeachProgram', arguments: { teachProgramId: programId } },
      ],
    );
    assert.equal(h.deleted(), true);
  });

test('structured catalog, AGV mapping and empty speech success', async (t) => {
  const h = await server(t, { structured: true });
  const status = await runRobotWorker(h.config, { operation: 'status' });
  assert.equal(status.catalog?.programs[0].id, programId);
  assert.ok(status.catalog?.tools?.includes('getTeachProgramList'));
  assert.ok(status.catalog?.tools?.includes('startTeachProgram'));
  assert.equal(status.telemetry, undefined);
  assert.equal(
    (await runRobotWorker(h.config, { operation: 'execute', tool: 'RobotAgvMove', target: 'A01' })).ok,
    true,
  );
  assert.equal((await runRobotWorker(h.config, { operation: 'speak', text: 'Hello' })).ok, true);
  assert.deepEqual(h.calls.find((c) => c.params?.name === 'RobotAgvMove')?.params?.arguments, { station: 'A01' });
});

test('query errors and runtime schema mismatch never send movement', async (t) => {
  for (const options of [{ failList: true }, { schemaMismatch: true }]) {
    const h = await server(t, options);
    assert.equal(
      (await runRobotWorker(h.config, { operation: 'execute', tool: 'startTeachProgram', target: programId })).ok,
      false,
    );
    assert.equal(
      h.calls.some((c) => c.params?.name === 'startTeachProgram'),
      false,
    );
  }
});

test('unlisted targets cannot execute and tool failures remain uncertain', async (t) => {
  const h = await server(t, { failCall: true });
  assert.equal(
    (await runRobotWorker(h.config, { operation: 'execute', tool: 'startTeachProgram', target: '2' })).code,
    'invalid_target',
  );
  assert.equal(
    (await runRobotWorker(h.config, { operation: 'execute', tool: 'startTeachProgram', target: programId })).code,
    'execution_unknown',
  );
  assert.equal(h.calls.filter((c) => c.params?.name === 'startTeachProgram').length, 1);
});

test('timeout never replays commands and cancellation cannot claim a stop', async (t) => {
  const h = await server(t, { slow: true });
  const result = await runRobotWorker(
    { ...h.config, timeoutSeconds: 0.3 },
    { operation: 'execute', tool: 'startTeachProgram', target: programId },
  );
  assert.equal(result.code, 'timeout');
  assert.equal(h.calls.filter((c) => c.params?.name === 'startTeachProgram').length, 1);
  const count = h.calls.length;
  assert.equal((await runRobotWorker(h.config, { operation: 'stop' })).code, 'stop_unsupported');
  assert.equal(h.calls.length, count);
});

test('a host-validated catalog avoids a duplicate directory call before dispatch', async (t) => {
  const h = await server(t);
  const discovery = await runRobotWorker(h.config, { operation: 'status' });
  assert.ok(discovery.catalog);
  const result = await runRobotWorker(h.config, {
    operation: 'execute',
    tool: 'startTeachProgram',
    target: programId,
    catalog: discovery.catalog,
  });
  assert.equal(result.ok, true);
  assert.equal(h.calls.filter((call) => call.params?.name === 'getTeachProgramList').length, 1);
  assert.equal(h.calls.filter((call) => call.params?.name === 'startTeachProgram').length, 1);
});
