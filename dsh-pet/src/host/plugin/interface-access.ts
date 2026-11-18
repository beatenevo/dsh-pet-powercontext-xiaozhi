/** Persist plugin API credentials while reserving credential management for authenticated DSH sessions. */
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequestSecurity, secureResponse } from '../../standalone/request-security.ts';
import { readBody, sendJson } from '../http.ts';

/** Write-only credential state shared by all plugin HTTP requests. */
export interface PluginAccess {
  /** Whether the user has explicitly saved a credential. */
  readonly configured: boolean;
  /** Current credential; never expose it in status responses. */
  readonly token: string;
  /** Persist before activating the replacement. */
  rotate(token: string): void;
}

/** Load a private plugin credential independently of standalone authentication. */
export function createPluginAccess(file: string): PluginAccess {
  const security = createRequestSecurity({ file });
  let configured = existsSync(file);
  return {
    get configured() {
      return configured;
    },
    get token() {
      return security.token;
    },
    rotate(token) {
      security.rotate(token);
      configured = true;
    },
  };
}

/** Reject cross-site browser requests even when they include a valid credential. */
function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin === undefined) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
  } catch {
    return false;
  }
}

/** Match only an explicitly supplied current token; DSH cookies are handled separately. */
export function acceptsAccessToken(req: IncomingMessage, access: PluginAccess): boolean {
  const token = req.headers['x-dsh-pet-token'];
  return (
    access.configured &&
    sameOrigin(req) &&
    typeof token === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(token) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(access.token))
  );
}

/** Read credential status or rotate it after a second DSH authorization check. */
export async function handleAccessSettings(
  req: IncomingMessage,
  res: ServerResponse,
  access: PluginAccess,
  authorized: () => boolean,
): Promise<void> {
  secureResponse(res);
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: 'dsh_access_denied' });
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, { configured: access.configured });
    return;
  }
  if (req.method !== 'PUT') {
    sendJson(res, 405, { error: 'PUT required' });
    return;
  }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    sendJson(res, 415, { error: 'JSON required' });
    return;
  }
  let input: { token?: unknown } | null;
  try {
    input = JSON.parse(await readBody(req)) as typeof input;
  } catch (error) {
    sendJson(res, (error as { code?: string }).code === 'body-too-large' ? 413 : 400, { error: 'Invalid JSON' });
    return;
  }
  if (!authorized()) {
    sendJson(res, 403, { error: 'dsh_access_denied' });
    return;
  }
  if (typeof input?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
    sendJson(res, 400, { error: 'Token must contain 43 letters, digits, underscores or hyphens' });
    return;
  }
  try {
    access.rotate(input.token);
  } catch {
    sendJson(res, 500, { error: 'Could not save the interface access token' });
    return;
  }
  sendJson(res, 200, { ok: true, configured: true });
}
