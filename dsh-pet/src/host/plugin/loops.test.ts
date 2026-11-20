/**
 * 梦话闸门的单元测试：关掉碎碎念、或配置上不显示时，睡眠期间也不生成。
 *
 * 钉住 #355：碎碎念循环有两道闸（宠物开关 + display），梦话循环原先一道都没有，
 * 于是 `whisperEnabled: false` 的宠物睡着时仍每拍调一次模型。
 *
 * 跑法：node --experimental-strip-types --test src/host/plugin/loops.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSleepTalk } from './loops.ts';

describe('shouldSleepTalk —— 梦话闸门', () => {
  test('开着碎碎念且可见：说梦话', () => {
    assert.equal(shouldSleepTalk({ whisperEnabled: true, display: 'web' }), true);
    assert.equal(shouldSleepTalk({ whisperEnabled: true, display: 'desktop' }), true);
    assert.equal(shouldSleepTalk({ whisperEnabled: true, display: 'both' }), true);
  });

  test('关掉碎碎念：一律不生成，与 display 无关', () => {
    assert.equal(shouldSleepTalk({ whisperEnabled: false, display: 'web' }), false);
    assert.equal(shouldSleepTalk({ whisperEnabled: false, display: 'both' }), false);
  });

  test('没写 whisperEnabled：按关闭处理，不默认开', () => {
    assert.equal(shouldSleepTalk({ display: 'web' }), false);
    assert.equal(shouldSleepTalk({ whisperEnabled: 'true', display: 'web' }), false, '非布尔值不算开启');
  });

  test('配置上不显示：开着碎碎念也不生成（#237 同一口径）', () => {
    assert.equal(shouldSleepTalk({ whisperEnabled: true, display: 'none' }), false);
    assert.equal(shouldSleepTalk({ whisperEnabled: true }), false, '缺 display 等于不可见');
  });
});

test('保存周期后重排计时，保留上次生成时间且卸载后不再触发', async (t) => {
  const { mkdtempSync, copyFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { registerLoops } = await import('./loops.ts');
  const root = mkdtempSync(join(tmpdir(), 'pet-liveliness-loop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configPaths = {
    defaultFile: join(root, 'default.jsonc'),
    userFile: join(root, 'main.jsonc'),
    petDir: join(root, 'pets'),
  };
  copyFileSync(new URL('../../../assets/config.jsonc', import.meta.url), configPaths.defaultFile);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  let dispose = (): void => {};
  let generated = 0;
  const refresh = registerLoops({
    ctx: {
      effect: (fn: () => () => void, name: string) => {
        if (name === 'dsh-pet: whisper poll') dispose = fn();
      },
    },
    configPaths,
    lastWhisperAt: new Map(),
    lock: { locked: () => false },
    sleep: { sleeping: () => false },
    log: { info: () => {}, warn: () => {} },
    standaloneAiPolicy: () => undefined,
    whisperPeriodSec: (conf: { eventsRefreshSec: { whisper: number } }) => conf.eventsRefreshSec.whisper,
    publishWhisper: async () => {
      generated++;
    },
  } as unknown as Parameters<typeof registerLoops>[0]);
  t.after(() => dispose());
  await Promise.resolve();
  assert.equal(generated, 1);
  t.mock.timers.tick(30_000);
  writeFileSync(configPaths.userFile, JSON.stringify({ eventsRefreshSec: { whisper: 60 } }));
  refresh();
  refresh();
  assert.equal(generated, 1, '保存不会提前生成或重复生成');
  t.mock.timers.tick(29_999);
  assert.equal(generated, 1);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(generated, 2, '一分钟即触发，不等待旧的十分钟计时器');
  writeFileSync(configPaths.userFile, JSON.stringify({ eventsRefreshSec: { whisper: 1800 } }));
  refresh();
  t.mock.timers.tick(60_000);
  assert.equal(generated, 2, '调低活泼度会取消旧的短周期');
  dispose();
  refresh();
  t.mock.timers.tick(1_800_000);
  assert.equal(generated, 2);
});
