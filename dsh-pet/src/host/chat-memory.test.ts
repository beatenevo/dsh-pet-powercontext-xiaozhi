/**
 * Unit test for writing conversation memory - verify two types of picture information in "Chat Record Archive": record
 * the attachment reference for the user message with picture, and record the meme name for the assistant
 * message with picture; the field set of the two messages in the round without picture must be exactly the same as
 * before adding the field (pure incremental, without destroying the old format). It also covers the wiring of
 * third-party memory providers: recall injection, failure downgrade, receiving parameters and error isolation.
 *
 * Take the real memory.json persist to disk (temporary directory isolation), the default configuration is
 * assets/config.jsonc in the warehouse (the same copy as production, no second copy by hand); LLM is driven by a fake
 * stream and is not connected to the Internet.
 *
 * Running method: node --experimental-strip-types --test src/host/chat-memory.test.ts
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setImmediate as flush } from 'node:timers/promises';
import { createRobotService } from './robot/service.ts';
import { defaultRobotConfig } from './robot/config.ts';
import type { RobotCall } from './robot/worker.ts';

import { DEFAULT_CHAT_MEMORY } from '../shared/chat-memory-config.ts';
import { DSH_MEMORY_PROTOCOL, DSH_MEMORY_SERVICE } from './dsh-memory.ts';
import { createChatMemory, type ChatMemoryInput } from './plugin/chat-memory.ts';
import type { ChatMemoryMessage } from './chat.ts';
import type { ConfigPaths } from './config.ts';
import { PollStateStore } from './state.ts';
import type { PetImageRef } from './image-attachment.ts';
import { registerChatMemoryProvider, resetChatMemoryProviders } from './chat-memory-provider.ts';

/** An image reference that has been persisted to disk: the fields are consistent with those returned by the attachment service. */
const IMAGE: PetImageRef = {
  attachmentId: '9f2c4a1b',
  mediaType: 'image/png',
  bytes: 10108,
  width: 257,
  height: 173,
};

/**
 * A fake ctx: The dialogue generates read-only agentDefaultModel and llm.stream, reply is the sentence returned by the
 * model. Once `captured` is passed, options of each stream will be included (the assertion prompt word is injected
 * into which paragraphs).
 */
function fakeCtx(reply: string, captured?: Record<string, unknown>[]): unknown {
  return {
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
    llm: {
      stream: (options: unknown) => {
        captured?.push(options as Record<string, unknown>);
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: reply };
        })();
      },
    },
  };
}

/** Temporary workspace: User configuration is isolated from the memory directory, and the default configuration points back to the one in the warehouse. */
function tempWorkspace(overlay: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-memory-test-'));
  const configPaths: ConfigPaths = {
    defaultFile: fileURLToPath(new URL('../../assets/config.jsonc', import.meta.url)),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'), // Does not exist = No file pet
  };
  writeFileSync(configPaths.userFile, JSON.stringify(overlay));
  return { dir, configPaths, memeDir: join(dir, 'memes'), userRoot: join(dir, 'user') };
}

/**
 * Create a conversation memory; memeDir default = no meme directory (the pool is empty). `collect.writes`
 * records the "pet.leaf" of each bubble leaf written, and `collect.records` is retained together with the payload
 * (used for the assertion field).
 */
function createMemory(
  reply: string,
  ws: ReturnType<typeof tempWorkspace>,
  memeDir?: string,
  collect?: {
    writes?: string[];
    records?: Array<{ petId: string; leaf: string; data: Record<string, unknown> }>;
  },
  captured?: Record<string, unknown>[],
  getService?: (name: string) => unknown,
  environment: ChatMemoryInput['environment'] = async () => ({}),
  robot?: ChatMemoryInput['robot'],
  state = new PollStateStore(),
) {
  state.onPetWrite((petId, leaf, data) => {
    collect?.writes?.push(petId + '.' + leaf);
    collect?.records?.push({ petId, leaf, data: data as Record<string, unknown> });
  });
  return createChatMemory({
    environment,
    robot,
    ctx: { ...(fakeCtx(reply, captured) as object), ...(getService ? { get: getService } : {}) },
    configPaths: ws.configPaths,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    memeDirsFor: () => (memeDir === undefined ? [] : [memeDir]),
    // The playback receipt table only uses create: the number contains the pet and action name, and the test is based on this assertion which action is written into the leaf.
    playback: { create: (petId: string, name: string) => ({ playbackId: 'pb-' + petId + '-' + name }) },
    state,
    userRoot: ws.userRoot,
  } as unknown as ChatMemoryInput);
}

/** Take out the user text of this round (the first text block of the last message) from stream options. */
function userTextOf(options: Record<string, unknown> | undefined): string {
  const messages = options?.messages as Array<{ content: Array<{ type: string; text?: string }> }> | undefined;
  const last = messages?.[messages.length - 1];
  return last?.content?.find((block) => block.type === 'text')?.text ?? '';
}

/** Read back the memory message just persisted to disk (there should be only one pet and one bucket). */
function readMessages(userRoot: string): ChatMemoryMessage[] {
  const mem = JSON.parse(readFileSync(join(userRoot, 'memory.json'), 'utf8')) as Record<
    string,
    Record<string, { messages: ChatMemoryMessage[] }>
  >;
  const buckets = Object.values(mem).flatMap((byPet) => Object.values(byPet));
  const bucket = buckets[0];
  assert.ok(bucket && buckets.length === 1, "A pet's memory should be write-only accessed");
  return bucket.messages;
}

describe('createChatMemory - Picture information is written to the memory file', () => {
  test('A round with pictures: user records the attachment reference as it is, assistant does not add meme fields out of thin air', async () => {
    const ws = tempWorkspace();
    try {
      const r = await createMemory('好看', ws).chatWithPet('main', '看看这个', IMAGE);
      assert.equal(r.ok, true);
      const messages = readMessages(ws.userRoot);
      assert.equal(messages.length, 2);
      const assistant = messages[1];
      assert.ok(assistant);
      assert.deepEqual(messages[0]?.image, IMAGE, 'user message should be saved intact with attachment reference');
      assert.equal('meme' in assistant, false, 'There is no picture in this round, so the meme field is not allowed.');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('A round without a graph: The field sets of the two messages are consistent byte by byte before adding the fields.', async () => {
    const ws = tempWorkspace();
    try {
      const r = await createMemory('在的', ws).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      const messages = readMessages(ws.userRoot);
      assert.equal(messages.length, 2);
      for (const m of messages) {
        assert.deepEqual(Object.keys(m).sort(), ['content', 'role', 'ts'], 'image / meme fields should not appear');
      }
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('A round with pictures: assistant Write down the name of the meme, but the marks in the text are still stripped off', async () => {
    const ws = tempWorkspace({ chatImageEnabled: true, memes: { 可爱: '卖萌立绘' } });
    mkdirSync(ws.memeDir, { recursive: true });
    writeFileSync(join(ws.memeDir, '可爱.png'), '');
    try {
      const r = await createMemory('你好呀\n[图:可爱]', ws, ws.memeDir).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      const assistant = readMessages(ws.userRoot)[1];
      assert.ok(assistant);
      assert.equal(assistant.meme, '可爱', 'assistant message should record the picture name');
      assert.equal(
        assistant.content,
        '你好呀',
        'Picture tags belong to the display layer and must not be left in the memory text.',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory —— whisper with specified picture', () => {
  /** There are two pictures and files in the pool; the automatic picture matching switch is turned off, which is used to verify that "the roll call is not affected by the automatic switch gating". */
  function poolWorkspace(overlay: Record<string, unknown> = {}) {
    const ws = tempWorkspace({
      whisperImageEnabled: false,
      memes: { 可爱: '卖萌立绘', 生气: '鼓腮帮子' },
      ...overlay,
    });
    mkdirSync(ws.memeDir, { recursive: true });
    writeFileSync(join(ws.memeDir, '可爱.png'), '');
    writeFileSync(join(ws.memeDir, '生气.png'), '');
    return ws;
  }

  test('Name the picture in the roll call pool: Use this picture to speak, and the automatic picture matching switch will take effect even if it is turned off.', async () => {
    const ws = poolWorkspace();
    const writes: string[] = [];
    try {
      const r = await createMemory('随便一句', ws, ws.memeDir, { writes }).publishWhisper('main', '生气');
      assert.equal(r.ok, true);
      assert.equal(r.ok === true ? r.image : '', '生气', 'The one named must be used and cannot be drawn randomly.');
      assert.deepEqual(writes, ['main.say'], 'Write bubble leaf once when successful');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Name the picture that does not exist: unknown-image, and do not write bubble', async () => {
    const ws = poolWorkspace();
    const writes: string[] = [];
    try {
      const r = await createMemory('不该生成', ws, ws.memeDir, { writes }).publishWhisper('main', '查无此图');
      assert.equal(r.ok, false);
      assert.equal(r.ok === false ? r.reason : '', 'unknown-image');
      assert.deepEqual(
        writes,
        [],
        'Do not write the leaf when the failure is clear, otherwise it will be equivalent to silently changing the leaf.',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('The configuration has been written but the image file has been deleted: Same as unknown-image (the pool determines the existence of the file)', async () => {
    const ws = poolWorkspace();
    rmSync(join(ws.memeDir, '生气.png'));
    try {
      const r = await createMemory('不该生成', ws, ws.memeDir).publishWhisper('main', '生气');
      assert.equal(r.ok === false ? r.reason : '', 'unknown-image');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('No naming: keep the original behavior (switch off = plain text, without image)', async () => {
    const ws = poolWorkspace();
    try {
      const r = await createMemory('纯文本一句', ws, ws.memeDir).publishWhisper('main');
      assert.equal(r.ok, true);
      assert.equal(
        r.ok === true && 'image' in r,
        false,
        'Pictures should not be included when automatic picture matching is turned off',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('voiceTo: If it is passed, use the passed one. If not, press display for derivation (default pet display = both → desktop)', async () => {
    const ws = poolWorkspace({ voiceEnabled: true });
    const records: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    try {
      await createMemory('随便一句', ws, ws.memeDir, { records }).publishWhisper('main', undefined, 'web');
      assert.equal(records[0]?.data.voiceTo, 'web', 'Explicit incoming takes precedence over display');

      await createMemory('纯文本一句', ws, ws.memeDir, { records }).publishWhisper('main');
      assert.equal(
        records[1]?.data.voiceTo,
        'desktop',
        'Press display when there is no transmission. Derivation: Desktop priority',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
  test('Each of the four types of voice is determined by its own switch: for period whisper, see voiceWhisperEnabled, for manual trigger, see voiceEnabled', async () => {
    const off = tempWorkspace();
    const offRecords: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    try {
      await createMemory('一句', off, off.memeDir, { records: offRecords }).publishWhisper(
        'main',
        undefined,
        undefined,
        'whisper',
      );
      assert.equal(
        'voiceTo' in (offRecords[0]?.data ?? {}),
        false,
        'The whisper period when the switch is off should not be written voiceTo',
      );

      await createMemory('一句', off, off.memeDir, { records: offRecords }).publishWhisper('main');
      assert.equal(
        'voiceTo' in (offRecords[1]?.data ?? {}),
        false,
        'When the manual broadcast switch is turned off, manual triggering should not write voiceTo.',
      );
    } finally {
      rmSync(off.dir, { recursive: true, force: true });
    }

    const on = tempWorkspace({ voiceWhisperEnabled: true, voiceEnabled: true });
    const onRecords: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    try {
      await createMemory('一句', on, undefined, { records: onRecords }).publishWhisper(
        'main',
        undefined,
        undefined,
        'whisper',
      );
      assert.equal(
        onRecords[0]?.data.voiceTo,
        'desktop',
        'After the switch is turned on, the whisper period is as usual with voiceTo',
      );

      await createMemory('一句', on, undefined, { records: onRecords }).publishWhisper('main');
      assert.equal(
        onRecords[1]?.data.voiceTo,
        'desktop',
        'After the switch is turned on, manual triggering works as usual with voiceTo',
      );
    } finally {
      rmSync(on.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory - conversation reply voiceTo', () => {
  test('When replying to the leaf, please indicate which end should be read (the dialogue request does not have a specific end, it is deduced according to display)', async () => {
    const ws = tempWorkspace({ voiceEnabled: true });
    const records: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    try {
      const r = await createMemory('在的', ws, undefined, { records }).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      assert.equal(records[0]?.data.voiceTo, 'desktop', 'Default pet display = both, desktop priority');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('The manual broadcast switch is turned off: the reply still says bubble, and the leaves do not include voiceTo', async () => {
    const ws = tempWorkspace();
    const records: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    try {
      const r = await createMemory('在的', ws, undefined, { records }).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      assert.equal(records[0]?.leaf, 'say', 'bubble shot');
      assert.equal('voiceTo' in (records[0]?.data ?? {}), false, 'This key should not be written when it is closed');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory——Dialogue action linkage', () => {
  /** Collect which leaves and payloads are written in a conversation. */
  type Records = Array<{ petId: string; leaf: string; data: Record<string, unknown> }>;

  test('Hit action: first write anim leaf (with playbackId), then write bubble anim:false, remember action and peel off the text mark', async () => {
    const ws = tempWorkspace();
    const records: Records = [];
    try {
      const r = await createMemory('好呀～看我转一圈！\n[动作:优雅女仆舞]', ws, undefined, { records }).chatWithPet(
        'main',
        '跳个舞吧',
      );
      assert.equal(r.ok, true);
      assert.deepEqual(
        records.map((x) => x.leaf),
        ['anim', 'say'],
        'Write the action first and then write the bubble: the renderer receives the action first, and the bubble will not push it away.',
      );
      const anim = records[0];
      assert.equal(anim?.data.name, '优雅女仆舞');
      assert.match(String(anim?.data.playbackId), /^pb-/);
      const say = records[1];
      assert.equal(say?.data.anim, false, 'Bubble is not linked to whisper animation when taking action');
      assert.equal(say?.data.text, '好呀～看我转一圈！');
      const assistant = readMessages(ws.userRoot)[1];
      assert.equal(assistant?.content, '好呀～看我转一圈！', 'Marks must not be left on the memory text.');
      assert.equal(
        assistant?.action,
        '优雅女仆舞',
        'The memory must be able to restore what was performed in this round',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('write-only tag has no text: perform actions, do not write say (do not play empty bubbles)', async () => {
    const ws = tempWorkspace();
    const records: Records = [];
    try {
      const r = await createMemory('[动作:原地小憩沉眠]', ws, undefined, { records }).chatWithPet('main', '累了吧');
      assert.equal(r.ok, true);
      assert.deepEqual(
        records.map((x) => x.leaf),
        ['anim'],
      );
      assert.equal(readMessages(ws.userRoot)[1]?.content, '');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('No action selected: anim leaves are not written, and bubbles do not contain anim:false (the same as before adding the function)', async () => {
    const ws = tempWorkspace();
    const records: Records = [];
    try {
      await createMemory('在的', ws, undefined, { records }).chatWithPet('main', '在吗');
      assert.equal(
        records.some((x) => x.leaf === 'anim'),
        false,
      );
      const say = records.find((x) => x.leaf === 'say');
      assert.equal('anim' in (say?.data ?? {}), false);
      assert.equal('action' in (readMessages(ws.userRoot)[1] ?? {}), false);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('chatAnimationEnabled = false: No injection or parsing, the mark remains in the text as it is.', async () => {
    const ws = tempWorkspace({ chatAnimationEnabled: false });
    const records: Records = [];
    try {
      const r = await createMemory('好的\n[动作:优雅女仆舞]', ws, undefined, { records }).chatWithPet(
        'main',
        '跳个舞吧',
      );
      assert.equal(r.ok, true);
      assert.equal(
        records.some((x) => x.leaf === 'anim'),
        false,
        'Action leaves must not be written when closed',
      );
      assert.equal(
        r.ok === true ? r.text : '',
        '好的\n[动作:优雅女仆舞]',
        'Not parsed when closed, mark remains intact',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory —— prompt word injection (pictures/actions are independent)', () => {
  test('小智声纹提示只进入当前语音轮的模型请求', async () => {
    const ws = tempWorkspace();
    const captured: Record<string, unknown>[] = [];
    try {
      const memory = createMemory('在的', ws, undefined, undefined, captured);
      const speakerPrompt = '当前说话人是小明。';
      await memory.chatWithPet('main', '你认出我了吗？', undefined, undefined, { speakerPrompt });
      await memory.chatWithPet('main', '你好。', undefined, undefined, {});
      assert.match(JSON.stringify(captured[0].system), /当前说话人是小明。/);
      assert.doesNotMatch(JSON.stringify(captured[1].system), /当前说话人是小明。/);
      assert.equal(readMessages(ws.userRoot)[0].content, '你认出我了吗？');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Both switches are on: user The text contains both a picture list and an action list.', async () => {
    const ws = tempWorkspace({ chatImageEnabled: true, memes: { 可爱: '卖萌立绘' } });
    mkdirSync(ws.memeDir, { recursive: true });
    writeFileSync(join(ws.memeDir, '可爱.png'), '');
    const captured: Record<string, unknown>[] = [];
    try {
      await createMemory('在的', ws, ws.memeDir, undefined, captured).chatWithPet('main', '在吗');
      const text = userTextOf(captured[0]);
      assert.ok(text.includes('[配图]'), 'Picture drawing instructions should be injected');
      assert.ok(text.includes('[动作]'), 'Action instructions should be injected');
      assert.ok(text.includes('- 可爱：卖萌立绘'), 'The list of pictures must be accompanied by a description.');
      assert.ok(text.includes('- 优雅女仆舞'), 'The action list must include names');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Both switches are off: user The text only contains the user’s original words', async () => {
    const ws = tempWorkspace({ chatImageEnabled: false, chatAnimationEnabled: false });
    const captured: Record<string, unknown>[] = [];
    try {
      await createMemory('在的', ws, undefined, undefined, captured).chatWithPet('main', '在吗');
      assert.equal(userTextOf(captured[0]), '在吗');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory - Delete conversation memory', () => {
  /** Preset a file with two rounds of memory (the timestamp is fixed to avoid relying on the real clock). */
  function seed(userRoot: string): void {
    mkdirSync(userRoot, { recursive: true });
    const messages = [
      { role: 'user', content: '第一问', ts: 1000 },
      { role: 'assistant', content: '第一答', ts: 1000 },
      { role: 'user', content: '第二问', ts: 2000 },
      { role: 'assistant', content: '第二答', ts: 2000 },
    ];
    writeFileSync(join(userRoot, 'memory.json'), JSON.stringify({ main: { main: { messages } } }));
  }

  test('Press ts to delete: the hit rounds are removed in pairs, and the remaining rounds are kept as they are.', async () => {
    const ws = tempWorkspace();
    seed(ws.userRoot);
    try {
      const r = await createMemory('无关', ws).deleteHistory('main', [1000]);
      assert.deepEqual(r, { ok: true, removed: 2 });
      const rest = readMessages(ws.userRoot);
      assert.deepEqual(
        rest.map((m) => m.content),
        ['第二问', '第二答'],
        'Only delete the two lines of ts =1000, the other round must be left intact',
      );
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Non-existent ts → removed is 0, the file content remains unchanged (the memory is not rewritten due to no-operation)', async () => {
    const ws = tempWorkspace();
    seed(ws.userRoot);
    const before = readFileSync(join(ws.userRoot, 'memory.json'), 'utf8');
    try {
      const r = await createMemory('无关', ws).deleteHistory('main', [999]);
      assert.deepEqual(r, { ok: true, removed: 0 });
      assert.equal(readFileSync(join(ws.userRoot, 'memory.json'), 'utf8'), before);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Without ts → clear the whole one, and remove the empty leaves and empty entries together', async () => {
    const ws = tempWorkspace();
    seed(ws.userRoot);
    try {
      const r = await createMemory('无关', ws).deleteHistory('main');
      assert.deepEqual(r, { ok: true, removed: 4 });
      const mem = JSON.parse(readFileSync(join(ws.userRoot, 'memory.json'), 'utf8')) as Record<string, unknown>;
      assert.deepEqual(mem, {}, 'Empty entries or empty pet leaves should not remain after clear');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Pet does not exist → unknown-pet, and the file is not written', async () => {
    const ws = tempWorkspace();
    try {
      const r = await createMemory('无关', ws).deleteHistory('nobody');
      assert.equal(r.ok, false);
      assert.equal(r.ok === false ? r.reason : '', 'unknown-pet');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('createChatMemory - Third-party memory provider', () => {
  beforeEach(() => resetChatMemoryProviders());

  test('Not registered: The request is unchanged from the input of this round (no evidence block)', async () => {
    const ws = tempWorkspace({ chatImageEnabled: false, chatAnimationEnabled: false });
    const captured: Record<string, unknown>[] = [];
    try {
      await createMemory('在的', ws, undefined, undefined, captured).chatWithPet('main', '在吗');
      const messages = captured[0]?.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
      const last = messages[messages.length - 1];
      assert.equal(last?.content.length, 1, 'There is only one text block in this round when there is no recall');
      assert.equal(last?.content[0]?.text, '在吗');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('recall: The patch covers system and userText, and the core is generated with the modified content', async () => {
    registerChatMemoryProvider({
      id: 'pc',
      recall: async () => ({ system: '改后的人设', userText: '改后的问题' }),
    });
    const ws = tempWorkspace({ chatImageEnabled: false, chatAnimationEnabled: false });
    const captured: Record<string, unknown>[] = [];
    try {
      await createMemory('记住啦', ws, undefined, undefined, captured).chatWithPet('main', '在吗');
      assert.equal(captured[0]?.system, '改后的人设');
      assert.equal(userTextOf(captured[0]), '改后的问题');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('recall error: reply as usual, the content is not modified', async () => {
    registerChatMemoryProvider({
      id: 'pc',
      recall: async () => {
        throw new Error('服务不可用');
      },
    });
    const ws = tempWorkspace({ chatImageEnabled: false, chatAnimationEnabled: false });
    const captured: Record<string, unknown>[] = [];
    try {
      const r = await createMemory('在的', ws, undefined, undefined, captured).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      assert.equal(userTextOf(captured[0]), '在吗');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('recall timeout: 1.5 s, then press continue without modification, the reply will be as usual', async () => {
    registerChatMemoryProvider({ id: 'pc', recall: () => new Promise<undefined>(() => {}) });
    const ws = tempWorkspace({ chatImageEnabled: false, chatAnimationEnabled: false });
    const captured: Record<string, unknown>[] = [];
    try {
      const r = await createMemory('在的', ws, undefined, undefined, captured).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      assert.equal(userTextOf(captured[0]), '在吗');
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Receive: After persist to disk, this round of Q&A and ts are received, and do not contain optional fields that do not appear.', async () => {
    const captured: Array<Record<string, unknown>> = [];
    registerChatMemoryProvider({
      id: 'pc',
      capture: (input) => {
        captured.push(input as unknown as Record<string, unknown>);
      },
    });
    const ws = tempWorkspace();
    try {
      const r = await createMemory('你好呀～', ws).chatWithPet('main', '你好');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(r.ok, true);
      assert.equal(captured.length, 1);
      const input = captured[0]!;
      assert.equal(input.petId, 'main');
      assert.equal(input.userText, '你好');
      assert.equal(input.replyText, '你好呀～');
      assert.equal(typeof input.ts, 'number');
      assert.equal('action' in input, false);
      assert.equal('image' in input, false);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('Receive error: does not affect the reply, nor does it affect the memory that has been persisted to disk', async () => {
    registerChatMemoryProvider({
      id: 'pc',
      capture: () => {
        throw new Error('上传失败');
      },
    });
    const ws = tempWorkspace();
    try {
      const r = await createMemory('在的', ws).chatWithPet('main', '在吗');
      assert.equal(r.ok, true);
      assert.equal(readMessages(ws.userRoot).length, 2);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

describe('optional DSH project memory', () => {
  test('injects project memory, isolates project histories and never calls external capture', async () => {
    const ws = tempWorkspace({
      chatMemory: { ...DEFAULT_CHAT_MEMORY, backend: 'dsh-powercontext' },
      chatMemoryRounds: 10,
    });
    const captured: Record<string, unknown>[] = [];
    const calls: string[] = [];
    const service = {
      protocol: DSH_MEMORY_PROTOCOL,
      prepare: async ({ sessionId }: { sessionId: string }) => {
        calls.push(sessionId);
        return {
          status: 'ready',
          bindingId: (sessionId === 'alpha' ? 'a' : 'b').repeat(64),
          scopeId: sessionId,
          workspace: sessionId,
          content: sessionId + '-memory',
        };
      },
    };
    let externalCalls = 0;
    const dispose = registerChatMemoryProvider({
      id: 'unused',
      recall: async () => {
        externalCalls++;
        return undefined;
      },
      capture: async () => {
        externalCalls++;
      },
    });
    try {
      const memory = createMemory('answer', ws, undefined, undefined, captured, (name) =>
        name === DSH_MEMORY_SERVICE ? service : undefined,
      );
      assert.equal((await memory.chatWithPet('main', 'alpha-question', undefined, 'alpha')).ok, true);
      assert.equal((await memory.chatWithPet('main', 'beta-question', undefined, 'beta')).ok, true);
      assert.equal((await memory.chatWithPet('main', 'alpha-followup', undefined, 'alpha')).ok, true);
      assert.match(JSON.stringify(captured[0]), /alpha-memory/);
      assert.doesNotMatch(JSON.stringify(captured[1]), /alpha-question|alpha-memory/);
      assert.match(JSON.stringify(captured[2]), /alpha-question/);
      assert.doesNotMatch(JSON.stringify(captured[2]), /beta-question|beta-memory/);
      assert.deepEqual(calls, ['alpha', 'beta', 'alpha']);
      assert.equal(externalCalls, 0);
      const stored = JSON.parse(readFileSync(join(ws.userRoot, 'memory.json'), 'utf8'));
      assert.equal(stored.main.main.powercontext, undefined);
      writeFileSync(
        ws.configPaths.userFile,
        JSON.stringify({ chatMemory: { ...DEFAULT_CHAT_MEMORY }, chatMemoryRounds: 10 }),
      );
      await memory.chatWithPet('main', 'private-chat');
      assert.doesNotMatch(JSON.stringify(captured[3]), /alpha-question|beta-question|alpha-memory/);
      assert.equal(calls.length, 3);
    } finally {
      dispose();
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });

  test('a missing plugin keeps ordinary chat available without leaking project history', async () => {
    const ws = tempWorkspace({ chatMemory: { ...DEFAULT_CHAT_MEMORY, backend: 'dsh-powercontext' } });
    const captured: Record<string, unknown>[] = [];
    try {
      const memory = createMemory('ordinary reply', ws, undefined, undefined, captured);
      const result = await memory.chatWithPet('main', 'hello', undefined, 'alpha');
      assert.deepEqual(result, { ok: true, text: 'ordinary reply' });
      assert.equal(readMessages(ws.userRoot).length, 2);
      assert.match(JSON.stringify(await memory.memoryStatus('main', 'alpha')), /plugin-missing/);
      assert.doesNotMatch(JSON.stringify(captured), /prepared-context/);
    } finally {
      rmSync(ws.dir, { recursive: true, force: true });
    }
  });
});

test('available environment facts are included in the chat prompt', async () => {
  const ws = tempWorkspace();
  const captured: Record<string, unknown>[] = [];
  try {
    const memory = createMemory('hello', ws, undefined, undefined, captured, undefined, async () => ({
      city: 'TestCity',
    }));
    assert.equal((await memory.chatWithPet('main', 'hello')).ok, true);
    assert.match(JSON.stringify(captured[0].system), /TestCity/);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('unavailable weather cannot block a reply or local memory persistence', { timeout: 5000 }, async () => {
  const ws = tempWorkspace();
  try {
    const memory = createMemory(
      'still here',
      ws,
      undefined,
      undefined,
      undefined,
      undefined,
      () => new Promise(() => {}),
    );
    const result = await memory.chatWithPet('main', 'hello offline');
    assert.equal(result.ok, true);
    assert.equal(readMessages(ws.userRoot).slice(-1)[0]?.content, 'still here');
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

test('failed environment lookup still generates a reply', async () => {
  const ws = tempWorkspace();
  try {
    const memory = createMemory('still here', ws, undefined, undefined, undefined, undefined, async () => {
      throw new Error('weather offline');
    });
    assert.equal((await memory.chatWithPet('main', 'hello')).ok, true);
  } finally {
    rmSync(ws.dir, { recursive: true, force: true });
  }
});

for (const connected of [true, false]) {
  test(`chat-to-robot forwards only the saved reply and isolates ${connected ? 'available' : 'offline'} transport`, async (t) => {
    const ws = tempWorkspace();
    const calls: RobotCall[] = [];
    const state = new PollStateStore();
    const robot = createRobotService({
      userRoot: ws.userRoot,
      state,
      run: async (_config, call) => {
        calls.push(call);
        return call.operation === 'status'
          ? {
              ok: connected,
              code: 'status',
              message: 'Local fixture',
              catalog: {
                tools: ['getTeachProgramList', 'startTeachProgram'],
                programs: [{ id: '100', name: '挥手' }],
                areas: [],
              },
              telemetry: { actionCode: 520000, description: 'Idle', modes: [1, 1, 1] },
            }
          : { ok: true, code: 'reported_success', message: 'Local fixture accepted' };
      },
    });
    t.after(async () => {
      await robot.dispose();
      rmSync(ws.dir, { recursive: true, force: true });
    });
    await robot.submit({
      action: 'configure',
      config: {
        ...defaultRobotConfig(),
        enabled: true,
        address: 'http://127.0.0.1:8182/mcp',
        chatSpeech: true,
        chatActions: true,
        actions: [{ key: 'greet', name: '打招呼', tool: 'startTeachProgram', target: '100', petAnimation: '' }],
      },
    });
    const captured: Record<string, unknown>[] = [];
    const records: Array<{ petId: string; leaf: string; data: Record<string, unknown> }> = [];
    const reply = '你好，我是桌宠。打招呼动作等待现场确认。';
    const memory = createMemory(
      reply + '\n[robot_action:greet]',
      ws,
      undefined,
      { records },
      captured,
      undefined,
      async () => ({}),
      robot,
      state,
    );
    const result = await memory.chatWithPet('main', '介绍一下自己，再打个招呼');
    assert.deepEqual(result, { ok: true, text: reply });
    await flush();
    assert.match(userTextOf(captured[0]), /robot_action:KEY/);
    assert.match(userTextOf(captured[0]), /Host-observed robot MCP capabilities/);
    if (connected) {
      assert.match(userTextOf(captured[0]), /getTeachProgramList/);
      assert.match(userTextOf(captured[0]), /挥手/);
    }
    assert.match(userTextOf(captured[0]), /"name":"打招呼"/);
    assert.equal(readMessages(ws.userRoot)[1].content, reply);
    assert.equal(records.find((entry) => entry.leaf === 'say')?.data.text, reply);
    assert.equal(robot.snapshot().pendingAction?.key, 'greet');
    assert.equal(
      calls.some((call) => call.operation === 'execute'),
      false,
    );
    assert.equal(calls.filter((call) => call.operation === 'speak').length, connected ? 1 : 0);
    if (connected) assert.equal(calls.find((call) => call.operation === 'speak')?.text, reply);
    else assert.equal(robot.snapshot().chatSpeech?.reason, 'offline');
    const count = calls.length;
    await memory.readMemory();
    await flush();
    assert.equal(calls.length, count, 'Reading history must not replay speech or movement');
    const automatic = createMemory(
      '自动碎碎念和梦话 🐱',
      ws,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      robot,
      state,
    );
    assert.equal((await automatic.publishWhisper('main', undefined, undefined, 'whisper')).ok, true);
    await flush();
    assert.equal(await automatic.publishSleepTalk('main'), true);
    await flush();
    assert.equal(calls.filter((call) => call.operation === 'speak').length, connected ? 3 : 0);
    assert.equal(records.filter((entry) => entry.leaf === 'say').length, 3);
    assert.ok(
      records.filter((entry) => entry.leaf === 'say').every((entry) => !('voiceTo' in entry.data)),
      'Robot speech does not depend on computer TTS flags',
    );
  });
}
