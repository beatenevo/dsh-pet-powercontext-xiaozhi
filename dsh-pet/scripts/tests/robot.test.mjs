// Real React controls against synthetic HTTP state; no robot or model requests.
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
const require = createRequire(import.meta.url);
let server, browser, origin, state, requests, delayExecute, releaseExecute;
before(async () => {
  const modulePath = (name) =>
    JSON.stringify(fileURLToPath(new URL(`../../src/client/robot/${name}.ts`, import.meta.url)));
  const code = `import React from ${JSON.stringify(require.resolve('react'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import { jsx } from ${JSON.stringify(require.resolve('react/jsx-runtime'))};
import { makeRobotPanel } from ${modulePath('panel')};
import { robotEn } from ${modulePath('locales')};
import { ROBOT_CSS } from ${modulePath('styles')};
document.head.appendChild(document.createElement('style')).textContent=ROBOT_CSS;
const Panel=makeRobotPanel({h:jsx,useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,t:(key)=>robotEn[key]});
createRoot(document.getElementById('root')).render(React.createElement(Panel,{petId:'main'}));`;
  const bundle = await rolldown({
    input: 'virtual:robot',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'robot-entry',
        resolveId: (id) => (id === 'virtual:robot' ? id : null),
        load: (id) => (id === 'virtual:robot' ? code : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<div id="root"></div><script src="/app.js"></script>');
      return;
    }
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(output[0].code);
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      requests.push(request);
      if (request.action === 'arm') state.armed = true;
      if (request.action === 'configure') {
        state.config = request.config;
        state.session = randomUUID();
        state.armed = false;
        state.connected = false;
        state.pendingAction = undefined;
      }
      if (request.action === 'dismiss-chat-action') state.pendingAction = undefined;
      if (request.action === 'execute' || request.action === 'confirm-chat-action') {
        state.pendingAction = undefined;
        state.armed = false;
        state.busy = true;
        if (delayExecute)
          await new Promise((resolve) => {
            releaseExecute = resolve;
          });
        else {
          state.busy = false;
          state.commands = [
            { id: request.id, key: 'Greeting', state: 'reported-success', message: 'Synthetic controller response' },
          ];
        }
      }
      if (request.action === 'stop') {
        state.armed = false;
        state.connected = false;
        state.busy = false;
        state.stopResult = {
          ok: false,
          code: 'stop_unsupported',
          message: 'Local wait cancelled; physical state remains unknown',
        };
      }
    }
    res.end(JSON.stringify({ ok: true, ...state }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
beforeEach(() => {
  requests = [];
  delayExecute = false;
  releaseExecute = undefined;
  state = {
    session: randomUUID(),
    config: {
      enabled: true,
      chatSpeech: false,
      chatActions: false,
      address: 'http://127.0.0.1:8182/hz-dual-robot-product/mcp',
      version: 2,
      directExecution: false,
      timeoutSeconds: 30,
      petId: 'main',
      actions: [
        { key: 'greet', name: 'Greeting', tool: 'startTeachProgram', target: '9007199254740993123', petAnimation: '' },
      ],
    },
    catalog: { programs: [{ id: '9007199254740993124', name: 'Wave' }], areas: [] },
    armed: false,
    busy: false,
    checking: false,
    stopping: false,
    connected: true,
    checkedAt: Date.now(),
    telemetry: { actionCode: 520000, description: 'Synthetic idle', modes: [1, 1, 1] },
    error: '',
    commands: [],
  };
});
after(async () => {
  releaseExecute?.();
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
async function open(t, title = 'Astra Pro 2.0 robot', status = 'MCP connected (verify physical state on site)') {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'The DSH JSX runtime must render robot controls without errors'));
  t.after(() => page.close());
  await page.goto(origin);
  await page.locator('[data-robot-panel] > summary').getByText(title, { exact: true }).click();
  await page.getByText(status, { exact: true }).waitFor();
  return page;
}

test('opening controls sends no motion; each selected action requires explicit one-shot authorization', async (t) => {
  const page = await open(t);
  const run = page.getByRole('button', { name: 'Run selected physical action', exact: true });
  assert.equal(await run.isDisabled(), true);
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Verified stationary on site: allow one action' }).click();
  await page.getByText('One action authorized', { exact: true }).waitFor();
  await run.click();
  await page.getByText('Physical actions are disarmed', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.deepEqual(
    requests.map((x) => x.action),
    ['arm', 'execute'],
  );
  assert.equal(requests[1].key, 'greet');
  assert.equal(requests[1].confirmed, true);
  assert.match(requests[1].id, /^[a-f0-9-]{36}$/);
  await page.getByText('Recent requests', { exact: true }).click();
  await page.getByText(/Greeting: Controller reported success/).waitFor();
  await page.getByText('Synthetic controller response', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancel local wait', exact: true }).isEnabled(), true);
});

test('local cancellation stays available during an unresolved execute request without claiming a physical stop', async (t) => {
  const page = await open(t);
  delayExecute = true;
  t.after(() => releaseExecute?.());
  await page.getByRole('button', { name: 'Verified stationary on site: allow one action' }).click();
  await page.getByText('One action authorized', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run selected physical action' }).click();
  await page.waitForFunction(() => document.querySelector('button.pet-robot-stop')?.disabled === false);
  await page.getByRole('button', { name: 'Cancel local wait', exact: true }).click();
  await page.getByText('Local wait cancelled; physical state remains unknown', { exact: true }).waitFor();
  assert.deepEqual(
    requests.map((x) => x.action),
    ['arm', 'execute', 'stop'],
  );
  await page
    .getByText(
      'MCP has no stop tool. Cancelling a wait does not stop the robot. Verify on site; use the physical emergency stop when needed.',
      { exact: true },
    )
    .waitFor();
  releaseExecute();
  await page.getByText('Physical actions are disarmed', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run selected physical action' }).isDisabled(), true);
});

test('discovered program identifiers remain exact strings when saving MCP settings', async (t) => {
  const page = await open(t);
  await page.getByText('Robot connection', { exact: true }).click();
  await page.getByText('Advanced: action mappings and timeout (optional)', { exact: true }).click();
  await page.getByLabel('Discovered program or station', { exact: true }).selectOption('9007199254740993124');
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Disconnected or stale status', { exact: true }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'configure');
  assert.equal(requests[0].config.actions[0].target, '9007199254740993124');
  assert.equal(requests[0].config.actions[0].tool, 'startTeachProgram');
  assert.equal(requests[0].config.version, 2);
  assert.equal(requests[0].config.directExecution, false);
  assert.equal(state.armed, false);
});

test('chat interaction switches save explicit opt-ins for the current pet', async (t) => {
  const page = await open(t);
  await page.getByText('Robot connection', { exact: true }).click();
  const speech = page.getByRole('checkbox', { name: 'Speak all pet messages through the robot' });
  const actions = page.getByRole('checkbox', { name: 'Allow robot actions from chat' });
  assert.equal(await speech.isChecked(), false);
  assert.equal(await actions.isChecked(), false);
  await speech.check();
  await actions.check();
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Disconnected or stale status', { exact: true }).waitFor();
  assert.equal(requests[0].config.chatSpeech, true);
  assert.equal(requests[0].config.chatActions, true);
  assert.equal(requests[0].config.petId, 'main');
});

test('XiaoZhi settings save the selected device tool and fixed arguments', async (t) => {
  state.config.address = '';
  state.config.xiaozhi = { deviceId: '9007199254740993123' };
  state.config.actions = [];
  state.catalog = {
    programs: [],
    areas: [],
    xiaozhiTools: [{ name: 'self_arm_raise', arguments: ['arm'], required: ['arm'] }],
  };
  const page = await open(t, 'XiaoZhi robot', 'XiaoZhi device tools discovered');
  await page.getByText('Robot connection', { exact: true }).click();
  await page.getByText('Advanced: action mappings and timeout (optional)', { exact: true }).click();
  await page.getByRole('button', { name: 'Add XiaoZhi action' }).click();
  await page.locator('.pet-robot-action-row').getByLabel('Action name', { exact: true }).fill('抬手');
  await page.getByLabel('Discovered XiaoZhi device tool').selectOption('self_arm_raise');
  await page.getByLabel(/Fixed arguments/).fill('[]');
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Action arguments must be a JSON object such as {}.').waitFor();
  assert.equal(requests.length, 0);
  await page.getByLabel(/Fixed arguments/).fill('{"arm":"left"}');
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Disconnected or stale status', { exact: true }).waitFor();
  assert.equal(requests[0].config.xiaozhi.deviceId, '9007199254740993123');
  assert.equal(requests[0].config.actions[0].target, 'self_arm_raise');
  assert.deepEqual(requests[0].config.actions[0].arguments, { arm: 'left' });
});

test('a chat-selected action stays visible and sends only its proposal identity after confirmation', async (t) => {
  const id = randomUUID();
  state.pendingAction = { id, petId: 'main', key: 'greet', name: 'Greeting', expiresAt: Date.now() + 120000 };
  state.chatSpeech = { id: randomUUID(), petId: 'main', state: 'reported-success' };
  const page = await open(t);
  const card = page.getByRole('region', { name: 'Chat interaction' });
  await card.getByText('Greeting', { exact: true }).waitFor();
  await card.getByText('Pet speech: Speech request accepted (playback completion unknown)').waitFor();
  assert.equal(requests.length, 0);
  await card.getByRole('button', { name: 'Confirm on site and run this action' }).click();
  await page.getByText('Recent requests', { exact: true }).click();
  await page.getByText(/Greeting: Controller reported success/).waitFor();
  assert.deepEqual(requests, [{ action: 'confirm-chat-action', session: state.session, id, confirmed: true }]);
  assert.equal(await page.getByRole('button', { name: 'Confirm on site and run this action' }).count(), 0);
});

test('dismissal removes the proposed action without an execute request', async (t) => {
  const id = randomUUID();
  state.pendingAction = { id, petId: 'main', key: 'greet', name: 'Greeting', expiresAt: Date.now() + 120000 };
  const page = await open(t);
  await page.getByRole('button', { name: 'Dismiss action', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss action', exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(requests, [{ action: 'dismiss-chat-action', session: state.session, id }]);
});
