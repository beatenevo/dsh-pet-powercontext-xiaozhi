/**
 * Voice card: four broadcast switches, tone and volume.
 *
 * Switch to only change the local state and write the entire package with "Save" - instant disk writing will restart
 * the desktop Helper and rebuild all desktop pet windows. The tone selector is shell-injected (isomorphic to the model
 * card injecting picker), and the card itself does not hardcode any tone id.
 * @module dsh-pet/src/client/settings/voice-card
 */
import type { FunctionComponent } from 'react';
import { makeSelect } from './panel/select.ts';
import type { VoiceOption, VoicePickerProps } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

export type { VoiceOption } from './picker/voice-picker.ts';

/** Voice card input. */
export interface VoiceCardProps {
  /** All controls are disabled while saving or configuration is not ready. */
  readonly busy: boolean;
  /** Current value of manual broadcast switch: manually triggered whisper and conversation reply. */
  readonly enabled: boolean;
  /** Current tone id. */
  readonly voiceName: string;
  /** Playback volume coefficient: decimal of 0–1, 1 = maximum volume. */
  readonly volume: number;
  /** Optional voice; when empty, the selector only displays the current value (the list has not been pulled back or the pull failed). */
  readonly voices: readonly VoiceOption[];
  /** Do you want to read the cycle whisper? */
  readonly whisperEnabled: boolean;
  /** Do you want to read out the to-do reminder? */
  readonly todoEnabled: boolean;
  /** Do you need to read out the work status report? */
  readonly notifyEnabled: boolean;
  /** Switch the manual broadcast switch. */
  readonly onToggle: (value: boolean) => void;
  /** Select tone. */
  readonly onVoiceChange: (voiceName: string) => void;
  /** Adjust playback volume. */
  readonly onVolumeChange: (volume: number) => void;
  /** Switch the periodic whisper broadcast. */
  readonly onWhisperToggle: (value: boolean) => void;
  /** Switch the broadcast of to-do reminders. */
  readonly onTodoToggle: (value: boolean) => void;
  /** Switch working status broadcast. */
  readonly onNotifyToggle: (value: boolean) => void;
  /** 当前语音识别实现 id。 */
  readonly speechProvider: string;
  /** 可选识别实现；为空时下拉只显示当前值（列表还没拉回来或拉取失败）。 */
  readonly speechProviders: readonly { readonly id: string; readonly name: string }[];
  /** 选择语音识别实现。 */
  readonly onSpeechProviderChange: (providerId: string) => void;
}

/**
 * Make a voice card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @param picker - Tone selector component; like the model card, it is created once and then injected by the assembly
 * root to ensure the stability of component types across renderings.
 * @returns card assembly.
 */
export function makeVoiceCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<VoicePickerProps>,
): FunctionComponent<VoiceCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });
  // 识别下拉单层、无副标题，直接复用通用下拉；与音色选择器分开造，两者布局不同
  const Select = makeSelect(rt);

  return function VoiceCard(props: VoiceCardProps) {
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('voiceTitle'), t('voiceHint')),
        // 第一行四个开关：四类语音各一个，必须相邻，读得出是「同一类」；
        // 后两行是音色、音量与识别实现——每格都要可见标签，只显示当前值读者猜不出是什么。
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            toggleCell('voiceEnabled', props.enabled, props.busy, props.onToggle),
            toggleCell('voiceWhisperEnabled', props.whisperEnabled, props.busy, props.onWhisperToggle),
            toggleCell('voiceTodoEnabled', props.todoEnabled, props.busy, props.onTodoToggle),
            toggleCell('voiceNotifyEnabled', props.notifyEnabled, props.busy, props.onNotifyToggle),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              t('voiceNameLabel'),
              h(picker, {
                label: t('voiceNameLabel'),
                value: props.voiceName,
                options: props.voices,
                disabled: props.busy,
                onChange: props.onVoiceChange,
              }),
              t('voiceNameHint'),
            ),
            field(
              t('voiceVolumeLabel'),
              h(
                'input',
                numberInputProps(props.volume, props.onVolumeChange, {
                  step: '0.05',
                  min: '0',
                  max: '1',
                  disabled: props.busy,
                }),
              ),
              t('voiceVolumeHint'),
            ),
          ],
        }),
        // 识别实现：一层选择，与上面的播报设置分开一行——它决定「谁来听」，不是「说不说」
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              t('speechProviderLabel'),
              h(Select, {
                label: t('speechProviderLabel'),
                value: props.speechProvider,
                options: props.speechProviders.map((item) => ({ id: item.id, label: item.name })),
                disabled: props.busy,
                onChange: props.onSpeechProviderChange,
              }),
              t('speechProviderHint'),
            ),
          ],
        }),
      ],
    });
  };
}
