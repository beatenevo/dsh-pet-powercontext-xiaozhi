/** 离线包必须匹配平台和依赖清单；损坏包不能伪装成普通包触发下载。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { offlineMemoryPython } from './memory-offline.ts';

test('offline runtime rejects partial, wrong-platform and outdated bundles', () => {
  const root = mkdtempSync(join(tmpdir(), 'offline-memory-'));
  const bundle = join(root, 'offline');
  const requirements = join(root, 'requirements.txt');
  try {
    writeFileSync(requirements, 'powercontext==1.5.2\n');
    assert.equal(offlineMemoryPython(bundle, requirements), undefined);
    mkdirSync(bundle);
    assert.throws(() => offlineMemoryPython(bundle, requirements), /offline_runtime_invalid/);
    const manifest = {
      schema: 1,
      platform: process.platform,
      arch: process.arch,
      requirementsSha256: createHash('sha256').update('powercontext==1.5.2\n').digest('hex'),
    };
    const manifestPath = join(bundle, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => offlineMemoryPython(bundle, requirements), /offline_runtime_invalid/);
    const python = join(bundle, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3.12');
    mkdirSync(dirname(python), { recursive: true });
    writeFileSync(python, 'fixture');
    assert.equal(offlineMemoryPython(bundle, requirements), python);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, arch: 'wrong' }));
    assert.throws(() => offlineMemoryPython(bundle, requirements), /offline_runtime_invalid/);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(requirements, 'powercontext==9.0.0\n');
    assert.throws(() => offlineMemoryPython(bundle, requirements), /offline_runtime_invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
