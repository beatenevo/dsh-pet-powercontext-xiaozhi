/**
 * 全局开关卡：通知、前台聚焦也提醒、点击音效、锁定在当前屏幕与系统托盘。
 * 切换只改本地状态，随「保存」整包写入——即时写盘会重启桌面 Helper、重建全部桌面宠物窗口。
 * 通知开关额外需要用户手势，开与关都要走外壳的同一个入口，因此卡里只回传键名与目标值。
 * @module dsh-pet/src/client/settings/global-card
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** 五个全局开关的键名，与成品配置的字段名一致。 */
export type GlobalFlagKey =
  'notificationsEnabled' | 'notifyWhenFocused' | 'clickSoundEnabled' | 'confineToScreen' | 'trayEnabled';

/** 五个全局开关的当前值。 */
export type GlobalFlags = Record<GlobalFlagKey, boolean>;

/** Global switch card input. */
export interface GlobalCardProps {
  /** All switches are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Current value. */
  values: GlobalFlags;
  /** A switch is toggled; permission request for notification switch is handled by the shell. */
  onChange: (key: GlobalFlagKey, value: boolean) => void;
}

/** Display order and text keys of switches. */
const TOGGLES: Array<{ key: GlobalFlagKey; label: string }> = [
  { key: 'notificationsEnabled', label: 'notifyToggle' },
  { key: 'notifyWhenFocused', label: 'notifyWhenFocusedToggle' },
  { key: 'clickSoundEnabled', label: 'clickSoundToggle' },
  { key: 'confineToScreen', label: 'confineToggle' },
  { key: 'trayEnabled', label: 'trayToggle' },
];

/**
 * Create a global switch card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makeGlobalCard(rt: SettingsRuntime): FunctionComponent<GlobalCardProps> {
  const { h, t } = rt;
  const { cardHead, toggleCell } = makeUiKit({ h, t });

  return function GlobalCard(props: GlobalCardProps) {
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('globalTitle'), t('globalHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: TOGGLES.map((toggle) =>
            toggleCell(toggle.label, props.values[toggle.key], props.busy, (value) =>
              props.onChange(toggle.key, value),
            ),
          ),
        }),
      ],
    });
  };
}
