/** Provider-reported counts; input excludes the separately reported cache buckets. Missing is unknown. */
export interface ReportedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Invalid counters must not appear as measured zeros. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
