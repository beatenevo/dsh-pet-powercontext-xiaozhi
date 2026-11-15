/** Authenticated experiment lifecycle; no client-supplied endpoint, credentials or trace identities. */
import type { RouteHandler } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
export const handleComparisonRoutes: RouteHandler = async (deps, { rest, method, body }) => {
  if (rest !== 'comparison' && rest !== 'comparison/cancel' && rest !== 'comparison/continue') return;
  if (!deps.comparison) return failResult('unsupported', 'comparison_unavailable');
  if (rest === 'comparison/cancel') {
    if (method !== 'POST') return methodNotAllowed();
    deps.comparison.cancel();
    return okResult({ ok: true }, { 'cache-control': 'no-store' });
  }
  if (method === 'GET' && rest === 'comparison')
    return okResult({ run: deps.comparison.snapshot() }, { 'cache-control': 'no-store' });
  if (method !== 'POST') return methodNotAllowed();
  let value: unknown;
  try {
    value = JSON.parse(body ?? 'null');
  } catch {
    return invalidJson();
  }
  try {
    return okResult(
      { run: rest === 'comparison/continue' ? deps.comparison.continue(value) : deps.comparison.start(value) },
      { 'cache-control': 'no-store' },
    );
  } catch (error) {
    const code =
      error instanceof Error &&
      ['comparison_busy', 'comparison_model_required', 'comparison_unavailable', 'comparison_not_reusable'].includes(
        error.message,
      )
        ? error.message
        : 'comparison_input_invalid';
    return failResult('bad-request', code);
  }
};
