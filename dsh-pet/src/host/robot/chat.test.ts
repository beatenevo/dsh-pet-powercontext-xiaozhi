/** Model output can propose only configured keys and never leaks control tags into speech. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRobotAction, robotActionInstruction } from './chat.ts';

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
