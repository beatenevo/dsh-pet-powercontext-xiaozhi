/** Model output can propose only configured keys and never leaks control tags into speech. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRobotAction, formatXiaozhiActionReply, robotActionInstruction } from './chat.ts';

const actions = [{ key: 'greet', name: 'Greeting' }];

test('only exact configured keys become proposals and all control tags are removed', () => {
  assert.deepEqual(extractRobotAction('Hello!\n[robot_action:unknown]\n[robot_action:greet]', actions), {
    text: 'Hello!',
    key: 'greet',
  });
  assert.deepEqual(extractRobotAction('Hello!\n[robot_action:Greeting]', actions), { text: 'Hello!' });
  assert.deepEqual(extractRobotAction('Hello!\n[robot_action:greet]', []), { text: 'Hello!' });
  assert.deepEqual(extractRobotAction('Hello!', actions), { text: 'Hello!' });
});

test('catalog instructions distinguish proposals from authorized physical movement', () => {
  assert.equal(robotActionInstruction([]), '');
  const prompt = robotActionInstruction(actions);
  assert.match(prompt, /"key":"greet","name":"Greeting"/);
  assert.match(prompt, /on-site confirmation/);
  assert.match(prompt, /current user explicitly asks/);
});

test('direct mode describes an attempted dispatch without claiming physical completion', () => {
  const prompt = robotActionInstruction(actions, true);
  assert.match(prompt, /Direct execution mode is enabled/);
  assert.match(prompt, /current user explicitly asks/);
  assert.match(prompt, /do not ask for another confirmation or claim physical completion/);
  assert.doesNotMatch(prompt, /say it awaits on-site confirmation/);
});

test('XiaoZhi describes its own actions in both execution modes', () => {
  const capabilities = { provider: 'xiaozhi' as const, connected: true, chatActions: true, mappings: [] };
  assert.match(robotActionInstruction(actions, true, capabilities), /我这就举起双手/);
  assert.match(robotActionInstruction(actions, false, capabilities), /等你确认，我就举起双手/);
  assert.match(robotActionInstruction([], true, capabilities), /you cannot do that action here yet/);
});

test('XiaoZhi speaks its matched action in first person even when the model delegates it', () => {
  assert.equal(formatXiaozhiActionReply('好呀，这就让机器人跳支舞，试试看～', '跳舞', true), '好，我这就跳舞。');
  assert.equal(
    formatXiaozhiActionReply('欢迎回来！好，这就把双手放下来，让机器人试试～', '放下双手', false),
    '欢迎回来！等你确认，我就放下双手。',
  );
  assert.equal(formatXiaozhiActionReply('好，我这就举起右手～', '举起右手', true), '好，我这就举起右手～');
  assert.equal(formatXiaozhiActionReply('', '举起右手', true), '');
});

test('empty action mappings still explain discovered MCP tools and distinguish pet animations', () => {
  const prompt = robotActionInstruction([], true, {
    connected: true,
    chatActions: true,
    mappings: [],
    catalog: {
      tools: ['getTeachProgramList', 'startTeachProgram'],
      programs: [{ id: '9223372036854775807', name: '挥手' }],
      areas: [],
    },
  });
  assert.match(prompt, /getTeachProgramList/);
  assert.match(prompt, /挥手/);
  assert.match(prompt, /9223372036854775807/);
  assert.match(prompt, /Only entries in the action catalog/);
  assert.match(prompt, /Never substitute a desktop pet animation/);
  assert.doesNotMatch(prompt, /Append \[robot_action/);
});

test('unavailable discovery explains the failure instead of inventing live tools', () => {
  const prompt = robotActionInstruction([], false, {
    connected: false,
    chatActions: false,
    mappings: [],
    error: 'robot_connection_failed',
  });
  assert.match(prompt, /robot_connection_failed/);
  assert.match(prompt, /do not invent a tool list/);
  assert.match(prompt, /enable chat actions/);
});
