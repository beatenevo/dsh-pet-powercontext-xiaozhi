/** Edit robot connection and manufacturer-provided action mappings in the chat panel. */
import type { RobotConfig, RobotCatalog } from '../../shared/robot.ts';
import { robotRequestId, type RobotRuntime } from './state.ts';
import { makeRobotActionFields, type RobotActionDraft } from './action-fields.ts';

/** Settings inputs shared by the Harness card and standalone chat. */
export interface RobotSettingsProps {
  config: RobotConfig;
  catalog?: RobotCatalog;
  disabled: boolean;
  save: (config: RobotConfig) => Promise<boolean>;
  pets?: readonly { id: string; name: string }[];
  saveDeviceToken?: (token: string) => Promise<boolean>;
}

/** Keep operator drafts separate from polled status. */
export function makeRobotSettings(rt: RobotRuntime) {
  const { h, t, useState } = rt;
  const ActionFields = makeRobotActionFields(rt);
  return function RobotSettings(props: RobotSettingsProps) {
    const [draft, setDraft] = useState(
      !props.config.xiaozhi && !props.config.address && props.config.actions.length === 0
        ? { ...props.config, xiaozhi: { deviceId: '' } }
        : props.config,
    );
    const [rows, setRows] = useState<RobotActionDraft[]>(
      props.config.actions.map(({ arguments: args, ...action }) => ({
        ...action,
        ...(args ? { argumentText: JSON.stringify(args) } : {}),
      })),
    );
    const [message, setMessage] = useState('');
    const [token, setToken] = useState('');
    const isXiaozhi = !!draft.xiaozhi;
    const savedApiUrl = props.config.xiaozhi?.apiUrl;
    const savedTarget =
      !!props.config.xiaozhi === isXiaozhi &&
      draft.address === props.config.address &&
      draft.xiaozhi?.deviceId === props.config.xiaozhi?.deviceId &&
      draft.xiaozhi?.apiUrl === savedApiUrl;
    const catalog = savedTarget ? props.catalog : undefined;
    const field = (label: string, value: string, onChange: (value: string) => void, type = 'text') =>
      h('label', {
        children: [
          label,
          h('input', { type, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
        ],
      });
    return h(props.pets ? 'div' : 'details', {
      children: [
        props.pets ? null : h('summary', { children: t('robotSetup') }),
        h('p', {
          className: 'pet-robot-note',
          children: t(
            isXiaozhi ? (props.pets ? 'robotXiaozhiAddressHint' : 'robotXiaozhiQuickStart') : 'robotQuickStart',
          ),
        }),
        h('form', {
          onSubmit: (event: { preventDefault(): void }) => {
            event.preventDefault();
            try {
              const config = {
                ...draft,
                actions: rows.map(({ argumentText, ...action }) => {
                  if (action.tool !== 'xiaozhiMcp') return action;
                  const args: unknown = JSON.parse(argumentText ?? '{}');
                  if (typeof args !== 'object' || !args || Array.isArray(args)) throw new Error('invalid_arguments');
                  return { ...action, arguments: args as Record<string, unknown> };
                }),
              };
              void props
                .save(config)
                .then((ok) =>
                  setMessage(
                    ok
                      ? t(
                          config.directExecution && config.chatActions && !isXiaozhi
                            ? 'robotSavedDirect'
                            : 'robotSaved',
                        )
                      : t('robotRequestError'),
                  ),
                );
            } catch {
              setMessage(t('robotInvalidArguments'));
            }
          },
          children: [
            h('fieldset', {
              disabled: props.disabled,
              children: [
                h('label', {
                  children: [
                    t('robotProvider'),
                    h('select', {
                      value: isXiaozhi ? 'xiaozhi' : 'astra',
                      onChange: (event: { target: { value: string } }) => {
                        const xiaozhi = event.target.value === 'xiaozhi';
                        setRows([]);
                        setDraft({
                          ...draft,
                          enabled: false,
                          directExecution: false,
                          address: '',
                          xiaozhi: xiaozhi ? { deviceId: '' } : undefined,
                        });
                      },
                      children: [
                        h('option', { value: 'astra', children: t('robotTitle') }),
                        h('option', { value: 'xiaozhi', children: t('robotXiaozhiTitle') }),
                      ],
                    }),
                  ],
                }),
                h('label', {
                  children: [
                    h('input', {
                      type: 'checkbox',
                      checked: draft.enabled,
                      onChange: (event: { target: { checked: boolean } }) =>
                        setDraft({ ...draft, enabled: event.target.checked }),
                    }),
                    t('robotEnabled'),
                  ],
                }),
                props.pets
                  ? h('label', {
                      children: [
                        t('robotLinkedPet'),
                        h('select', {
                          value: draft.petId,
                          onChange: (event: { target: { value: string } }) =>
                            setDraft({ ...draft, petId: event.target.value }),
                          children: [
                            ...(props.pets.some(({ id }) => id === draft.petId)
                              ? []
                              : [h('option', { value: draft.petId, children: draft.petId })]),
                            ...props.pets.map(({ id, name }) => h('option', { key: id, value: id, children: name })),
                          ],
                        }),
                      ],
                    })
                  : null,
                draft.xiaozhi
                  ? field(t('robotXiaozhiDeviceId'), draft.xiaozhi.deviceId, (deviceId) =>
                      setDraft({ ...draft, xiaozhi: { ...draft.xiaozhi, deviceId } }),
                    )
                  : field(t('robotAddress'), draft.address, (address) => setDraft({ ...draft, address })),
                draft.xiaozhi && props.pets
                  ? field(t('robotXiaozhiAddress'), draft.xiaozhi.apiUrl ?? '', (apiUrl) =>
                      setDraft({
                        ...draft,
                        xiaozhi: { deviceId: draft.xiaozhi!.deviceId, apiUrl: apiUrl || undefined },
                      }),
                    )
                  : null,
                h('div', {
                  className: 'pet-robot-chat-options',
                  children: [
                    h('strong', { children: t('robotChatTitle') }),
                    ...(['chatSpeech', 'chatActions', 'directExecution'] as const).map((key) =>
                      h('label', {
                        key,
                        children: [
                          h('input', {
                            type: 'checkbox',
                            checked: draft[key] === true,
                            onChange: (event: { target: { checked: boolean } }) =>
                              setDraft({
                                ...draft,
                                [key]: event.target.checked,
                                ...(key === 'directExecution' && event.target.checked ? { chatActions: true } : {}),
                                ...(key === 'chatActions' && !event.target.checked ? { directExecution: false } : {}),
                              }),
                          }),
                          t(
                            key === 'chatSpeech'
                              ? 'robotChatSpeechOption'
                              : key === 'chatActions'
                                ? 'robotChatActionsOption'
                                : 'robotDirectExecutionOption',
                          ),
                        ],
                      }),
                    ),
                    h('p', { className: 'pet-robot-note', children: t('robotChatOptionsHint') }),
                    h('p', {
                      className: 'pet-robot-note',
                      children: t(isXiaozhi ? 'robotXiaozhiDirectHint' : 'robotDirectExecutionHint'),
                    }),
                  ],
                }),
                h('details', {
                  children: [
                    h('summary', { children: t('robotAdvanced') }),
                    field(
                      t('robotTimeout'),
                      String(draft.timeoutSeconds),
                      (value) => setDraft({ ...draft, timeoutSeconds: Number(value) }),
                      'number',
                    ),
                    ...rows.map((item) =>
                      h(ActionFields, {
                        key: item.key,
                        item,
                        catalog,
                        update: (change: Partial<RobotActionDraft>) =>
                          setRows((old) => old.map((row) => (row.key === item.key ? { ...row, ...change } : row))),
                        remove: () => setRows((old) => old.filter((row) => row.key !== item.key)),
                      }),
                    ),
                    h('button', {
                      type: 'button',
                      disabled: rows.length >= 20,
                      onClick: () =>
                        setRows((old) => [
                          ...old,
                          {
                            key: 'action-' + robotRequestId().slice(0, 8),
                            name: '',
                            tool: isXiaozhi ? 'xiaozhiMcp' : 'startTeachProgram',
                            target: '',
                            petAnimation: '',
                          },
                        ]),
                      children: t(isXiaozhi ? 'robotXiaozhiAdd' : 'robotAdd'),
                    }),
                  ],
                }),
                h('button', { type: 'submit', children: t('robotSave') }),
              ],
            }),
            message ? h('p', { role: 'status', children: message }) : null,
          ],
        }),
        isXiaozhi && props.saveDeviceToken
          ? h('div', {
              children: [
                h('p', { className: 'pet-robot-note', children: t('robotXiaozhiTokenHint') }),
                h('label', {
                  children: [
                    t('robotXiaozhiToken'),
                    h('input', {
                      type: 'password',
                      value: token,
                      autoComplete: 'new-password',
                      maxLength: 4096,
                      disabled: props.disabled || !savedApiUrl || draft.xiaozhi?.apiUrl !== savedApiUrl,
                      onChange: (event: { target: { value: string } }) => setToken(event.target.value),
                    }),
                  ],
                }),
                h('button', {
                  type: 'button',
                  disabled: props.disabled || !savedApiUrl || draft.xiaozhi?.apiUrl !== savedApiUrl || !token.trim(),
                  onClick: () => {
                    void props.saveDeviceToken?.(token.trim()).then((ok) => {
                      if (ok) setToken('');
                    });
                  },
                  children: t('robotXiaozhiTokenSave'),
                }),
              ],
            })
          : null,
      ],
    });
  };
}
