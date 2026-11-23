import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryInstallSources } from './env.ts';

test('download sources keep upstream defaults and accept explicit mirror paths', () => {
  assert.deepEqual(memoryInstallSources({}), {
    uvBaseUrl: 'https://github.com/astral-sh/uv/releases/download',
    env: {},
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
    assert.deepEqual(memoryInstallSources({ [key]: '  ' }).env, {});
  }
});
