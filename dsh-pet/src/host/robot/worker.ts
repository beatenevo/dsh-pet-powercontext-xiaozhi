/** MCP 传输边界；物理动作只接受已配置并经过发现验证的目标。 */
import type { RobotAction, RobotCatalog, RobotConfig, RobotResult } from '../../shared/robot.ts';
export { runRobotWorker } from './mcp.ts';

/** 宿主允许的高层操作。 */
export interface RobotCall {
  operation: 'status' | 'execute' | 'speak' | 'stop';
  tool?: RobotAction['tool'];
  target?: string;
  requestId?: string;
  text?: string;
  /** Host-validated fresh catalog for this dispatch, scoped to the current configuration. */
  catalog?: RobotCatalog;
}

/** 可注入的机器人传输。 */
export type RobotRunner = (config: RobotConfig, call: RobotCall, signal?: AbortSignal) => Promise<RobotResult>;
