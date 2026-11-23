import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryInstallSources } from './env.ts';

test('download sources default to domestic mirrors and accept explicit overrides', () => {
  assert.deepEqual(memoryInstallSources({}), {
    uvBaseUrl: undefined,
    env: {
      UV_DEFAULT_INDEX: 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple',
      UV_PYTHON_INSTALL_MIRROR: 'https://registry.npmmirror.com/-/binary/python-build-standalone',
    },
  });
  assert.deepEqual(
    memoryInstallSources({
      DSH_PET_UV_DOWNLOAD_BASE_URL: ' https://mirror.example/uv/releases/download/ ',
      UV_PYTHON_INSTALL_MIRROR: 'https://mirror.example/python/releases/download/',
      UV_DEFAULT_INDEX: 'https://mirror.example/pypi/simple/',
      UV_INDEX_URL: 'https://legacy.example/simple',
      UV_INSECURE_HOST: '*',
      UV_NO_CONFIG: '0',
    }),
    {
      uvBaseUrl: 'https://mirror.example/uv/releases/download',
      env: {
        UV_PYTHON_INSTALL_MIRROR: 'https://mirror.example/python/releases/download',
        UV_DEFAULT_INDEX: 'https://mirror.example/pypi/simple',
        UV_INDEX_URL: 'https://legacy.example/simple',
      },
    },
  );
});

test('invalid download sources return a safe error without echoing credentials', () => {
  for (const key of ['DSH_PET_UV_DOWNLOAD_BASE_URL', 'UV_PYTHON_INSTALL_MIRROR', 'UV_DEFAULT_INDEX', 'UV_INDEX_URL']) {
    for (const value of [
      'http://mirror.example',
      'file:///private/path',
      'https://user:secret@mirror.example',
      'https://mirror.example?token=secret',
      'https://mirror.example#secret',
      'not-a-url',
    ]) {
      assert.throws(() => memoryInstallSources({ [key]: value }), { message: 'runtime_download_config_invalid' });
    }
    assert.deepEqual(memoryInstallSources({ [key]: '  ' }), memoryInstallSources({}));
  }
});

test('a legacy explicit package index is not shadowed by the domestic default', () => {
  const { env } = memoryInstallSources({ UV_INDEX_URL: 'https://private.example/simple/' });
  assert.equal(env.UV_DEFAULT_INDEX, undefined);
  assert.equal(env.UV_INDEX_URL, 'https://private.example/simple');
  assert.equal(env.UV_PYTHON_INSTALL_MIRROR, 'https://registry.npmmirror.com/-/binary/python-build-standalone');
});
