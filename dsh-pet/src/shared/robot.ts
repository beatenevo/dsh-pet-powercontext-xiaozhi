/** Public contracts for the optional robot controller. */

/** A manufacturer-verified action or ordered action group. */
export interface RobotAction {
  key: string;
  name: string;
  tool: 'startTeachProgram' | 'RobotAgvMove' | 'xiaozhiMcp';
  /** Discovered program ID, station, or XiaoZhi device tool name. */
  target: string;
  /** Operator-specified constant arguments for XiaoZhi device tools. */
  arguments?: Record<string, unknown>;
  petAnimation: string;
}

/** Operator-owned settings; direct execution requires an explicit opt-in. */
export interface RobotConfig {
  enabled: boolean;
  /** Forward all new petId utterances with one opt-in: replies, whispers and sleep talk; command receipts are excluded. */
  chatSpeech: boolean;
  /** Allow chat to select configured physical actions. */
  chatActions: boolean;
  /** Execute chat-selected actions without per-action clicks; defaults to false. */
  directExecution: boolean;
  address: string;
  /** Selects the host-configured XiaoZhi OpenAPI and an exact device ID. */
  xiaozhi?: { deviceId: string };
  /** MCP 配置版本；旧 SDK 配置迁移时禁用。 */
  version: 2;
  /** Maximum RPC duration in seconds; expired movement requests remain uncertain. */
  timeoutSeconds: number;
  petId: string;
  actions: RobotAction[];
}

/** Read-only values reported by the robot, without inferred physical completion. */
export interface RobotTelemetry {
  actionCode: number;
  description: string;
  modes: number[];
}

/** MCP 返回的可选动作目录。 */
export interface RobotCatalog {
  /** Tool names returned by runtime MCP discovery, not an assumed capability list. */
  tools?: string[];
  programs: { id: string; name: string }[];
  areas: { areaName: string; parameter: string }[];
  /** Device tools with a discovered input schema that can be mapped to actions. */
  xiaozhiTools?: { name: string; arguments: string[]; required: string[] }[];
}

/** MCP 操作结果；成功仅代表服务端报告。 */
export interface RobotResult {
  ok: boolean;
  code: string;
  message: string;
  catalog?: RobotCatalog;
  telemetry?: RobotTelemetry;
  stops?: Record<string, { ok: boolean; message: string }>;
}

/** Durable command receipt; reported-success is a controller response, not a physical observation. */
export interface RobotCommand {
  id: string;
  kind: 'execute' | 'speak';
  key: string;
  petId: string;
  state: 'running' | 'reported-success' | 'failed' | 'unknown';
  startedAt: number;
  finishedAt?: number;
  message: string;
}

/** One reply's transient action, awaiting confirmation or opted-in direct dispatch. */
export interface RobotPendingAction {
  id: string;
  petId: string;
  key: string;
  name: string;
  expiresAt: number;
}

/** Delivery status for pet speech, separate from text generation success; chatSpeech is the retained wire name. */
export interface RobotChatSpeech {
  id: string;
  petId: string;
  state: RobotCommand['state'] | 'queued' | 'checking' | 'skipped';
  reason?: 'busy' | 'offline' | 'too_long' | 'empty' | 'cancelled' | 'queue_full' | 'expired';
}

/** Snapshot shared by DSH settings and the standalone chat panel. */
export interface RobotSnapshot {
  /** Changes on host restart and configuration replacement; stale control pages cannot send motion. */
  session: string;
  config: RobotConfig;
  armed: boolean;
  busy: boolean;
  checking: boolean;
  stopping: boolean;
  connected: boolean;
  checkedAt: number;
  catalog?: RobotCatalog;
  telemetry?: RobotTelemetry;
  error: string;
  stopResult?: RobotResult;
  pendingAction?: RobotPendingAction;
  chatSpeech?: RobotChatSpeech;
  commands: RobotCommand[];
}
