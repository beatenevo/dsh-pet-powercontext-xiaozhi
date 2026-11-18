/** Exercise live rotation across both carriers, persistence, cookies and desktop request injection. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createRequestSecurity } from './request-security.ts';
import { listenStandaloneServer } from './server.ts';
import { startRouter } from '../app/router.ts';
import { installDesktopAuth, type DesktopSession } from '../app/desktop-auth.ts';

for (const carrier of ['app', 'standalone'] as const) {
  test(`${carrier}: rotate without restart, revoke old headers/cookies, persist and keep desktop authenticated`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'pet-token-'));
    const file = join(home, 'access-token.json');
    const security = createRequestSecurity({ file });
    const old = security.token;
    const next = 'n'.repeat(43);
    const logger = { info() {}, warn() {}, debug() {}, error() {} };
    const server =
      carrier === 'app'
        ? await startRouter([], { security, log() {}, status: () => ({}), landingPage: () => '' })
        : await listenStandaloneServer({ routes: [], security, logger, port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const endpoint = origin + '/standalone-ai/access-token';
    const put = (token: string, value: string, extra: Record<string, string> = {}) =>
      fetch(endpoint, {
        method: 'PUT',
        headers: { 'X-DSH-Pet-Token': token, 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify({ token: value }),
      });
    try {
      assert.equal((await put('', next)).status, 403);
      assert.equal((await put(old, next, { Origin: 'https://evil.invalid' })).status, 403);
      assert.equal((await put(old, 'bad')).status, 400);
      assert.equal(security.token, old);
      const response = await put(old, next);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.match(response.headers.get('set-cookie')!, new RegExp(`dsh_pet_token=${next}`));
      assert.equal(security.token, next);
      assert.equal(createRequestSecurity({ file }).token, next);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal((await put(old, old)).status, 403);
      assert.equal((await fetch(endpoint, { headers: { Cookie: `dsh_pet_token=${old}` } })).status, 403);
      assert.equal((await fetch(endpoint, { headers: { Cookie: `dsh_pet_token=${next}` } })).status, 405);
      assert.ok(security.authenticatedUrl(origin).endsWith('#token=' + next));
      let listener: Parameters<DesktopSession['webRequest']['onBeforeSendHeaders']>[0] | undefined;
      const renderer = resolve('runtime/electron-helper/index.html');
      installDesktopAuth(
        {
          webRequest: {
            onBeforeSendHeaders(fn) {
              listener = fn;
            },
          },
        },
        origin,
        renderer,
        () => security.token,
      );
      let headers: Record<string, string> = {};
      listener!(
        {
          url: origin + '/dsh-pet-7340/chat',
          requestHeaders: {},
          frame: { url: pathToFileURL(renderer).href, parent: null },
        },
        (result) => {
          headers = result.requestHeaders;
        },
      );
      assert.equal(headers['X-DSH-Pet-Token'], next);
      // Existing interceptors must read the new token, not capture the previous one.
      security.rotate('z'.repeat(43));
      listener!(
        {
          url: origin + '/dsh-pet-7340/chat',
          requestHeaders: {},
          frame: { url: pathToFileURL(renderer).href, parent: null },
        },
        (result) => {
          headers = result.requestHeaders;
        },
      );
      assert.equal(headers['X-DSH-Pet-Token'], security.token);
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test('failed persistence or local synchronization leaves the old token active', () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-token-'));
  try {
    const file = join(home, 'blocked');
    const security = createRequestSecurity({ file });
    const old = security.token;
    mkdirSync(file);
    assert.throws(() => security.rotate('n'.repeat(43)));
    assert.equal(security.token, old);
    const saved = join(home, 'saved.json');
    const rollback = createRequestSecurity({
      file: saved,
      onRotate() {
        throw new Error('consumer failed');
      },
    });
    assert.throws(() => rollback.rotate('n'.repeat(43)));
    assert.equal(createRequestSecurity({ file: saved }).token, rollback.token);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the desktop main-process bridge uses the current credential for every request', async () => {
  const { createRequire } = await import('node:module');
  const { createBridge } = createRequire(import.meta.url)('../../runtime/electron-helper/main/bridge.js') as {
    createBridge(deps: { isBridge: boolean; prefix: string; origin: string; token: () => string }): {
      hostRequest(method: string, path: string): Promise<{ status: number }>;
    };
  };
  const security = createRequestSecurity();
  const server = await startRouter(
    [
      {
        kind: 'exact',
        path: '/dsh-pet-7340/private',
        handler: async (_req, res) => {
          res.writeHead(200);
          res.end('ok');
        },
      },
    ],
    {
      security,
      log() {},
      status: () => ({}),
      landingPage: () => '',
    },
  );
  try {
    const bridge = createBridge({
      isBridge: false,
      prefix: '',
      origin: `http://127.0.0.1:${server.port}`,
      token: () => security.token,
    });
    assert.equal((await bridge.hostRequest('GET', '/dsh-pet-7340/private')).status, 200);
    security.rotate('y'.repeat(43));
    assert.equal((await bridge.hostRequest('GET', '/dsh-pet-7340/private')).status, 200);
  } finally {
    await server.close();
  }
});
