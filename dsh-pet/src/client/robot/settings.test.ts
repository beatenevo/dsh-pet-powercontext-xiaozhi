/** MCP 目标保留字符串，避免长整数精度丢失。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRobotConfig, robotConfigSchema } from '../../host/robot/config.ts';
test('MCP configuration preserves long program IDs and rejects SDK addresses', () => {
  const config = robotConfigSchema.parse({
    ...defaultRobotConfig(),
    actions: [
      { key: 'test', name: 'Test', tool: 'startTeachProgram', target: '9223372036854775807', petAnimation: '' },
    ],
  });
  assert.equal(config.actions[0].target, '9223372036854775807');
  assert.equal(robotConfigSchema.safeParse({ ...config, address: 'localhost:50051' }).success, false);
});

test('older configuration stays in confirmation mode and direct execution is opt-in', () => {
  const { directExecution, ...legacy } = defaultRobotConfig();
  assert.equal(directExecution, false);
  assert.equal(robotConfigSchema.parse(legacy).directExecution, false);
  assert.equal(robotConfigSchema.parse({ ...legacy, directExecution: true }).directExecution, true);
});
