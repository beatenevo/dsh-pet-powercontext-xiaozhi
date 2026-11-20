/** 活泼程度预设：只在用户拖动时覆盖碎碎念周期与自主动作权重。 */
export const LIVELINESS_PRESETS = Array.from({ length: 101 }, (_, level) => ({
  whisper: Math.round(level <= 50 ? 1800 * (1 / 3) ** (level / 50) : 600 * (1 / 10) ** ((level - 50) / 50)),
  weights: { idle: Math.round(level <= 50 ? 90 - level * 1.6 : 10 - (level - 50) * 0.2), turn: 5, move: 5 },
}));

/** 根据现有周期选择最接近的滑块位置；加载不改写自定义配置。 */
export function livelinessLevel(period = 600): number {
  return LIVELINESS_PRESETS.reduce(
    (best, item, index) =>
      Math.abs(item.whisper - period) < Math.abs(LIVELINESS_PRESETS[best].whisper - period) ? index : best,
    0,
  );
}
