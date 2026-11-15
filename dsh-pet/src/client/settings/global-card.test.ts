/**
 * Contract test of global switch card (src/client/settings/global-card.ts).
 *
 * Two contracts:
 * 1. The check status of the four switches comes from `values` , and the switch returns the configuration field name
 * (misplaced key names will silently damage other switches);
 * 2. Disable all when busy, and only callback once during a switch.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeGlobalCard, type GlobalFlags } from './global-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const GlobalCard = makeGlobalCard({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const allOff: GlobalFlags = {
  notificationsEnabled: false,
  notifyWhenFocused: false,
  clickSoundEnabled: false,
  confineToScreen: false,
  trayEnabled: false,
};

/** 五个开关的框，顺序即展示顺序。 */
const boxes = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'input');

describe('GlobalCard ——Global switch card', () => {
  test('五个开关都在，勾选态来自 values', () => {
    const tree = GlobalCard({
      busy: false,
      values: { ...allOff, notificationsEnabled: true, trayEnabled: true },
      onChange: () => {},
    } as never);
    const found = boxes(tree);
    assert.equal(found.length, 5);
    assert.deepEqual(
      found.map((box) => box.props.checked),
      [true, false, false, false, true],
    );
  });

  test('Each switch returns its own configuration field name', () => {
    const seen: Array<[string, boolean]> = [];
    const tree = GlobalCard({
      busy: false,
      values: allOff,
      onChange: (key: string, value: boolean) => seen.push([key, value]),
    } as never);
    for (const box of boxes(tree)) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(
      seen.map(([key]) => key),
      ['notificationsEnabled', 'notifyWhenFocused', 'clickSoundEnabled', 'confineToScreen', 'trayEnabled'],
    );
    assert.ok(
      seen.every(([, value]) => value === true),
      'What is returned must be a Boolean value, not an event object',
    );
  });

  test('Disable all when busy', () => {
    const tree = GlobalCard({ busy: true, values: allOff, onChange: () => {} } as never);
    for (const box of boxes(tree)) assert.equal(box.props.disabled, true);
  });
});
