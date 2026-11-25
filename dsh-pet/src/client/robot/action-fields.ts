/** Edit action mappings against the controller's discovered catalog. */
import type { RobotAction, RobotCatalog } from '../../shared/robot.ts';
import type { RobotRuntime } from './state.ts';

/** Keep incomplete JSON editable between keystrokes. */
export type RobotActionDraft = Omit<RobotAction, 'arguments'> & { argumentText?: string };

/** Render one operator-owned action mapping. */
export function makeRobotActionFields({ h, t }: RobotRuntime) {
  return function RobotActionFields({
    item,
    catalog,
    update,
    remove,
  }: {
    item: RobotActionDraft;
    catalog?: RobotCatalog;
    update: (change: Partial<RobotActionDraft>) => void;
    remove: () => void;
  }) {
    const xiaozhi = item.tool === 'xiaozhiMcp';
    const deviceTool = catalog?.xiaozhiTools?.find(({ name }) => name === item.target);
    const options = xiaozhi
      ? (catalog?.xiaozhiTools ?? []).map(({ name }) => ({ value: name, label: name }))
      : item.tool === 'startTeachProgram'
        ? (catalog?.programs ?? []).map(({ id, name }) => ({ value: id, label: `${name} (${id})` }))
        : (catalog?.areas ?? []).map(({ parameter, areaName }) => ({
            value: parameter,
            label: `${areaName} (${parameter})`,
          }));
    const input = (label: string, key: 'name' | 'petAnimation') =>
      h('label', {
        children: [
          label,
          h('input', {
            value: item[key],
            onChange: (event: { target: { value: string } }) => update({ [key]: event.target.value }),
          }),
        ],
      });
    return h('div', {
      className: 'pet-robot-action-row',
      children: [
        input(t('robotName'), 'name'),
        xiaozhi
          ? null
          : h('select', {
              'aria-label': t('robotActionType'),
              value: item.tool,
              onChange: (event: { target: { value: 'startTeachProgram' | 'RobotAgvMove' } }) =>
                update({ tool: event.target.value, target: '' }),
              children: [
                h('option', { value: 'startTeachProgram', children: t('robotProgram') }),
                h('option', { value: 'RobotAgvMove', children: t('robotArea') }),
              ],
            }),
        h('select', {
          'aria-label': t(xiaozhi ? 'robotDeviceTool' : 'robotIds'),
          value: item.target,
          onChange: (event: { target: { value: string } }) =>
            update({
              target: event.target.value,
              ...(xiaozhi ? { argumentText: '{}' } : {}),
            }),
          children: [
            h('option', { value: '', children: t('robotSelect') }),
            ...(item.target && !options.some(({ value }) => value === item.target)
              ? [h('option', { value: item.target, children: item.target })]
              : []),
            ...options.map(({ value, label }) => h('option', { key: value, value, children: label })),
          ],
        }),
        xiaozhi
          ? h('label', {
              children: [
                t('robotToolArguments'),
                h('input', {
                  value: item.argumentText ?? '{}',
                  spellCheck: false,
                  onChange: (event: { target: { value: string } }) => update({ argumentText: event.target.value }),
                }),
                deviceTool?.arguments.length
                  ? h('small', {
                      children: deviceTool.arguments
                        .map((name) => (deviceTool.required.includes(name) ? name + ' *' : name))
                        .join(', '),
                    })
                  : null,
              ],
            })
          : null,
        input(t('robotAnimation'), 'petAnimation'),
        h('button', { type: 'button', onClick: remove, children: t('robotRemove') }),
      ],
    });
  };
}
