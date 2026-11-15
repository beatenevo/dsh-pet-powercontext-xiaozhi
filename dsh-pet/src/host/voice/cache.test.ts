/**
 * Behavioral test of voice cache (src/host/voice/cache.ts). Use real temporary directories with real fs: The value of
 * this module is in the file behavior. Each use case creates its own directory without interfering with each other.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FORMAT_INFO, cacheKey, cachePath, ensureCacheDir, pruneCache } from './cache.ts';

/** Run the test case in a separate temporary directory and clean it up after completion. */
async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-cache-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('cacheKey：同输入稳定，限定音色/语速/文本任一不同即不同', () => {
  const base = cacheKey('edge/zh-CN-XiaoxiaoNeural', 0, '你好');
  assert.equal(base, cacheKey('edge/zh-CN-XiaoxiaoNeural', 0, '你好'), '同输入必须稳定');
  assert.notEqual(base, cacheKey('my-tts/zh-CN-XiaoxiaoNeural', 0, '你好'), '换 provider 不能命中旧音频');
  assert.notEqual(base, cacheKey('edge/zh-CN-YunxiNeural', 0, '你好'), '换音色不能命中');
  assert.notEqual(base, cacheKey('edge/zh-CN-XiaoxiaoNeural', 10, '你好'), '换语速不能命中');
  assert.notEqual(base, cacheKey('edge/zh-CN-XiaoxiaoNeural', 0, '你好 '), 'Spaces are not normalized');
});

test('cachePath：扩展名跟格式走，落在 userRoot/voice-cache 下', () => {
  assert.equal(cachePath(join('root'), 'abc', 'mp3'), join('root', 'voice-cache', 'abc.mp3'));
  assert.equal(cachePath(join('root'), 'abc', 'wav'), join('root', 'voice-cache', 'abc.wav'));
});

test('FORMAT_INFO：两种格式的 MIME 与实际扩展名对得上', () => {
  assert.deepEqual(FORMAT_INFO.mp3, { ext: '.mp3', mime: 'audio/mpeg' });
  assert.deepEqual(FORMAT_INFO.wav, { ext: '.wav', mime: 'audio/wav' });
});

test('ensureCacheDir: Create the directory when it does not exist. No error will be reported if repeated calls are made.', () =>
  withDir(async (dir) => {
    const created = await ensureCacheDir(dir);
    assert.equal(created, join(dir, 'voice-cache'));
    await ensureCacheDir(dir);
  }));

test('pruneCache: When the maximum number of records is exceeded, delete them from the oldest one.', () =>
  withDir(async (dir) => {
    for (const [index, name] of ['a.mp3', 'b.mp3', 'c.mp3'].entries()) {
      const file = join(dir, name);
      await writeFile(file, Buffer.alloc(10));
      const stamp = new Date(2026, 0, 1 + index);
      await utimes(file, stamp, stamp);
    }
    const removed = await pruneCache(dir, { maxFiles: 2, maxBytes: 1_000_000 });
    assert.equal(removed, 1, 'Only delete the one that exceeds the upper limit');
    const left = await readdir(dir);
    assert.equal(left.includes('a.mp3'), false, 'The oldest a.mp3 should be deleted');
    assert.deepEqual(left.sort(), ['b.mp3', 'c.mp3']);
  }));

test('pruneCache：WAV 也参与统计，否则这类文件永远删不掉', () =>
  withDir(async (dir) => {
    for (const [index, name] of ['a.wav', 'b.mp3'].entries()) {
      const file = join(dir, name);
      await writeFile(file, Buffer.alloc(10));
      const stamp = new Date(2026, 0, 1 + index);
      await utimes(file, stamp, stamp);
    }
    const removed = await pruneCache(dir, { maxFiles: 1, maxBytes: 1_000_000 });
    assert.equal(removed, 1);
    assert.deepEqual(await readdir(dir), ['b.mp3'], '最旧的 .wav 应被删掉，而不是被跳过');
  }));

test('pruneCache：非音频文件不参与，也不会被删', () =>
  withDir(async (dir) => {
    await writeFile(join(dir, 'note.txt'), Buffer.alloc(10));
    await writeFile(join(dir, 'a.mp3'), Buffer.alloc(10));
    const removed = await pruneCache(dir, { maxFiles: 1, maxBytes: 1_000_000 });
    assert.equal(removed, 0, '只有一条音频文件，已达上限');
    assert.equal((await readdir(dir)).includes('note.txt'), true);
  }));

test('pruneCache: Return 0 instead of throwing an error when the directory does not exist', () =>
  withDir(async (dir) => {
    assert.equal(await pruneCache(join(dir, 'missing')), 0);
  }));
