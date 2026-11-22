/** 通过真实 HTTP 测试验证密钥作用域、向量维度和只检查不保存的边界。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedMemory } from './managed-memory.ts';
import { checkSetupModel } from './setup-check.ts';

test('independent checks reuse endpoint-scoped keys and preserve settings on success or failure', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pet-model-check-'));
  const calls: Array<{ path: string; auth?: string; body: Record<string, unknown> }> = [];
  let deny = false;
  const server = createServer(async (req, res) => {
    let raw = '';
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
    calls.push({ path: req.url!, auth: req.headers.authorization, body: JSON.parse(raw) });
    res.setHeader('content-type', 'application/json');
    res.statusCode = deny ? 401 : 200;
    res.end(
      JSON.stringify(
        deny
          ? { error: 'private-provider-detail' }
          : req.url?.endsWith('/embeddings')
            ? { data: [{ embedding: [0.1, 0.2, 0.3] }] }
            : { choices: [{ message: { content: 'hello' } }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let memory = new ManagedMemory(home);
  t.after(async () => {
    await memory.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });
  await memory.configure({
    baseUrl: base + '/llm',
    model: 'chat',
    apiKey: 'saved-llm',
    embeddingBaseUrl: base + '/vector',
    embeddingModel: 'embed',
    embeddingApiKey: 'saved-vector',
    embeddingDimension: 3,
  });
  const before = memory.settings();
  await memory.dispose();
  memory = new ManagedMemory(home);
  const signal = new AbortController().signal;
  const generation = { action: 'check', kind: 'generation', baseUrl: base + '/llm', model: 'chat', apiKey: '' };
  assert.deepEqual(await checkSetupModel(generation, signal, memory), { ok: true });
  assert.equal(calls[calls.length - 1]?.path, '/llm/chat/completions');
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer saved-llm');
  const embedding = {
    ...generation,
    kind: 'embedding',
    baseUrl: base + '/vector',
    model: 'embed',
    dimension: 3,
    sendDimensions: true,
  };
  assert.deepEqual(await checkSetupModel(embedding, signal, memory), { ok: true });
  assert.equal(calls[calls.length - 1]?.path, '/vector/embeddings');
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer saved-vector');
  assert.equal(calls[calls.length - 1]?.body.dimensions, 3);
  await checkSetupModel({ ...embedding, apiKey: 'replacement', sendDimensions: false }, signal, memory);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer replacement');
  assert.equal(calls[calls.length - 1]?.body.dimensions, undefined);
  assert.deepEqual(await checkSetupModel({ ...embedding, dimension: 4 }, signal, memory), {
    ok: false,
    errorCode: 'embedding_dimension',
  });
  deny = true;
  assert.deepEqual(await checkSetupModel(generation, signal, memory), { ok: false, errorCode: 'chat_authentication' });
  assert.deepEqual(await checkSetupModel(embedding, signal, memory), {
    ok: false,
    errorCode: 'embedding_authentication',
  });
  await checkSetupModel({ ...generation, baseUrl: base + '/different' }, signal, memory);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer local');
  const count = calls.length;
  assert.deepEqual(await checkSetupModel({ ...generation, baseUrl: 'https://other.example/v1' }, signal, memory), {
    ok: false,
    errorCode: 'chat_key_required',
  });
  assert.deepEqual(await checkSetupModel({ ...embedding, dimension: 0 }, signal, memory), {
    ok: false,
    errorCode: 'invalid_setup',
  });
  assert.equal(calls.length, count);
  assert.deepEqual(memory.settings(), before);
  assert.equal(memory.running, false);
});
