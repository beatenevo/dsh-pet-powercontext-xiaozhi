/** 验证滑块提交可被宿主读取的周期，保留其他事件且不改变碎碎念开关。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { jsx } from 'react/jsx-runtime';
import { makeLivelinessCard } from './liveliness-card.ts';
import { readMainConfig } from './config/read.ts';
import { buildSaveBody, type SaveFields } from './config/http.ts';
import { saveUserConfig } from '../../host/config/save.ts';
import { automaticWhisperSchedule } from '../../host/whisper-policy.ts';
import { LIVELINESS_PRESETS, livelinessLevel } from '../../shared/liveliness.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}
const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
function flatten(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== 'object') return [];
  const item = node as Node;
  return [item, ...flatten(item.props?.children)];
}
test('liveliness is monotonic, bounded and keeps the current default at its midpoint', () => {
  assert.equal(LIVELINESS_PRESETS[0].whisper, 1800);
  assert.equal(LIVELINESS_PRESETS[100].whisper, 60);
  assert.deepEqual(LIVELINESS_PRESETS[50], { whisper: 600, weights: { idle: 10, turn: 5, move: 5 } });
  for (let i = 0; i <= 100; i++) {
    assert.equal(livelinessLevel(LIVELINESS_PRESETS[i].whisper), i);
    if (i > 0) {
      assert.ok(LIVELINESS_PRESETS[i].whisper < LIVELINESS_PRESETS[i - 1].whisper);
      assert.ok(LIVELINESS_PRESETS[i].weights.idle <= LIVELINESS_PRESETS[i - 1].weights.idle);
    }
  }
});
test('slider round-trip preserves other event timers and disabled chatter', () => {
  const Card = makeLivelinessCard({ h, t: (key: string) => key } as never);
  const periods = { whisper: 125, balance: 1800, sleepTalk: 90 };
  let changed: Record<string, unknown> | undefined;
  const tree = Card({
    busy: false,
    periods,
    onChange: (next, weights) => {
      changed = buildSaveBody({ pets: [], eventsRefreshSec: next, animationWeights: weights } as unknown as SaveFields);
    },
  });
  assert.equal(changed, undefined, 'Rendering must not replace custom settings');
  const slider = flatten(tree).find((node) => node.props?.type === 'range')!;
  (slider.props.onChange as (event: unknown) => void)({ target: { value: '100' } });
  const patch = readMainConfig({ main: changed! })!;
  assert.deepEqual(patch.eventsRefreshSec, { whisper: 60, balance: 1800, sleepTalk: 90 });
  assert.deepEqual(periods, { whisper: 125, balance: 1800, sleepTalk: 90 });
  assert.deepEqual(automaticWhisperSchedule(undefined, false, patch.eventsRefreshSec!.whisper), {
    enabled: false,
    periodSec: 60,
  });
  assert.equal(
    flatten(Card({ busy: true, periods, onChange: () => {} })).find((node) => node.props?.type === 'range')?.props
      .disabled,
    true,
  );
});

test('host save accepts liveliness periods and retains omitted timers', () => {
  const pets = [
    {
      id: 'pet',
      name: 'Pet',
      display: 'web',
      size: 200,
      balanceEnabled: false,
      whisperEnabled: false,
      position: { corner: 'top-left', marginX: 0, marginY: 0 },
    },
  ];
  const existing = { pets, eventsRefreshSec: { whisper: 300, balance: 900 } };
  const saved = saveUserConfig(
    { pets, eventsRefreshSec: { whisper: 60, balance: 900 }, animationWeights: LIVELINESS_PRESETS[100].weights },
    existing,
  );
  assert.ok(saved);
  assert.deepEqual(saved.eventsRefreshSec, { whisper: 60, balance: 900 });
  assert.deepEqual(saveUserConfig({ pets }, saved)?.eventsRefreshSec, saved.eventsRefreshSec);
  for (const value of [null, [], { whisper: -1 }, { whisper: 0 }, { whisper: Infinity }])
    assert.equal(saveUserConfig({ pets, eventsRefreshSec: value }, existing), null);
});
