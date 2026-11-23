/** 验证宿主卸载会等待自有日志写盘，防止临时目录清理与异步写入竞争。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createHostSetup } from './setup.ts';

test('owned logger disposal waits for pending flush before allowing directory cleanup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pet-log-dispose-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const disposers: Array<() => unknown> = [];
  const { log } = createHostSetup({
    effect(setup) {
      const dispose = setup();
      if (dispose) disposers.push(dispose);
    },
    provide() {},
  });
  const flush = log.flush.bind(log);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  log.flush = async () => {
    await gate;
    await flush();
  };
  log.info('pending shutdown log');
  let settled = false;
  const disposal = Promise.all(disposers.reverse().map((dispose) => dispose())).then(() => {
    settled = true;
  });
  try {
    await setImmediate();
    assert.equal(settled, false, 'unmount must wait until log writes have completed');
    release();
    await disposal;
    assert.match(readFileSync(log.file, 'utf8'), /pending shutdown log/);
  } finally {
    release();
    await disposal;
    await flush();
    log.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
