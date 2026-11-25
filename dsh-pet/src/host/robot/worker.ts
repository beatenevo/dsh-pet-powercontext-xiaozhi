/** MCP 传输边界；物理动作只接受已配置并经过发现验证的目标。 */
import type { RobotAction, RobotCatalog, RobotConfig, RobotResult } from '../../shared/robot.ts';
import { runRobotWorker as runAstra } from './mcp.ts';
import { runXiaozhi } from './xiaozhi.ts';
import type { XiaozhiTokenStore } from './xiaozhi-connection.ts';

/** 宿主允许的高层操作。 */
export interface RobotCall {
  operation: 'status' | 'execute' | 'speak' | 'stop';
  tool?: RobotAction['tool'];
  target?: string;
  arguments?: RobotAction['arguments'];
  requestId?: string;
  text?: string;
  /** Host-validated fresh catalog for this dispatch, scoped to the current configuration. */
  catalog?: RobotCatalog;
}

/** 可注入的机器人传输。 */
export type RobotRunner = (config: RobotConfig, call: RobotCall, signal?: AbortSignal) => Promise<RobotResult>;

/** Dispatch the existing robot service operations to the selected adapter. */
export function runRobotWorker(
  config: RobotConfig,
  call: RobotCall,
  signal?: AbortSignal,
  readToken?: XiaozhiTokenStore['read'],
): Promise<RobotResult> {
  return config.xiaozhi ? runXiaozhi(config, call, signal, readToken) : runAstra(config, call, signal);
}
