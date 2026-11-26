/**
 * 接收小智 Go 服务的本地语音会话。
 * FunASR 接口将设备的 PCM 交给桌宠现有识别器，聊天接口将转写交给同一桌宠。
 * 小智服务负责播放这轮回复，宿主通过回环地址和单独的令牌接收聊天请求。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { readBody } from '../http.ts';
import type { HearResult } from '../voice/hear.ts';

/** 连接参数由本机小智服务和桌宠宿主共同使用。 */
export const xiaozhiVoiceConfigSchema = z.strictObject({
  port: z.number().int().min(1024).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

const sampleRate = 16_000;
const maxAudioBytes = sampleRate * 2 * 60;
const packetSchema = z.object({
  is_speaking: z.boolean(),
  wav_name: z.string().min(1).max(128).optional(),
  audio_fs: z.literal(sampleRate).optional(),
  wav_format: z.literal('pcm').optional(),
});
const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.string(), content: z.unknown() }))
    .min(1)
    .max(512),
  stream: z.boolean().optional(),
});

function wavFrom(chunks: Buffer[], size: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + size, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(size, 40);
  return Buffer.concat([header, ...chunks], size + header.length);
}

function sendReply(response: ServerResponse, text: string, stream: boolean): void {
  const meta = { id: 'chatcmpl-' + randomUUID(), created: Math.floor(Date.now() / 1000), model: 'dsh-pet' };
  if (!stream) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ...meta,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      }),
    );
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const choice of [
    { index: 0, delta: { role: 'assistant', content: text }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: 'stop' },
  ]) {
    response.write(`data: ${JSON.stringify({ ...meta, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
  }
  response.end('data: [DONE]\n\n');
}

/** 启动与宿主同生命周期的回环桥接。 */
export function startXiaozhiVoiceBridge(options: {
  config: z.infer<typeof xiaozhiVoiceConfigSchema>;
  hear: (audio: Buffer, signal: AbortSignal) => Promise<HearResult>;
  chat: (text: string) => Promise<{ ok: boolean; text?: string }>;
  report: (message: string) => void;
}): () => void {
  const expected = Buffer.from('Bearer ' + options.config.token);
  let chatting = false;
  let recognizing = false;
  const authority = '127.0.0.1:' + options.config.port;
  const server = createServer({ requestTimeout: 15_000 }, (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.host !== authority || request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
    } else if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401).end();
    } else if (chatting) {
      response.writeHead(409).end();
    } else {
      chatting = true;
      void (async () => {
        const parsed = chatSchema.parse(JSON.parse(await readBody(request, 256 * 1024)));
        const text = parsed.messages.reverse().find(({ role }) => role === 'user')?.content;
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
          response.writeHead(400).end();
          return;
        }
        const reply = await options.chat(text.trim());
        sendReply(response, reply.ok ? (reply.text ?? '') : '我现在无法回复，请检查桌宠的模型设置。', !!parsed.stream);
      })()
        .catch(() => {
          options.report('小智语音对话失败。');
          if (!response.headersSent) response.writeHead(500);
          response.end();
        })
        .finally(() => {
          chatting = false;
        });
    }
  });
  const sockets = new WebSocketServer({
    server,
    path: '/',
    maxPayload: maxAudioBytes,
    perMessageDeflate: false,
    verifyClient: ({ req }: { req: IncomingMessage }) =>
      req.headers.host === authority && req.headers.origin === undefined && sockets.clients.size < 4,
  });
  sockets.on('connection', (socket) => {
    const abort = new AbortController();
    const timeout = setTimeout(() => socket.terminate(), 125_000);
    let name: string | undefined;
    let size = 0;
    let completed = false;
    const chunks: Buffer[] = [];
    socket.on('error', () => socket.terminate());
    socket.once('close', () => {
      clearTimeout(timeout);
      abort.abort();
    });
    socket.on('message', (raw, binary) => {
      if (completed) return;
      if (!Buffer.isBuffer(raw)) return socket.close(1003);
      if (binary) {
        if (!name || size + raw.length > maxAudioBytes) return socket.close(1009);
        size += raw.length;
        chunks.push(raw);
        return;
      }
      const packet = (() => {
        try {
          return packetSchema.safeParse(JSON.parse(raw.toString('utf8')));
        } catch {
          return undefined;
        }
      })();
      if (!packet?.success) return socket.close(1007);
      if (packet.data.is_speaking) {
        if (name || !packet.data.wav_name) return socket.close(1008);
        name = packet.data.wav_name;
        return;
      }
      if (!name || (packet.data.wav_name && packet.data.wav_name !== name) || size % 2) return socket.close(1008);
      completed = true;
      const answer = (text: string) => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ mode: 'offline', wav_name: name, text, is_final: true }));
      };
      if (!size || recognizing) return answer('');
      recognizing = true;
      void options
        .hear(wavFrom(chunks, size), abort.signal)
        .then((result) => {
          if (!result.ok) options.report('小智语音识别失败（' + result.reason + '）。');
          answer(result.ok ? result.text.trim().slice(0, 2000) : '');
        })
        .catch(() => {
          options.report('小智语音识别失败。');
          answer('');
        })
        .finally(() => {
          recognizing = false;
        });
    });
  });
  sockets.on('error', () => options.report('小智语音桥 WebSocket 无法启动。'));
  server.on('error', () => options.report('小智语音桥 HTTP 无法启动。'));
  server.listen(options.config.port, '127.0.0.1');
  return () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.close();
    server.closeAllConnections();
  };
}
