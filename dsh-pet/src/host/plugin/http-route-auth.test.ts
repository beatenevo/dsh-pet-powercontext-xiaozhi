/** Exercise the actual HTTP boundary: DSH cookies/tokens gate pet data and writes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { registerHttpRoute } from './http-route.ts';

test('denies unauthenticated reads and writes before reaching the pet or shared memory', async () => {
  let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  let calls = 0;
  registerHttpRoute(
    {
      get: () => ({
        requestRejection: (req: IncomingMessage) => (req.headers.authorization === 'Bearer fixture' ? undefined : 401),
      }),
      effect: (callback: () => unknown) => callback(),
      webServer: {
        register: (route: { handler: typeof handler }) => {
          handler = route.handler;
          return () => {};
        },
      },
    },
    async () => {
      calls++;
      return { kind: 'json', status: 200, obj: { ok: true } };
    },
  );
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/dsh-pet-7340`;
  try {
    for (const path of ['/chat?pet=main', '/chat/powercontext?pet=main', '/state', '/config']) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    assert.equal((await fetch(base + '/chat?pet=main', { method: 'POST', body: '{"text":"hello"}' })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(base + '/chat?pet=main', { headers: { authorization: 'Bearer fixture' } })).status, 200);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
