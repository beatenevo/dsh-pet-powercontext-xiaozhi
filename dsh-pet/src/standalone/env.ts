/** 解析安装器的下载源；配置只用于安装进程，错误不包含地址或凭据。 */

/** 读取显式 HTTPS 镜像；未配置的下载环节使用安装器默认源。 */
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
  const uvBaseUrl = readUrl('DSH_PET_UV_DOWNLOAD_BASE_URL');
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['UV_DEFAULT_INDEX', 'UV_INDEX_URL', 'UV_PYTHON_INSTALL_MIRROR']) {
    const value = readUrl(key);
    if (value) env[key] = value;
  }
  if (!env.UV_DEFAULT_INDEX && !env.UV_INDEX_URL)
    env.UV_DEFAULT_INDEX = 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple';
  env.UV_PYTHON_INSTALL_MIRROR ??= 'https://registry.npmmirror.com/-/binary/python-build-standalone';
  return { uvBaseUrl, env };
}
