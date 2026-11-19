/** Validate destinations before attaching credentials; store them outside public pet configuration. */
import { z } from 'zod';
import { DEFAULT_OBSERVABILITY, type ObservabilityConfig } from '../../shared/observability.ts';

export const observabilityUpdateSchema = z
  .strictObject({
    enabled: z.boolean(),
    captureContent: z.boolean().optional(),
    includeBackground: z.boolean().default(false),
    baseUrl: z.string().trim().max(2048),
    agentId: z.union([z.literal(''), z.string().uuid()]),
    spaceId: z.union([z.literal(''), z.string().uuid()]),
    allowInsecureHttp: z.boolean(),
    spaceKey: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
    clearKey: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.baseUrl) {
      try {
        const url = new URL(value.baseUrl);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || value.allowInsecureHttp)))
        )
          throw new Error('invalid');
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid AI Vision URL', path: ['baseUrl'] });
      }
    }
    if (value.enabled && (!value.baseUrl || !value.agentId || !value.spaceId))
      ctx.addIssue({ code: 'custom', message: 'AI Vision URL, Agent UUID and Space UUID are required' });
  });

/** Only these public fields can cross the host-to-browser boundary. */
export function publicConfig(value: ObservabilityConfig = DEFAULT_OBSERVABILITY): ObservabilityConfig {
  return {
    enabled: value.enabled,
    captureContent: value.captureContent === true,
    includeBackground: value.includeBackground === true,
    baseUrl: value.baseUrl.replace(/\/+$/, ''),
    agentId: value.agentId,
    spaceId: value.spaceId,
    allowInsecureHttp: value.allowInsecureHttp,
  };
}

/** Normal authenticated UI links; credentials never enter a URL or shared link. */
export function observationUrl(config: ObservabilityConfig, traceId?: string, startedAt?: number): string {
  const url = new URL(config.baseUrl.replace(/\/+$/, '') + (traceId ? '/trace' : '/labs/memory'));
  url.searchParams.set('spaceId', config.spaceId);
  url.searchParams.set('agent_uuid', config.agentId);
  if (traceId) {
    url.searchParams.set('traceId', traceId);
    if (startedAt !== undefined) {
      url.searchParams.set('trace_from', new Date(startedAt - 60_000).toISOString());
      url.searchParams.set('trace_to', new Date(startedAt + 300_000).toISOString());
    }
  }
  return url.toString();
}
