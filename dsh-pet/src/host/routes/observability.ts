/** Private host configuration and bounded connection checks; credentials are write-only. */
import type { RouteHandler } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

export const handleObservabilityRoutes: RouteHandler = async (deps, { rest, method, body }) => {
  if (rest !== 'observability' && rest !== 'observability/check') return;
  const service = deps.observability;
  if (!service) return failResult('unsupported', 'observability_unavailable');
  if (rest === 'observability/check') {
    if (method !== 'POST') return methodNotAllowed();
    try {
      return okResult({ ok: true, ...(await service.check()) }, { 'cache-control': 'no-store' });
    } catch {
      return failResult('bad-request', 'observability_disabled');
    }
  }
  if (method === 'GET') return okResult(service.snapshot(), { 'cache-control': 'no-store' });
  if (method !== 'PUT') return methodNotAllowed();
  let value: unknown;
  try {
    value = JSON.parse(body ?? 'null');
  } catch {
    return invalidJson();
  }
  try {
    return okResult(service.configure(value), { 'cache-control': 'no-store' });
  } catch {
    return failResult('bad-request', 'observability_configuration_failed');
  }
};
