import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { extractUvWheel, uvWheelArtifact } from './memory-uv.ts';

test('default uv artifacts use pinned domestic wheels for all supported platforms', () => {
  for (const platform of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
    const artifact = uvWheelArtifact(platform);
    assert.equal(new URL(artifact.url).origin, 'https://mirrors.tuna.tsinghua.edu.cn');
    assert.match(artifact.name, /^uv-0\.9\.26-py3-none-.+\.whl$/);
    assert.match(artifact.digest, /^[a-f0-9]{64}$/);
  }
  assert.throws(() => uvWheelArtifact('unsupported'), /unsupported_platform/);
});

// 仅包含两个文本可执行文件的 ZIP 夹具，无需 Python 或外部解包工具。
const WHEEL_FIXTURE =
  'UEsDBBQAAAAAADy2d12NyacLEgAAABIAAAAZAAAAdXYtMC45LjI2LmRhdGEvc2NyaXB0cy91dmZpeHR1cmUgZXhlY3V0YWJsZVBLAwQUAAAAAAA8tnddjcmnCxIAAAASAAAAHQAAAHV2LTAuOS4yNi5kYXRhL3NjcmlwdHMvdXYuZXhlZml4dHVyZSBleGVjdXRhYmxlUEsBAhQDFAAAAAAAPLZ3XY3JpwsSAAAAEgAAABkAAAAAAAAAAAAAAIABAAAAAHV2LTAuOS4yNi5kYXRhL3NjcmlwdHMvdXZQSwECFAMUAAAAAAA8tnddjcmnCxIAAAASAAAAHQAAAAAAAAAAAAAAgAFJAAAAdXYtMC45LjI2LmRhdGEvc2NyaXB0cy91di5leGVQSwUGAAAAAAIAAgCSAAAAlgAAAAAA';

for (const executable of ['uv', 'uv.exe', 'missing']) {
  test(`wheel extraction publishes only a complete executable: ${executable}`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'pet-uv-wheel-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const archive = join(directory, 'fixture.whl');
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(archive, Buffer.from(WHEEL_FIXTURE, 'base64'));
    if (executable === 'missing') {
      await assert.rejects(extractUvWheel(archive, bin, executable));
      assert.equal(existsSync(join(bin, executable)), false);
      assert.deepEqual(readdirSync(bin), []);
    } else {
      await extractUvWheel(archive, bin, executable);
      assert.equal(readFileSync(join(bin, executable), 'utf8'), 'fixture executable');
      assert.deepEqual(readdirSync(bin), [executable]);
    }
  });
}
