/** Authenticated token replacement for local settings; never returns the credential in JSON. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { rejectRequest, type RequestSecurity } from './request-security.ts';
import { sendJson } from './server/respond.ts';

/** Save a fixed token and refresh this browser session after the previous credential is validated. */
export async function accessTokenHandler(
  req: IncomingMessage,
  res: ServerResponse,
  security: RequestSecurity,
): Promise<void> {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'PUT') {
    rejectRequest(res, 405, 'PUT required');
    return;
  }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    rejectRequest(res, 415, 'JSON required');
    return;
  }
  let token: unknown;
  try {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      req.once('end', resolve);
      req.once('error', reject);
    });
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { token?: unknown };
    token = input?.token;
  } catch {
    rejectRequest(res, 400, 'Invalid JSON');
    return;
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    rejectRequest(res, 400, 'Token must contain 43 letters, digits, underscores or hyphens');
    return;
  }
  if (!security.authorize(req, res)) return;
  try {
    security.rotate(token);
  } catch {
    rejectRequest(res, 500, 'Could not save the interface access token');
    return;
  }
  res.setHeader('set-cookie', `dsh_pet_token=${token}; HttpOnly; SameSite=Strict; Path=/`);
  sendJson(res, 200, { ok: true });
}
