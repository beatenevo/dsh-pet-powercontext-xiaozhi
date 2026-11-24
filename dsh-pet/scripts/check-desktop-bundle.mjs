/** 在无 node_modules 的目录加载桌面入口，阻止遗漏依赖的产物进入发布流程。 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'pet-desktop-bundle-'));
try {
  cpSync(new URL('../lib/', import.meta.url), join(directory, 'lib'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  const probe = `
import Module from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const original = Module._load;
let loaded = false;
Module._load = function(id, ...args) {
  if (id === 'electron') {
    loaded = true;
    return { app: { requestSingleInstanceLock: () => false, exit: () => {} } };
  }
  return original.call(this, id, ...args);
};
await import('./lib/app.js');
if (!loaded) throw new Error('Desktop entry did not reach Electron');
const chunks = readdirSync(new URL('./lib/', import.meta.url)).filter(file => file.startsWith('extract-zip-') && file.endsWith('.js'));
if (chunks.length === 0) throw new Error('Missing bundled ZIP extractor');
writeFileSync('probe.zip', Buffer.from('UEsDBBQAAAAAAIdYeF0mQ9J1FgAAABYAAAAJAAAAcHJvYmUudHh0ZGVza3RvcCBaSVAgZXh0cmFjdGlvblBLAQIUAxQAAAAAAIdYeF0mQ9J1FgAAABYAAAAJAAAAAAAAAAAAAACAAQAAAABwcm9iZS50eHRQSwUGAAAAAAEAAQA3AAAAPQAAAAAA', 'base64'));
for (const file of chunks) {
  const { default: extract } = await import('./lib/' + file);
  await extract(resolve('probe.zip'), { dir: resolve('extracted') });
}
if (readFileSync('extracted/probe.txt', 'utf8') !== 'desktop ZIP extraction') throw new Error('ZIP extraction failed');
`;
  writeFileSync(join(directory, 'probe.mjs'), probe);
  const result = spawnSync(process.execPath, [join(directory, 'probe.mjs')], {
    cwd: directory,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Desktop bundle cannot load without node_modules:\n${result.stderr}`, { cause: result.error });
  }
  console.log('[desktop-bundle] Isolated main-process module loading passed (Electron stub; no UI validation).');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
