/** 运行 MCP 协议与机器人授权回归测试。 */
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    './scripts/test-register.mjs',
    '--test',
    'src/host/robot/*.test.ts',
    'src/client/robot/*.test.ts',
    'src/host/plugin/robot.test.ts',
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
