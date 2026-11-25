/** Validate operator configuration and persist it outside the installed package. */
import { z } from 'zod';
import type { RobotConfig } from '../../shared/robot.ts';
import { parseXiaozhiApiUrl } from './xiaozhi-connection.ts';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const address = z
  .string()
  .max(255)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  }, 'Expected a complete HTTP(S) MCP endpoint');

/** Configuration schema; action IDs always come from the operator's allowlist. */
export const robotConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    chatSpeech: z.boolean().default(false),
    chatActions: z.boolean().default(false),
    directExecution: z.boolean().default(false),
    address,
    xiaozhi: z
      .strictObject({
        deviceId: z
          .string()
          .trim()
          .regex(/^(?:[1-9]\d{0,19})?$/),
        apiUrl: z
          .string()
          .trim()
          .min(1)
          .max(2048)
          .refine((value) => {
            try {
              return Boolean(parseXiaozhiApiUrl(value));
            } catch {
              return false;
            }
          }, 'Expected the HTTP(S) XiaoZhi OpenAPI root')
          .optional(),
      })
      .optional(),
    version: z.literal(2),
    timeoutSeconds: z.number().int().min(3).max(3600),
    petId: z.string().min(1).max(128),
    actions: z
      .array(
        z.strictObject({
          key: identifier,
          name: z.string().trim().min(1).max(80),
          tool: z.enum(['startTeachProgram', 'RobotAgvMove', 'xiaozhiMcp']),
          target: z.string().trim().min(1).max(128),
          arguments: z.record(z.string(), z.json()).optional(),
          petAnimation: z.string().max(128),
        }),
      )
      .max(20),
  })
  .refine(
    (config) => !config.enabled || !!(config.xiaozhi ? config.xiaozhi.deviceId : config.address),
    'A robot address or XiaoZhi device ID is required',
  )
  .refine((config) => !config.xiaozhi || !config.address, 'XiaoZhi uses its own OpenAPI address')
  .refine(
    (config) => config.actions.every((action) => !!config.xiaozhi === (action.tool === 'xiaozhiMcp')),
    'Actions must match the configured robot type',
  )
  .refine(
    (config) => config.actions.every((action) => action.tool === 'xiaozhiMcp' || action.arguments === undefined),
    'Only XiaoZhi device tools accept configured arguments',
  )
  .refine(
    (config) => new Set(config.actions.map((action) => action.key)).size === config.actions.length,
    'Action keys must be unique',
  )
  .refine(
    (config) => Buffer.byteLength(JSON.stringify(config, null, 2) + '\n') <= 30_000,
    'Robot configuration exceeds the private storage limit',
  );

/** Start with monitoring and all motion disabled. */
export function defaultRobotConfig(): RobotConfig {
  return {
    enabled: false,
    chatSpeech: false,
    chatActions: false,
    directExecution: false,
    address: '',
    version: 2,
    timeoutSeconds: 60,
    petId: 'main',
    actions: [],
  };
}

/** Requests never accept joint coordinates, arbitrary RPC names or system commands. */
export const robotRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('configure'), config: robotConfigSchema }),
  z.strictObject({ action: z.literal('check') }),
  z.strictObject({ action: z.literal('arm'), session: z.string().uuid(), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal('disarm') }),
  z.strictObject({ action: z.literal('stop') }),
  z.strictObject({
    action: z.literal('confirm-chat-action'),
    session: z.string().uuid(),
    id: z.string().uuid(),
    confirmed: z.literal(true),
  }),
  z.strictObject({ action: z.literal('dismiss-chat-action'), session: z.string().uuid(), id: z.string().uuid() }),
  z.strictObject({
    action: z.literal('execute'),
    session: z.string().uuid(),
    id: z.string().uuid(),
    key: identifier,
    petId: z.string().min(1).max(128),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('speak'),
    session: z.string().uuid(),
    id: z.string().uuid(),
    text: z.string().trim().min(1).max(500),
    petId: z.string().min(1).max(128),
    confirmed: z.literal(true),
  }),
]);

/** Validated operation accepted by the controller. */
export type RobotRequest = z.infer<typeof robotRequestSchema>;

/** Write-only device token for the saved robot session. */
export const xiaozhiTokenRequestSchema = z.strictObject({
  session: z.string().uuid(),
  token: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/),
});
