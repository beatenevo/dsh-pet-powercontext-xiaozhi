/** Edit robot connection and manufacturer-provided action mappings in the chat panel. */
import type { RobotConfig, RobotCatalog } from '../../shared/robot.ts';
import { robotRequestId, type RobotRuntime } from './state.ts';

/** Keep operator drafts separate from polled status. */
export function makeRobotSettings(rt: RobotRuntime) {
  const { h, t, useState } = rt;
  return function RobotSettings(props: {
    config: RobotConfig;
    catalog?: RobotCatalog;
    disabled: boolean;
    save: (config: RobotConfig) => Promise<boolean>;
  }) {
    const [draft, setDraft] = useState(props.config);
    const [rows, setRows] = useState(props.config.actions);
    const [message, setMessage] = useState('');
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
        h('form', {
          onSubmit: (event: { preventDefault(): void }) => {
            event.preventDefault();
            try {
              const config = {
                ...draft,
                actions: rows,
              };
              void props
                .save(config)
                .then((ok) =>
                  setMessage(
                    ok
                      ? t(config.directExecution && config.chatActions ? 'robotSavedDirect' : 'robotSaved')
                      : t('robotRequestError'),
                  ),
                );
            } catch {
              setMessage(t('robotInvalidIds'));
            }
          },
          children: [
            h('fieldset', {
              disabled: props.disabled,
              children: [
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
                field(t('robotAddress'), draft.address, (address) => setDraft({ ...draft, address })),
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
                    h('p', { className: 'pet-robot-note', children: t('robotDirectExecutionHint') }),
                  ],
                }),
                field(
                  t('robotTimeout'),
                  String(draft.timeoutSeconds),
                  (value) => setDraft({ ...draft, timeoutSeconds: Number(value) }),
                  'number',
                ),
                ...rows.map((item, index) => {
                  const update = (change: Partial<typeof item>) =>
                    setRows((old) => old.map((row, n) => (n === index ? { ...row, ...change } : row)));
                  return h('div', {
                    key: item.key,
                    className: 'pet-robot-action-row',
                    children: [
                      field(t('robotName'), item.name, (name) => update({ name })),
                      h('select', {
                        value: item.tool,
                        onChange: (event: { target: { value: 'startTeachProgram' | 'RobotAgvMove' } }) =>
                          update({ tool: event.target.value, target: '' }),
                        children: [
                          h('option', { value: 'startTeachProgram', children: t('robotProgram') }),
                          h('option', { value: 'RobotAgvMove', children: t('robotArea') }),
                        ],
                      }),
                      h('select', {
                        'aria-label': t('robotIds'),
                        value: item.target,
                        onChange: (event: { target: { value: string } }) => update({ target: event.target.value }),
                        children: [
                          h('option', { value: '', children: t('robotSelect') }),
                          ...(item.target ? [h('option', { value: item.target, children: item.target })] : []),
                          ...(item.tool === 'startTeachProgram'
                            ? (props.catalog?.programs ?? []).map((p) => ({ id: p.id, name: p.name }))
                            : (props.catalog?.areas ?? []).map((a) => ({ id: a.parameter, name: a.areaName }))
                          ).map((entry) => h('option', { value: entry.id, children: `${entry.name} (${entry.id})` })),
                        ],
                      }),
                      field(t('robotAnimation'), item.petAnimation, (petAnimation) => update({ petAnimation })),
                      h('button', {
                        type: 'button',
                        onClick: () => setRows((old) => old.filter((_, n) => n !== index)),
                        children: t('robotRemove'),
                      }),
                    ],
                  });
                }),
                h('button', {
                  type: 'button',
                  disabled: rows.length >= 20,
                  onClick: () =>
                    setRows((old) => [
                      ...old,
                      {
                        key: 'action-' + robotRequestId().slice(0, 8),
                        name: '',
                        tool: 'startTeachProgram',
                        target: '',
                        petAnimation: '',
                      },
                    ]),
                  children: t('robotAdd'),
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
