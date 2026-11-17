/** Public contracts for the optional Astra Pro 2.0 controller. */

/** A manufacturer-verified action or ordered action group. */
export interface RobotAction {
  key: string;
  name: string;
  actionIds: number[];
  petAnimation: string;
}

/** Operator-owned settings; enabling monitoring never authorizes motion. */
export interface RobotConfig {
  enabled: boolean;
  /** Forward all new petId utterances with one opt-in: replies, whispers, sleep talk and robot feedback. */
  chatSpeech: boolean;
  /** Model-selected actions remain proposals until confirmed on site. */
  chatActions: boolean;
  address: string;
  python: string;
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

/** A bounded RPC result from the isolated Python adapter. */
export interface RobotResult {
  ok: boolean;
  code: string;
  message: string;
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

/** One reply's physical action proposal; never persisted or executed without confirmation. */
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
  telemetry?: RobotTelemetry;
  error: string;
  stopResult?: RobotResult;
  pendingAction?: RobotPendingAction;
  chatSpeech?: RobotChatSpeech;
  commands: RobotCommand[];
}
