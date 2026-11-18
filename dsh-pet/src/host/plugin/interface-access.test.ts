/** Real HTTP checks for DSH-managed API credentials, rotation, persistence and session isolation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPluginAccess } from './interface-access.ts';
import { registerHttpRoute } from './http-route.ts';

test('DSH sessions rotate persistent API credentials without disconnecting existing desktop requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-interface-'));
  const file = join(dir, 'token.json');
  const access = createPluginAccess(file);
  let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  let calls = 0;
  const trustedDesktopRequest = async () => {
    calls++;
    return { kind: 'json' as const, status: 200, obj: { ok: true } };
  };
  registerHttpRoute(
    {
      get: () => ({
        requestRejection: (req: IncomingMessage) => (req.headers.cookie === 'dsh=session' ? undefined : 401),
      }),
      effect: (callback: () => unknown) => callback(),
      webServer: {
        register: (route: { handler: typeof handler }) => {
          handler = route.handler;
          return () => {};
        },
      },
    },
    trustedDesktopRequest,
    access,
  );
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/dsh-pet-7340`;
  const session = { cookie: 'dsh=session' };
  const api = (token: string) => ({ 'x-dsh-pet-token': token });
  const save = (token: string, headers: Record<string, string> = session) =>
    fetch(base + '/access-token', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  try {
    assert.equal((await fetch(base + '/state')).status, 401);
    assert.deepEqual(await (await fetch(base + '/access-token', { headers: session })).json(), { configured: false });
    assert.equal((await save('A'.repeat(43), {})).status, 401);
    assert.equal((await save('invalid')).status, 400);
    assert.equal((await save('A'.repeat(43), { ...session, origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await save('A'.repeat(43))).status, 200);
    assert.equal((await fetch(base + '/chat?pet=main', { headers: api('A'.repeat(43)) })).status, 200);
    assert.equal((await save('B'.repeat(43), api('A'.repeat(43)))).status, 401);
    assert.equal(
      (await fetch(base + '/state', { headers: { ...api('A'.repeat(43)), origin: 'https://attacker.invalid' } }))
        .status,
      403,
    );
    assert.equal((await save('B'.repeat(43))).status, 200);
    assert.equal((await fetch(base + '/state', { headers: { ...session, ...api('A'.repeat(43)) } })).status, 403);
    assert.equal((await fetch(base + '/state', { headers: api('B'.repeat(43)) })).status, 200);
    assert.equal((await fetch(base + '/state', { headers: session })).status, 200);
    assert.equal((await trustedDesktopRequest()).status, 200);
    const status = await (await fetch(base + '/access-token', { headers: session })).text();
    assert.equal(status.includes('B'.repeat(43)), false);
    assert.equal(createPluginAccess(file).token, 'B'.repeat(43));
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    const failing = createPluginAccess(join(dir, 'blocked', 'token'));
    writeFileSync(join(dir, 'blocked'), 'not a directory');
    assert.throws(() => failing.rotate('C'.repeat(43)));
    assert.equal(failing.configured, false);
    assert.equal(calls, 4);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
