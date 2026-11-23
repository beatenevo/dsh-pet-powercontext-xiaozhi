/** 解析安装器的下载源；配置只用于安装进程，错误不包含地址或凭据。 */

/** 读取显式 HTTPS 镜像，未设置时保持上游默认值。 */
export function memoryInstallSources(source: NodeJS.ProcessEnv = process.env) {
  const readUrl = (key: string): string | undefined => {
    const value = source[key]?.trim();
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
      return url.href.replace(/\/+$/, '');
    } catch {
      throw new Error('runtime_download_config_invalid');
    }
  };
  const uvBaseUrl = readUrl('DSH_PET_UV_DOWNLOAD_BASE_URL') ?? 'https://github.com/astral-sh/uv/releases/download';
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['UV_DEFAULT_INDEX', 'UV_INDEX_URL', 'UV_PYTHON_INSTALL_MIRROR']) {
    const value = readUrl(key);
    if (value) env[key] = value;
  }
  return { uvBaseUrl, env };
}
