import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { MemoryCommandError, installMemoryRuntime, memoryProcessEnv, runMemoryCommand } from './memory-install.ts';

test('Python runtime accepts DSH IPv6 proxy bypasses without changing the host environment', () => {
  const previous = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
  try {
    // Windows 环境变量名不区分大小写，分别验证两种拼写，避免测试夹具互相覆盖。
    for (const [key, original, normalized] of [
      [
        'NO_PROXY',
        'localhost,127.0.0.1,::1,[::1],.example.com,192.168.0.0/16',
        'localhost,127.0.0.1,::1,::1,.example.com,192.168.0.0/16',
      ],
      ['no_proxy', ' [2001:db8::1],internal.example ', '2001:db8::1,internal.example'],
    ]) {
      process.env[key] = original;
      const env = memoryProcessEnv('/private/runtime');
      assert.equal(env[key], normalized);
      assert.equal(process.env[key], original);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test(
  'cancelling an installation stops descendants even when they ignore SIGTERM',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-install-cancel-'));
    const heartbeat = join(directory, 'heartbeat');
    const pidFile = join(directory, 'pid');
    const childScript = `const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 20);`;
    const script = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: 'ignore'}); setInterval(() => {}, 1000);`;
    t.after(() => {
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
        } catch {
          /* Gone. */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    });
    const controller = new AbortController();
    const job = runMemoryCommand(process.execPath, ['-e', script], process.env, controller.signal);
    const rejected = assert.rejects(job, { name: 'AbortError' });
    for (let i = 0; i < 100 && !existsSync(heartbeat); i++) await delay(20);
    assert.equal(existsSync(heartbeat), true);
    controller.abort();
    await rejected;
    await delay(50);
    const stopped = readFileSync(heartbeat, 'utf8');
    await delay(150);
    assert.equal(readFileSync(heartbeat, 'utf8'), stopped);
  },
);

// Linux 上用可执行替身检查 Windows 调度契约；不代表 Windows 系统验收。
test(
  'Windows seekdb validates its native Python runtime and rejects an unavailable ARM64 wheel',
  { skip: process.platform !== 'linux' },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-native-windows-'));
    const python = join(directory, 'venv', 'Scripts', 'python.exe');
    const capture = join(directory, 'arguments.json');
    mkdirSync(join(directory, 'venv', 'Scripts'), { recursive: true });
    writeFileSync(
      python,
      `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));
`,
      { mode: 0o700 },
    );
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      Object.defineProperty(process, 'arch', { value: 'x64' });
      const result = await installMemoryRuntime(directory, new AbortController().signal, undefined, 'seekdb');
      assert.equal(result, python);
      const args = JSON.parse(readFileSync(capture, 'utf8')) as string[];
      assert.equal(args[0], '-c');
      assert.match(args[1], /import uvicorn, pylibseekdb, pymysql/);
      assert.match(args[1], /assert version\("powercontext"\) == /);
      assert.doesNotMatch(args[1], /direct_url|commit_id/);
      Object.defineProperty(process, 'arch', { value: 'arm64' });
      await assert.rejects(
        installMemoryRuntime(directory, new AbortController().signal, undefined, 'seekdb'),
        /seekdb_unsupported_architecture/,
      );
    } finally {
      Object.defineProperty(process, 'platform', platform);
      Object.defineProperty(process, 'arch', arch);
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('failed installer reports safe exit metadata without command output', async () => {
  await assert.rejects(
    runMemoryCommand(
      process.execPath,
      ['-e', 'console.error("private-test-secret"); process.exit(23)'],
      process.env,
      new AbortController().signal,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MemoryCommandError);
      assert.equal(error.message, 'runtime_command_failed');
      assert.equal(error.exitCode, 23);
      assert.equal(error.exitSignal, null);
      assert.doesNotMatch(JSON.stringify(error), /private-test-secret/);
      return true;
    },
  );
});

test(
  'terminated interpreter preserves the signal for crash diagnosis',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      runMemoryCommand(
        process.execPath,
        ['-e', 'process.kill(process.pid, "SIGTERM")'],
        process.env,
        new AbortController().signal,
      ),
      (error: unknown) => error instanceof MemoryCommandError && error.exitSignal === 'SIGTERM',
    );
  },
);

for (const scenario of [
  'cached',
  'cache-miss',
  'incompatible',
  'crash',
  '3.11',
  '3.13',
  '3.14',
  '3.10',
  '3.15',
  'free-threaded',
  'pypy',
  'wrong-arch',
  'no-sqlite-extensions',
  'existing-no-sqlite-extensions',
] as const) {
  test(
    `runtime installation selects Python and preserves cache: ${scenario}`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const previousIndex = process.env.UV_DEFAULT_INDEX;
      const previousMirror = process.env.UV_PYTHON_INSTALL_MIRROR;
      process.env.UV_DEFAULT_INDEX = 'https://mirror.example/simple';
      process.env.UV_PYTHON_INSTALL_MIRROR = 'https://mirror.example/python';
      t.after(() => {
        if (previousIndex === undefined) delete process.env.UV_DEFAULT_INDEX;
        else process.env.UV_DEFAULT_INDEX = previousIndex;
        if (previousMirror === undefined) delete process.env.UV_PYTHON_INSTALL_MIRROR;
        else process.env.UV_PYTHON_INSTALL_MIRROR = previousMirror;
      });
      assert.equal(memoryProcessEnv('/runtime').UV_DEFAULT_INDEX, undefined);
      assert.equal(memoryProcessEnv('/runtime').UV_PYTHON_INSTALL_MIRROR, undefined);
      const rejected = [
        'incompatible',
        '3.10',
        '3.15',
        'free-threaded',
        'pypy',
        'wrong-arch',
        'no-sqlite-extensions',
        'existing-no-sqlite-extensions',
      ].includes(scenario);
      const runtime = {
        implementation: scenario === 'pypy' ? 'pypy' : 'cpython',
        major: 3,
        minor: scenario.startsWith('3.') ? Number(scenario.slice(2)) : 12,
        bits: 64,
        machine: scenario === 'wrong-arch' ? 'unsupported' : process.arch === 'arm64' ? 'aarch64' : 'x86_64',
        sqliteExtensions: !scenario.includes('no-sqlite-extensions'),
        freeThreaded: scenario === 'free-threaded',
      };
      const directory = mkdtempSync(join(tmpdir(), 'pet-python-reuse-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const capture = join(directory, 'commands.jsonl');
      const systemPython = join(directory, 'system python');
      const python = join(directory, 'venv', 'bin', 'python');
      const cache = join(directory, 'cache');
      mkdirSync(cache);
      writeFileSync(join(cache, 'existing-cache'), 'keep');
      mkdirSync(join(directory, 'uv'));
      writeFileSync(
        systemPython,
        `#!${process.execPath}
console.log(${JSON.stringify(JSON.stringify(runtime))});
process.exit(${scenario === 'incompatible' ? 1 : 0});
`,
        { mode: 0o700 },
      );
      writeFileSync(
        join(directory, 'uv', 'uv'),
        `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({args, index: process.env.UV_DEFAULT_INDEX, mirror: process.env.UV_PYTHON_INSTALL_MIRROR, cache: process.env.UV_CACHE_DIR, preference: process.env.UV_PYTHON_PREFERENCE, downloads: process.env.UV_PYTHON_DOWNLOADS}) + '\\n');
if (args[0] === 'python') console.log(${JSON.stringify(systemPython)});
if (args[0] === 'venv') {
  fs.mkdirSync(${JSON.stringify(join(directory, 'venv', 'bin'))}, {recursive: true});
  fs.writeFileSync(${JSON.stringify(python)}, '#!${process.execPath}\\n', {mode: 0o700});
}
if (args.includes('--offline') && args[0] === 'pip') {
  if (${JSON.stringify(scenario)} === 'cache-miss') process.exit(1);
  if (${JSON.stringify(scenario)} === 'crash') process.kill(process.pid, 'SIGTERM');
}
`,
        { mode: 0o700 },
      );
      if (scenario === 'existing-no-sqlite-extensions') {
        mkdirSync(join(directory, 'venv', 'bin'), { recursive: true });
        writeFileSync(python, `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o700 });
      }
      const stages: string[] = [];
      const job = installMemoryRuntime(
        directory,
        new AbortController().signal,
        (stage) => stages.push(stage),
        'seekdb',
      );
      if (scenario === 'crash')
        await assert.rejects(
          job,
          (error: unknown) => error instanceof MemoryCommandError && error.exitSignal === 'SIGTERM',
        );
      else assert.equal(await job, python);
      const calls = readFileSync(capture, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              args: string[];
              cache: string;
              preference: string;
              downloads?: string;
              index: string;
              mirror: string;
            },
        );
      assert.ok(calls.find((call) => call.args[0] === 'python')?.args.includes('cpython>=3.11,<3.15'));
      assert.ok(calls.every((call) => call.index === 'https://mirror.example/simple'));
      assert.ok(calls.every((call) => call.mirror === 'https://mirror.example/python'));
      const venv = calls.find((call) => call.args[0] === 'venv')!;
      assert.equal(venv.args[venv.args.indexOf('--python') + 1], rejected ? '3.12' : systemPython);
      assert.equal(venv.preference, rejected ? 'only-managed' : 'only-system');
      if (!rejected) assert.equal(venv.downloads, 'never');
      const installs = calls.filter((call) => call.args[0] === 'pip');
      assert.equal(installs.length, scenario === 'cache-miss' ? 2 : 1);
      assert.equal(installs[0].args.includes('--offline'), true);
      assert.ok(installs.every((call) => call.cache === cache));
      assert.equal(readFileSync(join(cache, 'existing-cache'), 'utf8'), 'keep');
      assert.ok(stages.includes(rejected ? 'installing_python' : 'reusing_python'));
      assert.equal(stages.includes('installing_memory'), scenario === 'cache-miss');
      assert.equal(stages.includes('validating_runtime'), scenario !== 'crash');
      if (scenario !== 'crash') {
        const before = calls.length;
        assert.equal(await installMemoryRuntime(directory, new AbortController().signal), python);
        assert.equal(readFileSync(capture, 'utf8').trim().split('\n').length, before);
      }
    },
  );
}

// 可执行替身验证下载调度与校验边界，不访问外部镜像。
test(
  'mirrored uv downloads retain checksum verification and bounded retries',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-uv-mirror-'));
    const bin = join(directory, 'commands');
    const capture = join(directory, 'curl.json');
    const extracted = join(directory, 'extracted');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'curl'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
fs.writeFileSync(args[args.indexOf('--output') + 1], 'tampered archive');
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(bin, 'tar'),
      `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(extracted)}, 'unexpected');
`,
      { mode: 0o700 },
    );
    const previous = { PATH: process.env.PATH, DSH_PET_UV_DOWNLOAD_BASE_URL: process.env.DSH_PET_UV_DOWNLOAD_BASE_URL };
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    });
    process.env.PATH = bin;
    process.env.DSH_PET_UV_DOWNLOAD_BASE_URL = 'https://mirror.example/uv/';
    await assert.rejects(installMemoryRuntime(directory, new AbortController().signal), {
      message: 'download_checksum_failed',
    });
    const args = JSON.parse(readFileSync(capture, 'utf8')) as string[];
    assert.match(args[args.length - 1], /^https:\/\/mirror\.example\/uv\/0\.9\.26\/uv-/);
    assert.equal(args[args.indexOf('--proto') + 1], '=https');
    assert.equal(args[args.indexOf('--proto-redir') + 1], '=https');
    assert.equal(args[args.indexOf('--retry') + 1], '2');
    assert.equal(args[args.indexOf('--max-time') + 1], '300');
    assert.equal(existsSync(extracted), false);
    assert.equal(existsSync(args[args.indexOf('--output') + 1]), false);
  },
);
