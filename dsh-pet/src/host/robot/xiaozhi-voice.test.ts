import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { startXiaozhiVoiceBridge } from './xiaozhi-voice.ts';

test('the voice bridge transcribes device PCM and returns a reply from the shared chat', async (t) => {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const { port } = address;
  const token = 'f'.repeat(64);
  const pcm = Buffer.from([1, 2, 3, 4]);
  const stop = startXiaozhiVoiceBridge({
    config: { port, token },
    hear: async (audio) => {
      assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
      assert.equal(audio.readUInt32LE(24), 16000);
      assert.equal(audio.readUInt16LE(22), 1);
      assert.deepEqual(audio.subarray(44), pcm);
      return { ok: true, text: '你好' };
    },
    chat: async (text) => {
      assert.equal(text, '你好');
      return { ok: true, text: '我在这里。' };
    },
    report: (message) => assert.fail(message),
  });
  t.after(stop);

  const http = `http://127.0.0.1:${port}/v1/chat/completions`;
  assert.equal((await fetch(http, { method: 'POST' })).status, 401);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  await once(socket, 'open');
  const result = once(socket, 'message');
  socket.send(JSON.stringify({ is_speaking: true, wav_name: 'probe', audio_fs: 16000, wav_format: 'pcm' }));
  socket.send(pcm);
  socket.send(JSON.stringify({ is_speaking: false, wav_name: 'probe' }));
  assert.deepEqual(JSON.parse((await result)[0]), { mode: 'offline', wav_name: 'probe', text: '你好', is_final: true });
  socket.close();

  const response = await fetch(http, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify({ messages: [{ role: 'user', content: '你好' }], stream: true }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /我在这里。.*\n\n.*\n\ndata: \[DONE\]/);
});
