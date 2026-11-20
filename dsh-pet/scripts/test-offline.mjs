#!/usr/bin/env node
/** 在空 npm 缓存中安装并搬移离线包，验证插件安装器和真实 seekdb/Trace 集成。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = resolve(process.argv[2]);
const release = join(output, 'release');
const archive = readdirSync(release).find((name) => name.endsWith('-offline.tgz'));
assert.ok(archive);
assert.equal(
  createHash('sha256')
    .update(readFileSync(join(release, archive)))
    .digest('hex'),
  readFileSync(join(release, archive + '.sha256'), 'utf8').split(/\s+/)[0],
  'Archive checksum mismatch',
);
const install = join(output, 'offline install with spaces');
mkdirSync(install);
const env = {
  ...process.env,
  npm_config_cache: join(output, 'empty-npm-cache'),
  npm_config_offline: 'true',
  DSH_SEEKDB_INTEGRATION: '1',
  DSH_SEEKDB_TEST_DIRECTORY: join(output, 'persisted-seekdb'),
  UV_OFFLINE: '1',
  UV_PYTHON_DOWNLOADS: 'never',
  PIP_NO_INDEX: '1',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: 'localhost,127.0.0.1,::1',
  DSH_HOME: join(output, 'smoke-home'),
};
/** 输出仅包含无密钥的构建和验收信息。 */
function run(command, args, cwd = install) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 600_000 });
  assert.equal(result.status, 0, String(result.error || 'offline smoke failed'));
}
run(process.execPath, [
  process.env.npm_execpath,
  'install',
  '--offline',
  '--ignore-scripts',
  '--omit=dev',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  join(release, archive),
]);
const moved = join(output, 'relocated install');
renameSync(install, moved);
// Node 不直接加载 node_modules 中的 TypeScript；将完整包移到独立目录检验可搬移性。
const installed = join(output, 'relocated plugin');
renameSync(join(moved, 'node_modules', 'dsh-pet-powercontext'), installed);
run(process.execPath, [join(installed, 'lib', 'standalone.js'), '--check'], moved);
const installer = pathToFileURL(join(installed, 'src', 'standalone', 'memory-install.ts')).href;
run(
  process.execPath,
  [
    '--experimental-strip-types',
    '--input-type=module',
    '-e',
    `
  import { installMemoryRuntime } from ${JSON.stringify(installer)};
  const python = await installMemoryRuntime(${JSON.stringify(join(output, 'user-data'))}, new AbortController().signal, console.log, 'seekdb');
  if (!python.includes('runtime')) throw new Error('Did not use bundled runtime');
`,
  ],
  moved,
);
const python = join(
  installed,
  'runtime',
  'offline',
  'python',
  process.platform === 'win32' ? 'python.exe' : 'bin/python3.12',
);
const tests = resolve('runtime/powercontext');
// Python 层禁止所有非回环连接，确保集成测试不会借助远端服务。
const networkGuard = `
import socket, sys
original = socket.socket.connect
def local_only(self, address):
    if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1', 'localhost'):
        raise RuntimeError('Network forbidden during offline smoke')
    return original(self, address)
socket.socket.connect = local_only
sys.path.insert(0, ${JSON.stringify(tests)})
`;
run(
  python,
  [
    '-I',
    '-B',
    '-c',
    networkGuard +
      `
import unittest
suite = unittest.defaultTestLoader.discover(${JSON.stringify(tests)}, pattern='test_*.py')
result = unittest.TextTestRunner(verbosity=2).run(suite)
assert not result.skipped, 'Offline validation must not skip native seekdb tests'
sys.exit(not result.wasSuccessful())
`,
  ],
  moved,
);
// 第二个解释器进程重新打开同一数据库，不能靠上一进程的内存状态通过。
run(
  python,
  [
    '-I',
    '-B',
    '-c',
    networkGuard +
      `
import os
from pathlib import Path
from test_seekdb_integration import FixtureEmbedding, SeekDBConfig, ServerSettings, McpConfig, create_server_app, TestClient
root = Path(os.environ['DSH_SEEKDB_TEST_DIRECTORY'])
settings = ServerSettings(workspace=root, database=SeekDBConfig(path=root / 'db'), mcp=McpConfig(enabled=False))
with TestClient(create_server_app(settings=settings, embedding_model=FixtureEmbedding())) as client:
    response = client.get('/v1/scopes')
    assert response.status_code == 200, response.text
    scopes = [scope for scope in response.json()['items'] if scope.get('title') == 'seekdb integration']
    assert scopes, 'Persisted scopes missing after restart'
    response = client.post('/v1/memory/search', json={'scope_id': scopes[0]['scope_id'], 'query': 'emergency card', 'mode': 'vector', 'limit': 5})
    assert response.status_code == 200 and 'second drawer' in response.text, response.text
print('Validated persisted vector recall after process restart')
`,
  ],
  moved,
);
