/** Install an isolated, pinned PowerContext runtime without changing the user's Python or PATH. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { memoryRuntimePath, seekdbRuntimeCheck, type MemoryDatabase } from './memory-runtime.ts';

import { offlineMemoryPython } from './memory-offline.ts';

const UV_VERSION = '0.9.26';
export type MemoryStage =
  | 'checking_runtime'
  | 'downloading'
  | 'checking_python'
  | 'reusing_python'
  | 'installing_python'
  | 'using_cached_dependencies'
  | 'installing_memory'
  | 'validating_runtime'
  | 'starting';
const ARCHIVES: Record<string, [string, string]> = {
  'linux-x64': [
    'uv-x86_64-unknown-linux-gnu.tar.gz',
    '30ccbf0a66dc8727a02b0e245c583ee970bdafecf3a443c1686e1b30ec4939e8',
  ],
  'linux-arm64': [
    'uv-aarch64-unknown-linux-gnu.tar.gz',
    'f71040c59798f79c44c08a7a1c1af7de95a8d334ea924b47b67ad6b9632be270',
  ],
  'darwin-x64': ['uv-x86_64-apple-darwin.tar.gz', '171eb8c518313e157c5b4cec7b4f743bc6bab1bd23e09b646679a02d096a047f'],
  'darwin-arm64': [
    'uv-aarch64-apple-darwin.tar.gz',
    'fcf0a9ea6599c6ae28a4c854ac6da76f2c889354d7c36ce136ef071f7ab9721f',
  ],
  'win32-x64': ['uv-x86_64-pc-windows-msvc.zip', 'eb02fd95d8e0eed462b4a67ecdd320d865b38c560bffcda9a0b87ec944bdf036'],
  'win32-arm64': ['uv-aarch64-pc-windows-msvc.zip', '79e1398ec98681b1b0494ed3485b0f4565e98a7db109a3f205d0fcdc6a1992f7'],
};

/** Only OS/network necessities cross into the managed runtime; unrelated model and Server settings do not. */
export function memoryProcessEnv(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // [::1] added by DSH will be regarded as an invalid port by HTTPX; bare IPv6 also applies to curl/uv.
  for (const key of ['NO_PROXY', 'no_proxy']) {
    if (env[key])
      env[key] = env[key]
        .split(',')
        .map((entry) => {
          const host = entry.trim();
          const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : '';
          return isIP(address) === 6 ? address : host;
        })
        .join(',');
  }
  return {
    ...env,
    UV_NO_CONFIG: '1',
    UV_CACHE_DIR: join(directory, 'cache'),
    UV_PYTHON_INSTALL_DIR: join(directory, 'python'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    PYTHONNOUSERSITE: '1',
    PYTHONUNBUFFERED: '1',
  };
}

/** Safe process diagnostics, without command arguments, environment or child output. */
export class MemoryCommandError extends Error {
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;

  constructor(code: string, exitCode: number | null, exitSignal: NodeJS.Signals | null) {
    super(code);
    this.exitCode = exitCode;
    this.exitSignal = exitSignal;
  }
}

/** Fixed executables/arguments only. Output can include credentials and is deliberately discarded. */
export function runMemoryCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
    });
    let failure = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (): void => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('error', () => child.kill());
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* Already exited. */
        }
        killTimer ??= setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            /* Already exited. */
          }
        }, 3000);
      }
    };
    const timer = setTimeout(() => {
      failure = 'runtime_command_timeout';
      terminate();
    }, 600_000);
    signal.addEventListener('abort', terminate, { once: true });
    child.once('error', (error: NodeJS.ErrnoException) => {
      failure = error.code === 'ENOENT' ? 'runtime_tool_missing' : 'runtime_command_failed';
    });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (killTimer) {
        // A parent may exit on SIGTERM while one of its descendants ignores it.
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* Group already gone. */
        }
        clearTimeout(killTimer);
      }
      signal.removeEventListener('abort', terminate);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0 && !failure) resolve();
      else reject(new MemoryCommandError(failure || 'runtime_command_failed', code, exitSignal));
    });
  });
}

/** Discover a runnable native CPython without inheriting project environments or downloading an interpreter. */
async function findSystemPython(uv: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string | undefined> {
  const options = {
    env: { ...env, UV_PYTHON_PREFERENCE: 'only-system' },
    signal,
    timeout: 15_000,
    maxBuffer: 8192,
    windowsHide: true,
  };
  try {
    const { stdout } = await promisify(execFile)(
      uv,
      ['python', 'find', '--system', '--no-project', '--offline', '--no-python-downloads', 'cpython>=3.11,<3.15'],
      options,
    );
    const python = stdout.trim();
    if (!isAbsolute(python)) return undefined;
    const machines = process.arch === 'arm64' ? ['arm64', 'aarch64'] : ['x86_64', 'amd64'];
    // Windows 的 platform.machine() 依赖环境变量；构建平台标识在受限环境中仍能反映解释器架构。
    const probe = await promisify(execFile)(
      python,
      [
        '-I',
        '-c',
        'import sys, platform, struct, sysconfig, venv, sqlite3, json; print(json.dumps({"implementation": sys.implementation.name, "major": sys.version_info.major, "minor": sys.version_info.minor, "bits": struct.calcsize("P") * 8, "machine": (sysconfig.get_platform().removeprefix("win-") if sys.platform == "win32" else platform.machine()).lower(), "sqliteExtensions": hasattr(sqlite3.Connection, "enable_load_extension"), "freeThreaded": bool(sysconfig.get_config_var("Py_GIL_DISABLED"))}))',
      ],
      options,
    );
    const runtime: unknown = JSON.parse(probe.stdout);
    if (!runtime || typeof runtime !== 'object') return undefined;
    if (!('implementation' in runtime) || runtime.implementation !== 'cpython') return undefined;
    if (!('major' in runtime) || runtime.major !== 3) return undefined;
    if (
      !('minor' in runtime) ||
      typeof runtime.minor !== 'number' ||
      !Number.isInteger(runtime.minor) ||
      runtime.minor < 11 ||
      runtime.minor > 14
    )
      return undefined;
    if (!('bits' in runtime) || runtime.bits !== 64) return undefined;
    if (!('machine' in runtime) || typeof runtime.machine !== 'string' || !machines.includes(runtime.machine))
      return undefined;
    if (!('sqliteExtensions' in runtime) || runtime.sqliteExtensions !== true) return undefined;
    if (!('freeThreaded' in runtime) || runtime.freeThreaded !== false) return undefined;
    return python;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

/** Reuse a compatible interpreter and cached packages, downloading missing runtime components privately. */
export async function installMemoryRuntime(
  directory: string,
  signal: AbortSignal,
  progress: (stage: MemoryStage) => void = () => {},
  database: MemoryDatabase = 'sqlite',
): Promise<string> {
  progress('checking_runtime');
  if (database === 'seekdb' && process.platform === 'win32' && process.arch !== 'x64')
    throw new Error('seekdb_unsupported_architecture');
  const offlinePython = offlineMemoryPython(memoryRuntimePath('../offline'), memoryRuntimePath('requirements.txt'));
  if (offlinePython) {
    if (database !== 'seekdb') throw new Error('offline_runtime_requires_seekdb');
    progress('validating_runtime');
    try {
      await runMemoryCommand(
        offlinePython,
        [
          '-I',
          '-B',
          '-c',
          seekdbRuntimeCheck() +
            '; import sqlite3; c = sqlite3.connect(":memory:"); c.enable_load_extension(True); c.close()',
        ],
        { ...memoryProcessEnv(directory), PYTHONDONTWRITEBYTECODE: '1' },
        signal,
      );
    } catch {
      signal.throwIfAborted();
      throw new Error('offline_runtime_invalid');
    }
    return offlinePython;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const check =
    database === 'seekdb'
      ? seekdbRuntimeCheck()
      : 'from importlib.metadata import version; assert version("powercontext") == "1.5.0"; import uvicorn';
  const python = join(directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const env = memoryProcessEnv(directory);
  if (existsSync(python)) {
    try {
      // PowerContext migration snapshots need SQLite extensions even with seekdb storage.
      await runMemoryCommand(
        python,
        ['-I', '-c', 'import sqlite3; c = sqlite3.connect(":memory:"); c.enable_load_extension(True); c.close()'],
        env,
        signal,
      );
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof MemoryCommandError) || error.exitSignal || error.message !== 'runtime_command_failed')
        throw error;
      // Replace only the private interpreter environment; keep database files and the download cache.
      rmSync(join(directory, 'venv'), { recursive: true, force: true });
    }
  }
  if (existsSync(python)) {
    try {
      await runMemoryCommand(python, ['-c', check], env, signal);
      return python;
    } catch (error) {
      signal.throwIfAborted();
      // A crashing interpreter must not be treated as a missing dependency.
      if (error instanceof MemoryCommandError && error.exitSignal) throw error;
    }
  }
  const artifact = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!artifact) throw new Error('unsupported_platform');
  const bin = join(directory, 'uv');
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const uv = join(bin, process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (existsSync(uv)) {
    try {
      await runMemoryCommand(uv, ['--version'], env, signal);
    } catch {
      signal.throwIfAborted();
      rmSync(uv, { force: true });
    }
  }
  if (!existsSync(uv)) {
    progress('downloading');
    const [name, digest] = artifact;
    const archive = join(directory, name);
    try {
      // System curl honors proxy settings on all supported platforms. -q disables user curlrc commands.
      await runMemoryCommand(
        'curl',
        [
          '-q',
          '--fail',
          '--location',
          '--proto',
          '=https',
          '--proto-redir',
          '=https',
          '--max-time',
          '120',
          '--max-filesize',
          '50000000',
          '--silent',
          '--output',
          archive,
          `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}`,
        ],
        env,
        signal,
      );
      if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== digest)
        throw new Error('download_checksum_failed');
      // Windows tar (bsdtar) supports zip. Unix archives contain one enclosing directory.
      const args =
        process.platform === 'win32'
          ? ['-xf', archive, '-C', bin]
          : ['-xzf', archive, '--strip-components=1', '-C', bin];
      await runMemoryCommand('tar', args, env, signal);
      chmodSync(uv, 0o700);
    } finally {
      rmSync(archive, { force: true });
    }
  }
  if (!existsSync(python)) {
    progress('checking_python');
    const systemPython = await findSystemPython(uv, env, signal);
    progress(systemPython ? 'reusing_python' : 'installing_python');
    await runMemoryCommand(
      uv,
      ['venv', '--clear', '--python', systemPython ?? '3.12', join(directory, 'venv')],
      systemPython ? { ...env, UV_PYTHON_PREFERENCE: 'only-system', UV_PYTHON_DOWNLOADS: 'never' } : env,
      signal,
    );
  }
  const installArgs = [
    'pip',
    'install',
    '--python',
    python,
    ...(database === 'seekdb' ? ['-r', memoryRuntimePath('requirements.txt')] : ['powercontext[cli,server]==1.5.0']),
  ];
  progress('using_cached_dependencies');
  try {
    await runMemoryCommand(uv, [...installArgs, '--offline'], env, signal);
  } catch (error) {
    signal.throwIfAborted();
    // Retry only a normal offline resolution failure; crashes and timeouts need diagnosis.
    if (!(error instanceof MemoryCommandError) || error.exitSignal || error.message !== 'runtime_command_failed')
      throw error;
    progress('installing_memory');
    await runMemoryCommand(uv, installArgs, env, signal);
  }
  // Do not treat a partial download/installation as a usable runtime.
  progress('validating_runtime');
  await runMemoryCommand(python, ['-c', check], env, signal);
  return python;
}
