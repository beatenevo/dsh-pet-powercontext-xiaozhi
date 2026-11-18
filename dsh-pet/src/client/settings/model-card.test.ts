/**
 * Contract testing of the "AI Model and Dialogue Context" card (src/client/settings/model-card.ts).
 *
 * Two contracts:
 * 1. The check status of the three dialogue switches comes from `values` , and the switch returns the configuration
 * field name (misplaced key names will silently damage other switches);
 * 2. When busy, all controls are disabled and the model selector also gets the same busy.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';
import { makeModelCard, type ChatFlagValues } from './model-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** Model selector stand-in: only hang out props as it is, so that the assertion busy can be transferred easily. */
const Picker = ((props: Record<string, unknown>) => ({ tag: 'select', props })) as never;
const ModelCard = makeModelCard({ h, t: (key: string) => key } as never, Picker);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const allOff: ChatFlagValues = {
  whisperImageEnabled: false,
  chatImageEnabled: false,
  chatAnimationEnabled: false,
};

/** The three dialogue switch boxes: there is no checked in the digital input props, so distinguish accordingly. */
const toggles = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'input' && node.props.checked !== undefined);

/** Complete input of a card; uncovered fields are given fixed values. */
function props(values: ChatFlagValues, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    busy: false,
    catalog: null,
    failed: false,
    whisperModel: { kind: 'follow' },
    chatModel: { kind: 'follow' },
    onModelChange: () => {},
    chatMemory: 6,
    chatImageLimit: 10,
    onChatMemoryChange: () => {},
    onChatImageLimitChange: () => {},
    values,
    onFlagChange: () => {},
    ...over,
  };
}

describe('ModelCard——Dialogue switch', () => {
  test('All three switches are present, and the checked state comes from values', () => {
    const tree = ModelCard(
      props({ whisperImageEnabled: true, chatImageEnabled: false, chatAnimationEnabled: true }) as never,
    );
    const found = toggles(tree);
    assert.equal(found.length, 3, 'There should be three dialogue switches');
    assert.deepEqual(
      found.map((box) => box.props.checked),
      [true, false, true],
    );
  });

  test('Each switch returns its own configuration field name', () => {
    const seen: Array<[string, boolean]> = [];
    const tree = ModelCard(
      props(allOff, { onFlagChange: (key: string, value: boolean) => seen.push([key, value]) }) as never,
    );
    for (const box of toggles(tree)) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(
      seen.map(([key]) => key),
      ['whisperImageEnabled', 'chatImageEnabled', 'chatAnimationEnabled'],
    );
    assert.ok(
      seen.every(([, value]) => value === true),
      'What is returned must be a Boolean value, not an event object',
    );
  });

  test('Busy switches and selectors are all disabled', () => {
    const tree = ModelCard(props(allOff, { busy: true }) as never);
    for (const box of toggles(tree)) assert.equal(box.props.disabled, true);
    // The selector itself is a component, h will not expand it: find the two grids according to the component reference.
    const pickers = flatten(tree).filter((node) => (node.tag as unknown) === Picker);
    assert.equal(pickers.length, 2, 'Each of the two model grids has a selector');
    for (const picker of pickers) assert.equal(picker.props.disabled, true);
  });
});

test('hides legacy DSH sharing without silently changing saved settings', () => {
  let changed: unknown;
  const tree = ModelCard(
    props(allOff, {
      longTermMemory: { ...DEFAULT_CHAT_MEMORY, backend: 'dsh-powercontext' },
      onLongTermMemoryChange: (value: unknown) => {
        changed = value;
      },
    }) as never,
  );
  const nodes = flatten(tree);
  const select = nodes.find((node) => node.tag === 'select' && node.props.value === 'dsh-powercontext');
  assert.ok(select);
  assert.ok(nodes.some((node) => node.tag === 'option' && node.props.value === 'native'));
  const legacy = nodes.find((node) => node.tag === 'option' && node.props.value === 'dsh-powercontext');
  assert.equal(legacy?.props.hidden, true);
  assert.equal(legacy?.props.disabled, true);
  assert.equal(changed, undefined);
  assert.deepEqual(
    nodes.filter((node) => node.tag === 'option' && !node.props.hidden).map((node) => node.props.value),
    ['native', 'powercontext'],
  );
  assert.equal(
    nodes.some((node) => node.tag === 'input' && node.props.type === 'url'),
    false,
  );
  (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'native' } });
  assert.deepEqual(changed, DEFAULT_CHAT_MEMORY);
});
