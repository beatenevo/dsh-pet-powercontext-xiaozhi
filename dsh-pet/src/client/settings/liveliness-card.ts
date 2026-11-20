/** 活泼程度滑块只编辑草稿，沿用现有配置保存与调度。 */
import type { FunctionComponent, ChangeEvent } from 'react';
import { LIVELINESS_PRESETS, livelinessLevel } from '../../shared/liveliness.ts';
import type { Weights } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

interface LivelinessProps {
  busy: boolean;
  /** 事件周期（秒）；保留余额刷新、梦话等其他事件。 */
  periods: Record<string, number>;
  onChange: (periods: Record<string, number>, weights: Weights) => void;
}

/** 创建同时调整碎碎念与自主动作的滑块。 */
export function makeLivelinessCard({ h, t }: SettingsRuntime): FunctionComponent<LivelinessProps> {
  const { cardHead, field } = makeUiKit({ h, t });
  return ({ busy, periods, onChange }) =>
    h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('livelinessTitle'), t('livelinessHint')),
        field(
          t('livelinessRange'),
          h('input', {
            type: 'range',
            min: 0,
            max: 100,
            step: 1,
            value: livelinessLevel(periods.whisper),
            disabled: busy,
            'aria-label': t('livelinessTitle'),
            style: { width: '100%' },
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const preset = LIVELINESS_PRESETS[Number(event.target.value)];
              if (preset) onChange({ ...periods, whisper: preset.whisper }, { ...preset.weights });
            },
          }),
        ),
        h('p', { children: t('livelinessPeriod') + ': ' + Math.round((periods.whisper ?? 600) / 6) / 10 }),
      ],
    });
}
