/** 托管记忆服务启动时读取桌宠的私有观测配置，不向页面回传导出认证。 */
import { join } from 'node:path';
import { observabilityUpdateSchema } from '../host/observability/config.ts';
import { readPrivateJson } from './ai-storage.ts';

/** 配置变更在下次启动服务时生效；无效配置不阻止聊天和记忆启动。 */
export function memoryObservabilityEnvironment(directory: string): NodeJS.ProcessEnv {
  const disabled = { POWERCONTEXT_SERVER_TRACING_ENABLED: 'false' };
  try {
    const parsed = observabilityUpdateSchema.safeParse(readPrivateJson(join(directory, '..', 'observability.json')));
    if (!parsed.success || !parsed.data.enabled || !parsed.data.spaceKey) return disabled;
    const config = parsed.data;
    const authorization = Buffer.from(config.agentId + ':' + config.spaceKey).toString('base64');
    return {
      POWERCONTEXT_SERVER_TRACING_ENABLED: 'true',
      OTEL_SERVICE_NAME: 'dsh-pet-powercontext',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: config.baseUrl.replace(/\/+$/, '') + '/api/public/otel/v1/traces',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'Authorization=Basic%20' + authorization,
    };
  } catch {
    return disabled;
  }
}
