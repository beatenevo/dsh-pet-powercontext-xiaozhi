/**
 * 通知引擎的单元测试：会话名注入与「前台要不要提醒」这条判定。
 *
 * 会话名那组：四种取不到的情形都必须退成 undefined，交给 shared 侧回落固定文案；
 * 抛错也要在这里收住，否则一条取名失败会把弹窗本身带下水。
 * 提醒那组钉住 #357 的四组合：聚焦 / 失焦 × 开关开 / 关。系统通知与工作状态播报共用这条判定。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionTitleFrom, shouldRemind, type SessionNavigator } from './notify.ts';

/** Only a substitute for naming ability is implemented; jump does not participate in this test. */
const namedBy = (title: string): SessionNavigator => ({ openSession: () => {}, sessionTitle: () => title });

describe('sessionTitleFrom', () => {
  test('Service returns unchanged when given a name', () => {
    assert.equal(sessionTitleFrom(namedBy('修复通知标题'), 's1'), '修复通知标题');
  });

  test('When the frame does not carry sessionId, it returns undefined. Do not use empty id to check.', () => {
    assert.equal(sessionTitleFrom(namedBy('任何名字'), undefined), undefined);
  });

  test('Returns undefined when there is no injector (old host)', () => {
    assert.equal(sessionTitleFrom(undefined, 's1'), undefined);
  });

  test('undefined is returned when the service does not have naming capabilities', () => {
    assert.equal(sessionTitleFrom({ openSession: () => {} }, 's1'), undefined);
  });

  test('Stop when the service is thrown incorrectly, and the pop-up window will not be affected.', () => {
    const navigator: SessionNavigator = {
      openSession: () => {},
      sessionTitle: () => {
        throw new Error('会话列表还没加载');
      },
    };
    assert.equal(sessionTitleFrom(navigator, 's1'), undefined);
  });
});

describe('shouldRemind —— 前台聚焦时要不要提醒', () => {
  test('开关关闭 + 页面活跃 → 不提醒（维持原行为）', () => {
    assert.equal(shouldRemind(false, true), false);
  });

  test('开关关闭 + 页面不活跃 → 提醒', () => {
    assert.equal(shouldRemind(false, false), true);
  });

  test('开关打开 + 页面活跃 → 照常提醒', () => {
    assert.equal(shouldRemind(true, true), true);
  });

  test('开关打开 + 页面不活跃 → 照常提醒', () => {
    assert.equal(shouldRemind(true, false), true);
  });
});
