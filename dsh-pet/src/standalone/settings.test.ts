import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { validateSettings, publicSettings } from './settings.ts';
import { settingsPage, settingsScript, settingsStyle } from './settings-page.ts';

/** A recorded request. */
type RecordedRequest = {
  url: string;
  options: { method: string; body?: string; headers: Record<string, string> };
};

/** Stand-in for getElementById: only implements those attributes used by the page script. */
type FakeElement = {
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  dataset: Record<string, string>;
  children: unknown[];
  listeners: Record<string, (event?: unknown) => Promise<void> | void>;
  addEventListener: (name: string, fn: (event?: unknown) => Promise<void> | void) => void;
  append: (...kids: unknown[]) => void;
  setAttribute: () => void;
  reportValidity: () => boolean;
  getBoundingClientRect: () => {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
};

/** createElement's stand-in: can be added, can set attributes, can point, and can be read. */
type FakeNode = {
  nodeType: number;
  isConnected: boolean;
  hidden: boolean;
  value: string;
  checked: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  children: FakeNode[];
  listeners: Record<string, () => void>;
  classList: { toggle(): void };
  append(...kids: unknown[]): void;
  setAttribute(): void;
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(): void;
  remove(): void;
  focus(): void;
  scrollIntoView(): void;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number };
  readonly firstElementChild: FakeNode | null;
};

/** The handle after a page startup: Each test has its own copy, and the status is not shared with each other. */
interface Page {
  /** Press id to get the elements accessed by the script at startup. */
  element(id: string): FakeElement;
  /** All requests issued by the script, in the order of issue. */
  requests: RecordedRequest[];
  /** The nodes created by createElement will be linked to body (menu, pop-up window). */
  body: FakeNode;
  /** Whether the address fragment has been cleared and what it is cleared to. */
  stripped(): string;
  /** Request hit to AI setup endpoint. */
  aiRequests(): RecordedRequest[];
  /** The request body of the last AI setting request. */
  lastAiBody(): Record<string, unknown>;
  /** The two buttons of the latest confirmation box; if they have not been played, they are empty arrays. */
  lastDialogActions(): FakeNode[];
}

/**
 * Create a page: fake DOM + real script.
 *
 * Each test is newly created to avoid mutual contamination between use cases - the script will send requests and
 * change element status when it is started.
 */
async function setupPage(): Promise<Page> {
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    if (!elements.has(id))
      elements.set(id, {
        value: '',
        checked: false,
        disabled: false,
        hidden: false,
        textContent: '',
        dataset: {},
        children: [],
        listeners: {},
        addEventListener(name, fn) {
          this.listeners[name] = fn;
        },
        append(...kids) {
          this.children.push(...kids);
        },
        setAttribute() {},
        reportValidity: () => true,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 36, width: 200, height: 36 }),
      });
    return elements.get(id)!;
  };
  const node = (): FakeNode => {
    const el: Record<string, unknown> = {
      nodeType: 1,
      isConnected: true,
      hidden: false,
      value: '',
      checked: false,
      disabled: false,
      textContent: '',
      className: '',
      style: {} as Record<string, string>,
      dataset: {} as Record<string, string>,
      children: [] as unknown[],
      listeners: {} as Record<string, () => void>,
      classList: { toggle() {} },
      append(...kids: unknown[]) {
        (el.children as unknown[]).push(...kids);
      },
      setAttribute() {},
      addEventListener(name: string, fn: () => void) {
        (el.listeners as Record<string, () => void>)[name] = fn;
      },
      removeEventListener() {},
      remove() {
        el.isConnected = false;
      },
      focus() {},
      scrollIntoView() {},
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 36, width: 200, height: 36 }),
      get firstElementChild() {
        return (el.children as Array<{ nodeType?: number }>).find((kid) => kid && kid.nodeType === 1) ?? null;
      },
    };
    return el as unknown as FakeNode;
  };

  const body = node();
  const requests: RecordedRequest[] = [];
  let stripped = '';
  runInNewContext(settingsScript, {
    URLSearchParams,
    // Page polling should not keep this isolated VM fixture alive after the test finishes.
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms).unref(),
    clearTimeout,
    console,
    window: { addEventListener() {}, removeEventListener() {}, innerHeight: 800, confirm: () => false },
    document: {
      getElementById: element,
      createElement: node,
      createElementNS: node,
      createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      body,
    },
    location: { hash: '#token=process-capability', pathname: '/standalone-ai/' },
    history: {
      replaceState: (_a: unknown, _b: unknown, path: string) => {
        stripped = path;
      },
    },
    fetch: async (url: string, options: RecordedRequest['options']) => {
      requests.push({ url, options });
      if (url === '/standalone-ai/models') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            models: [
              { id: 'm-one', name: 'M One' },
              { id: 'm-two', name: 'm-two' },
            ],
          }),
        };
      }
      if (url === '/standalone-ai/balance') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            provider: 'deepseek-official',
            shape: 'money',
            data: { wallets: [{ currency: 'CNY', total: '12.34', granted: '0.00', toppedUp: '12.34' }] },
          }),
        };
      }
      const clearing =
        url === '/standalone-ai/settings' && options.body ? JSON.parse(options.body).clearKey === true : false;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          service: 'deepseek-official',
          protocol: 'anthropic',
          baseUrl: 'https://example.test',
          model: 'x',
          profiles: {
            custom: { protocol: 'openai-compatible', baseUrl: 'https://mine.test', model: 'my-model' },
            'deepseek-official': { protocol: 'anthropic', baseUrl: 'https://example.test', model: 'x' },
            'opencode-go': { protocol: 'openai-compatible', baseUrl: 'https://opencode.test/v1', model: 'go-model' },
            commandcode: { protocol: 'openai-compatible', baseUrl: 'https://cc.test/v1', model: '' },
          },
          services: [
            { id: 'custom', label: '自定义', keyName: 'CUSTOM_API_KEY', protocol: 'openai-compatible' },
            {
              id: 'deepseek-official',
              label: 'DeepSeek 官方',
              keyName: 'DEEPSEEK_API_KEY',
              protocol: 'openai-compatible',
            },
            { id: 'opencode-go', label: 'opencode Go', keyName: 'OPENCODE_GO_API_KEY', protocol: 'openai-compatible' },
            { id: 'commandcode', label: 'commandcode', keyName: 'COMMANDCODE_API_KEY', protocol: 'openai-compatible' },
          ],
          savedKeys: clearing ? [] : ['DEEPSEEK_API_KEY'],
          hasKey: !clearing,
          automaticWhispers: false,
          whisperIntervalSec: 300,
          maxTokens: 1024,
        }),
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const aiRequests = () => requests.filter(({ url }) => url === '/standalone-ai/settings');
  return {
    element,
    requests,
    body,
    stripped: () => stripped,
    aiRequests,
    lastAiBody: () => {
      const list = aiRequests();
      return JSON.parse(list[list.length - 1].options.body ?? '{}');
    },
    lastDialogActions: () => {
      const masks = body.children.filter((kid) => kid.className === 'dialogMask');
      const panel = masks[masks.length - 1]?.children[0];
      return panel ? panel.children[2].children : [];
    },
  };
}

/** Wait for two rounds of event loops to allow the await chain in the script to settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('settings validation accepts per-service keys and profiles, rejects unknown fields', () => {
  const input = {
    service: 'custom',
    keys: { CUSTOM_API_KEY: '' },
    profiles: {
      custom: { protocol: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'model' },
    },
    automaticWhispers: false,
    whisperIntervalSec: 300,
    maxTokens: 512,
  };
  assert.deepEqual(validateSettings(input), input);
  assert.deepEqual(validateSettings({ clearKey: true }), { clearKey: true });
  for (const input of [
    null,
    [],
    { protocol: 'other' },
    { clearKey: 'yes' },
    { whisperIntervalSec: 59 },
    { whisperIntervalSec: 1.5 },
    { maxTokens: 99999 },
    { apiKey: 123 },
    { hasKey: true },
    { enabled: true },
    { baseUrl: 'file:///a' },
    {
      profiles: {
        custom: { protocol: 'openai-compatible', baseUrl: 'https://user:secret@example.test/v1', model: '' },
      },
    },
    { profiles: { custom: { protocol: 'openai-compatible', baseUrl: 'https://example.test/?key=secret', model: '' } } },
  ]) {
    assert.throws(() => validateSettings(input), Error, JSON.stringify(input));
  }
});

test('public settings are an allowlist even if backend accidentally includes credentials', () => {
  const actual = publicSettings({
    protocol: 'anthropic',
    service: 'deepseek-official',
    profiles: { custom: { protocol: 'anthropic', baseUrl: '', model: '' } },
    services: [{ id: 'custom', label: '自定义' }],
    apiKey: 'never expose',
    token: 'never expose',
    hasKey: true,
    model: 'x',
    enabled: false,
  });
  assert.deepEqual(actual, {
    protocol: 'anthropic',
    service: 'deepseek-official',
    profiles: { custom: { protocol: 'anthropic', baseUrl: '', model: '' } },
    services: [{ id: 'custom', label: '自定义' }],
    hasKey: true,
    model: 'x',
  });
  assert.equal(JSON.stringify(actual).includes('never expose'), false);
});

test('settings shell is accessible, self contained, and never saves browser secrets', () => {
  assert.match(settingsPage, /lang="zh-CN"/);
  assert.match(settingsPage, /type="password"/);
  assert.match(settingsPage, /aria-live="polite"/);
  assert.match(settingsPage, /data-tab="config"/);
  assert.match(settingsPage, /data-tab="chat"/);
  assert.match(settingsPage, /id="panel-config"/);
  assert.match(settingsScript, /history\.replaceState/);
  assert.match(settingsScript, /X-DSH-Pet-Token/);
  assert.doesNotMatch(settingsScript, /localStorage|sessionStorage|document\.cookie|innerHTML/);
  // Public provider presets are form values; the shell must not load remote resources or submit remotely.
  assert.doesNotMatch(settingsPage, /(?:src|href|action)=["']https?:\/\//);
  assert.match(settingsStyle, /focus-visible/);
});

test('Startup: The address fragment is cleared, the key box is clear and shows saved', async () => {
  const page = await setupPage();
  assert.equal(page.stripped(), '/standalone-ai/');
  assert.equal(page.element('apiKey').value, '');
  assert.equal(page.element('key-state').textContent, '已保存 · 不回显');
  assert.ok(
    page.aiRequests().every(({ options }) => options.headers['X-DSH-Pet-Token'] === 'process-capability'),
    'AI request must carry the access token for this run',
  );
});

test('保存：密钥只写不回显，按当前服务商提交 keys 与 profile', async () => {
  const page = await setupPage();
  page.element('apiKey').value = 'write-only-fake-key';
  await page.element('settings').listeners.submit({ preventDefault() {} });
  const body = page.lastAiBody() as unknown as {
    service: string;
    keys: Record<string, string>;
    profiles: Record<string, { protocol: string; baseUrl: string; model: string }>;
  };
  assert.equal(page.element('apiKey').value, '');
  assert.equal(body.service, 'deepseek-official');
  assert.deepEqual(body.keys, { DEEPSEEK_API_KEY: 'write-only-fake-key' });
  assert.deepEqual(body.profiles, {
    'deepseek-official': { protocol: 'anthropic', baseUrl: 'https://example.test', model: 'x' },
  });
  assert.equal('enabled' in body, false, '页面不再提交启用位');
});

test('Check balance: Click only after selecting a service provider. The result will be spelled into one line with the amount and the access token.', async () => {
  const page = await setupPage();
  await settle();
  const button = page.element('balance-btn');
  const result = page.element('balance-result');
  assert.equal(button.disabled, false, 'deepseek-official has been saved, the button should be clickable');

  const balanceRequests = () => page.requests.filter(({ url }) => url === '/standalone-ai/balance');
  await button.listeners.click();
  await settle();

  assert.equal(balanceRequests().length, 1);
  assert.equal(balanceRequests()[0].options.headers['X-DSH-Pet-Token'], 'process-capability');
  assert.match(result.textContent, /CNY 12\.34/);
  assert.equal(result.dataset.ok, 'true');
  assert.equal(button.disabled, false, 'After the query is completed, the button can be clicked again.');
});

test('删除密钥：先弹确认框，取消不发请求，确认才提交 clearKey 与当前服务商', async () => {
  const page = await setupPage();
  page.element('key-delete').listeners.click();
  await settle();
  assert.equal(page.lastDialogActions().length, 2, 'A confirmation box must pop up before deletion');

  const before = page.aiRequests().length;
  page.lastDialogActions()[0].listeners.click();
  await settle();
  assert.equal(page.aiRequests().length, before, 'No deletion request may be issued after cancellation');

  page.element('key-delete').listeners.click();
  await settle();
  page.lastDialogActions()[1].listeners.click();
  await settle();
  assert.equal(page.lastAiBody().clearKey, true);
  assert.equal(page.lastAiBody().service, 'deepseek-official', '删的必须是用户当前看到的这家');
  assert.equal(page.element('key-state').textContent, '尚未设置');
  assert.equal(
    page.element('key-actions').hidden,
    true,
    'Delete entry point is no longer displayed when there is no key',
  );
});

test('Pull model: request the endpoint with a form draft, write it back to the input box after selecting it and mark it as not saved', async () => {
  const page = await setupPage();
  page.element('baseUrl').value = 'https://draft.test/v1';
  page.element('apiKey').value = 'draft-key';
  page.element('model-toggle').listeners.click();
  await settle();

  const modelRequests = () => page.requests.filter(({ url }) => url === '/standalone-ai/models');
  assert.equal(modelRequests().length, 1);
  assert.deepEqual(JSON.parse(modelRequests()[0].options.body ?? '{}'), {
    protocol: 'anthropic',
    baseUrl: 'https://draft.test/v1',
    apiKey: 'draft-key',
  });
  assert.equal(modelRequests()[0].options.headers['X-DSH-Pet-Token'], 'process-capability');
  assert.match(page.element('model-result').textContent, /已拉取 2 个模型/);
  assert.equal(page.element('model').value, 'x', 'The pull itself must not modify the filled model');

  const menus = page.body.children.filter((kid) => kid.className === 'selectMenu');
  const menu = menus[menus.length - 1];
  assert.ok(menu, 'After pulling the model, the candidate menu must pop up directly');
  assert.equal(menu.children[0].className, 'selectSearchRow', '模型菜单必须先给一个搜索框');
  menu.children[1].listeners.click();
  assert.equal(page.element('model').value, 'm-one');
  assert.equal(page.element('dirty').hidden, false);
});

test('模型搜索：输入即过滤，大小写无关，清空恢复全部', async () => {
  const page = await setupPage();
  page.element('baseUrl').value = 'https://draft.test/v1';
  page.element('apiKey').value = 'draft-key';
  page.element('model-toggle').listeners.click();
  await settle();

  const menu = page.body.children.filter((kid) => kid.className === 'selectMenu').pop() as FakeNode;
  const search = menu.children[0].children[0];
  const first = menu.children[1];
  const second = menu.children[2];

  search.value = 'ONE';
  search.listeners.input();
  assert.equal(first.hidden, false, '「ONE」应该命中 M One');
  assert.equal(second.hidden, true, 'm-two 不该留在结果里');

  search.value = '';
  search.listeners.input();
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, false);
});
