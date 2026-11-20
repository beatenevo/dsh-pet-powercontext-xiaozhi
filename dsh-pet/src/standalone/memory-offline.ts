/** 校验离线包的原生运行环境；失败时禁止退回联网安装，数据仍由托管服务写入用户目录。 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 返回当前平台的随包 Python；普通 npm 包没有此目录，继续走原有安装流程。 */
export function offlineMemoryPython(bundle: string, requirements: string): string | undefined {
  if (!existsSync(bundle)) return undefined;
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object') throw new Error('offline_runtime_invalid');
    if (
      !('schema' in manifest) ||
      manifest.schema !== 1 ||
      !('platform' in manifest) ||
      manifest.platform !== process.platform ||
      !('arch' in manifest) ||
      manifest.arch !== process.arch ||
      !('requirementsSha256' in manifest) ||
      manifest.requirementsSha256 !== createHash('sha256').update(readFileSync(requirements)).digest('hex')
    )
      throw new Error('offline_runtime_invalid');
    const python = join(bundle, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3.12');
    if (!existsSync(python)) throw new Error('offline_runtime_invalid');
    return python;
  } catch {
    throw new Error('offline_runtime_invalid');
  }
}
