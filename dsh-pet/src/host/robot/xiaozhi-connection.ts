/** Validate the XiaoZhi endpoint and scope device credentials to that address. */
import { createHash } from 'node:crypto';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Parse the canonical OpenAPI root used by device discovery and dispatch. */
export function parseXiaozhiApiUrl(address: string): URL {
  const url = new URL(address);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !/\/api\/open\/v1\/?$/.test(url.pathname) ||
    url.username ||
    url.password ||
    /[?#\s\\]/.test(address)
  )
    throw new Error('xiaozhi_invalid_url');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/** Resolve a token per operation and store it via the host credential provider. */
export interface XiaozhiTokenStore {
  read(apiUrl: URL): Promise<string | undefined>;
  write(apiUrl: URL, token: string): Promise<void>;
}

/** Bind stored tokens to the canonical address so editing the URL cannot forward a previously saved token elsewhere. */
export function xiaozhiTokenRef(apiUrl: URL) {
  const digest = createHash('sha256').update(apiUrl.href).digest('hex');
  return credentialRef('DSH_PET_XIAOZHI_API_TOKEN_' + digest);
}
