#!/usr/bin/env node
/**
 * 在目标平台构建独立离线插件包，不修改普通 npm 包的发布清单。
 * Python 来自 uv 的可搬移发行版，原生依赖只在同平台安装；产物包含依赖版本清单。
 * 构建阶段允许联网，安装验收另在空缓存中强制离线执行。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(root, '..');
const output = resolve(process.argv[2] || '');
if (!process.argv[2] || existsSync(output) || output === repository || output.startsWith(repository + sep))
  throw new Error('Supply a new output directory outside the repository');
const npmCli = process.env.npm_execpath;
if (!npmCli?.endsWith('npm-cli.js')) throw new Error('Run through npm run pack:offline');
mkdirSync(output, { recursive: true });

/** 固定程序与参数数组执行，避免 Windows shell 改写带空格的路径。 */
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error || result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const npm = (args, cwd = root) => run(process.execPath, [npmCli, ...args], cwd);
console.log('Packing the validated plugin');
const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output]))[0];
// Git Bash 的 tar 会把 Windows 盘符中的冒号当成远程归档；在产物目录内使用相对路径。
run('tar', ['-xf', packed.filename], output);
const stage = join(output, 'package');
const manifestPath = join(stage, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
delete manifest.devDependencies;
delete manifest.scripts;
manifest.bundledDependencies = Object.keys(manifest.dependencies);
// 顶层运行依赖沿用已通过仓库锁文件安装与测试的版本。
for (const name of manifest.bundledDependencies) {
  manifest.dependencies[name] = JSON.parse(
    readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  ).version;
}
manifest.files.push('runtime/offline');
manifest.os = [process.platform];
manifest.cpu = [process.arch];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('Resolving bundled Node dependencies');
npm(['install', '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'], stage);

const bundle = join(stage, 'runtime', 'offline');
mkdirSync(bundle, { recursive: true });
const env = {
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(output, 'managed-python'),
  UV_PYTHON_PREFERENCE: 'only-managed',
  UV_NO_CONFIG: '1',
};
console.log('Installing the portable Python distribution');
run('uv', ['python', 'install', '3.12.12'], root, env);
const originalPython = run('uv', ['python', 'find', '--no-project', '3.12.12'], root, env);
const prefix = run(originalPython, ['-I', '-c', 'import sys; print(sys.prefix)']);
const prefixRelative = relative(env.UV_PYTHON_INSTALL_DIR, prefix);
if (!prefixRelative || prefixRelative === '..' || prefixRelative.startsWith('..' + sep) || isAbsolute(prefixRelative))
  throw new Error('Expected a private managed Python');
// npm tar 不保留符号链接；复制时实体化，避免安装包丢失解释器或动态库。
cpSync(prefix, join(bundle, 'python'), { recursive: true, dereference: true });
const python = join(bundle, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3.12');
console.log('Installing PowerContext and native seekdb dependencies');
const requirements = join(stage, 'runtime', 'powercontext', 'requirements.txt');
run(
  'uv',
  ['pip', 'install', '--python', python, '--break-system-packages', '--only-binary', 'pylibseekdb', '-r', requirements],
  root,
  env,
);
const versions = run('uv', ['pip', 'freeze', '--python', python], root, env);
writeFileSync(join(bundle, 'requirements-resolved.txt'), versions + '\n');
cpSync(join(stage, 'package-lock.json'), join(bundle, 'node-dependencies.lock.json'));
writeFileSync(
  join(bundle, 'manifest.json'),
  JSON.stringify(
    {
      schema: 1,
      platform: process.platform,
      arch: process.arch,
      pluginVersion: manifest.version,
      pythonVersion: '3.12.12',
      minimumMacOS: process.platform === 'darwin' ? '15.0' : undefined,
      requirementsSha256: createHash('sha256').update(readFileSync(requirements)).digest('hex'),
    },
    null,
    2,
  ),
);
const release = join(output, 'release');
mkdirSync(release);
console.log('Creating the offline archive and checksum');
const artifact = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', release], stage))[0];
const filename = `dsh-pet-powercontext-${manifest.version}-plugin-${process.platform}-${process.arch}-offline.tgz`;
renameSync(join(release, artifact.filename), join(release, filename));
writeFileSync(
  join(release, filename + '.sha256'),
  createHash('sha256')
    .update(readFileSync(join(release, filename)))
    .digest('hex') + `  ${filename}\n`,
);
writeFileSync(
  join(release, 'INSTALL.txt'),
  `DSH must already be installed (including its profile dependencies and pnpm).\nStop DSH before installing; choose web or desktop profile.\n\ndsh plugin --profile desktop add --offline --ignore-scripts --config.auto-install-peers=false "./${filename}"\n\nRestart DSH, configure the model and embedding endpoints, then enable PowerContext/seekdb.\nModel APIs still require network access. macOS requires 15 or newer.\nThis archive does not include DSH, Electron or the AI Vision server.\nMissing host dependencies fail offline; do not remove --offline to bypass the check.\n`,
);
console.log(join(release, filename));
