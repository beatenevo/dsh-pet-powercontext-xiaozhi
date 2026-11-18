import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writePrivateJson } from './ai-storage.ts';
import { memoryObservabilityEnvironment } from './memory-observability.ts';

test('managed seekdb uses the saved Agent destination and refreshes credentials only on startup', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pet-memory-otel-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'powercontext');
  mkdirSync(directory);
  assert.equal(memoryObservabilityEnvironment(directory).POWERCONTEXT_SERVER_TRACING_ENABLED, 'false');
  const config = {
    enabled: true,
    baseUrl: 'https://vision.example/',
    agentId: '11111111-1111-4111-8111-111111111111',
    spaceId: '22222222-2222-4222-8222-222222222222',
    allowInsecureHttp: false,
    spaceKey: 'test-key',
  };
  const save = (patch: object) => writePrivateJson(join(root, 'observability.json'), { ...config, ...patch });
  save({});
  const env = memoryObservabilityEnvironment(directory);
  assert.equal(env.POWERCONTEXT_SERVER_TRACING_ENABLED, 'true');
  assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, 'https://vision.example/api/public/otel/v1/traces');
  assert.equal(
    Buffer.from(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS!.split('%20')[1], 'base64').toString(),
    config.agentId + ':test-key',
  );
  save({ baseUrl: 'https://user:password@vision.example' });
  assert.equal(memoryObservabilityEnvironment(directory).OTEL_EXPORTER_OTLP_TRACES_HEADERS, undefined);
  save({ enabled: false });
  assert.equal(memoryObservabilityEnvironment(directory).POWERCONTEXT_SERVER_TRACING_ENABLED, 'false');
});
