/** Optional, content-free AI Vision connection and runtime status. */
export interface ObservabilityConfig {
  enabled: boolean;
  baseUrl: string;
  agentId: string;
  spaceId: string;
  allowInsecureHttp: boolean;
}

/** Credentials are write-only and never included in status responses. */
export interface ObservabilityUpdate extends ObservabilityConfig {
  spaceKey?: string;
  clearKey?: boolean;
}

export interface TraceReference {
  traceparent: string;
  conversationId?: string;
}

export type PetOperation =
  | 'comparison.prepare'
  | 'comparison.answer'
  | 'chat'
  | 'whisper'
  | 'sleep_talk'
  | 'model'
  | 'memory.recall'
  | 'memory.capture'
  | 'voice.speak'
  | 'voice.hear'
  | 'robot.execute'
  | 'robot.speak'
  | 'robot.stop'
  | 'connection.check';

export interface ObservedInteraction {
  traceId: string;
  operation: PetOperation;
  startedAt: number;
  durationMs?: number;
  outcome: 'running' | 'success' | 'error' | 'cancelled';
  delivery: 'pending' | 'accepted' | 'failed';
  url: string;
}

export interface ObservabilityStatus {
  config: ObservabilityConfig;
  hasKey: boolean;
  error?: 'configuration_invalid' | 'export_failed';
  lastExportAt?: number;
  interactions: ObservedInteraction[];
  memoryUrl?: string;
}

export const DEFAULT_OBSERVABILITY: ObservabilityConfig = {
  enabled: false,
  baseUrl: '',
  agentId: '',
  spaceId: '',
  allowInsecureHttp: false,
};
