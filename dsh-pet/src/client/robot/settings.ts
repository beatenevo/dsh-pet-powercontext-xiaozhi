/** Edit robot connection and manufacturer-provided action mappings in the chat panel. */
import type { RobotConfig, RobotCatalog } from '../../shared/robot.ts';
import { robotRequestId, type RobotRuntime } from './state.ts';
import { makeRobotActionFields, type RobotActionDraft } from './action-fields.ts';

/** Keep operator drafts separate from polled status. */
export function makeRobotSettings(rt: RobotRuntime) {
  const { h, t, useState } = rt;
  const ActionFields = makeRobotActionFields(rt);
  return function RobotSettings(props: {
    config: RobotConfig;
    catalog?: RobotCatalog;
    disabled: boolean;
    save: (config: RobotConfig) => Promise<boolean>;
  }) {
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
    const isXiaozhi = !!draft.xiaozhi;
    const catalog = !!props.config.xiaozhi === isXiaozhi ? props.catalog : undefined;
    const field = (label: string, value: string, onChange: (value: string) => void, type = 'text') =>
      h('label', {
        children: [
          label,
          h('input', { type, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
        ],
      });
    return h('details', {
      children: [
        h('summary', { children: t('robotSetup') }),
        h('p', { className: 'pet-robot-note', children: t(isXiaozhi ? 'robotXiaozhiQuickStart' : 'robotQuickStart') }),
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
                draft.xiaozhi
                  ? field(t('robotXiaozhiDeviceId'), draft.xiaozhi.deviceId, (deviceId) =>
                      setDraft({ ...draft, xiaozhi: { deviceId } }),
                    )
                  : field(t('robotAddress'), draft.address, (address) => setDraft({ ...draft, address })),
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
      ],
    });
  };
}
