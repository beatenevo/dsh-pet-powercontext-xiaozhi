/**
 * Tone single selection drop-down: Put the "name (label)" into one line, and leave all interaction and appearance to
 * the general drop-down `../panel/select` . There are only a few voices, and there is no search or preview; the tags
 * are integrated into the copy, and users can see the voice style before selecting.
 * @module dsh-pet/src/client/settings/picker/voice-picker
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from '../runtime.ts';
import { makeSelect } from '../panel/select.ts';

/** 一个可选音色的展示信息；`id`（限定 id）既是提交值也是稳定 key。 */
export interface VoiceOption {
  readonly id: string;
  readonly name: string;
  /** 展示用副标题，如「女 · 活泼」；缺省时只显示名称。 */
  readonly tag?: string;
  /** 所属 provider 的展示名；渲染成下拉里的分组标题。 */
  readonly providerName?: string;
}

/** External contract of voice selector: one field per instance. */
export interface VoicePickerProps {
  /** Field label as the accessibility name of the trigger. */
  readonly label: string;
  /** Current tone id. */
  readonly value: string;
  /** Optional voice; when it is empty, the trigger is left empty, and when it is opened, it is an empty list. */
  readonly options: readonly VoiceOption[];
  /** Reason for disabling (saving/configuration not loaded). */
  readonly disabled: boolean;
  /** Select a tone. */
  readonly onChange: (voiceName: string) => void;
}

/**
 * Create a tone selector. Dependencies are only injected once at call time: the component type must be stable across
 * renders, otherwise the overlay state (open/highlighted) will be lost every render.
 *
 * @param rt - Injected react capabilities; the copy is given by the caller in options, no translation is required.
 * @returns selector component.
 */
export function makeVoicePicker(
  rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef'>,
): FunctionComponent<VoicePickerProps> {
  const { h } = rt;
  const Select = makeSelect(rt);

  return function VoicePicker(props: VoicePickerProps) {
    return h(Select, {
      label: props.label,
      value: props.value,
      options: props.options.map((option) => ({
        id: option.id,
        label: option.tag === undefined ? option.name : `${option.name}（${option.tag}）`,
        ...(option.providerName === undefined ? {} : { group: option.providerName }),
      })),
      disabled: props.disabled,
      onChange: props.onChange,
    });
  };
}
