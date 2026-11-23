/** 托管数据库的运行环境规格；seekdb 使用单独环境，避免影响现有 SQLite 服务。 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../host/paths.ts';

/** 已安装记忆库的存储引擎；缺省保持 SQLite 兼容。 */
export type MemoryDatabase = 'sqlite' | 'seekdb';

/** 定位随包交付的服务入口，同时支持源码测试。 */
export function memoryRuntimePath(filename: string): string {
  const packaged = join(PACKAGE_ROOT, 'runtime', 'powercontext', filename);
  return existsSync(packaged) ? packaged : join(PACKAGE_ROOT, '..', 'runtime', 'powercontext', filename);
}

/** seekdb 的依赖与现有 SQLite 环境隔离安装。 */
export function memoryRuntimeDirectory(directory: string, database: MemoryDatabase): string {
  return database === 'seekdb' ? join(directory, 'seekdb-runtime') : directory;
}

/** 从唯一依赖清单读取两种存储引擎共用的 PowerContext 固定版本。 */
export function memoryRuntimeVersion(): string {
  const requirements = readFileSync(memoryRuntimePath('requirements.txt'), 'utf8');
  const version = requirements.match(/^powercontext\[[^\]]+\]==(\d+\.\d+\.\d+)\s*$/mu)?.[1];
  if (!version) throw new Error('runtime_manifest_invalid');
  return version;
}

/** 验证 seekdb 依赖及固定版本，避免升级时复用旧环境。 */
export function seekdbRuntimeCheck(): string {
  return (
    'import uvicorn, pylibseekdb, pymysql; from powercontext.server.settings import ServerSettings; from importlib.metadata import version; assert version("powercontext") == ' +
    JSON.stringify(memoryRuntimeVersion())
  );
}
