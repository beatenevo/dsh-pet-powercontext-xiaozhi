/** 独立验证当前模型草稿；仅发起模型请求，不保存配置或安装记忆服务。 */
import { z } from 'zod';
import { localModelKey, sameModelEndpoint } from '../shared/memory-presets.ts';
import { memoryModelsSchema, type ManagedMemory } from './managed-memory.ts';
import type { StandaloneAiService } from './ai-provider/types.ts';
import { checkEmbedding, checkGeneration, setupErrorCode } from './setup-models.ts';

const common = memoryModelsSchema
  .pick({ baseUrl: true, model: true, apiKey: true })
  .extend({ action: z.literal('check'), apiKey: memoryModelsSchema.shape.apiKey.or(z.literal('')).default('') });
const schema = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('generation') }).strict(),
  common
    .extend({
      kind: z.literal('embedding'),
      dimension: memoryModelsSchema.shape.embeddingDimension,
      sendDimensions: z.boolean(),
    })
    .strict(),
]);

/** 只返回验证结果或脱敏错误码。 */
export type SetupCheckResult = { ok: true } | { ok: false; errorCode: string };

/** 按完整接口地址复用密钥，独立检查生成接口或向量接口及维度。 */
export async function checkSetupModel(
  input: unknown,
  signal: AbortSignal,
  memory?: ManagedMemory,
  ai?: StandaloneAiService,
): Promise<SetupCheckResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, errorCode: 'invalid_setup' };
  try {
    const draft = parsed.data;
    const chat = ai?.connectionForSetup();
    const chatKey =
      chat?.protocol === 'openai-compatible' && sameModelEndpoint(chat.baseUrl, draft.baseUrl) ? chat.apiKey : '';
    const apiKey =
      draft.apiKey ||
      (draft.kind === 'embedding' ? memory?.embeddingKeyForEndpoint(draft.baseUrl) : '') ||
      memory?.generationKeyForEndpoint(draft.baseUrl) ||
      chatKey ||
      localModelKey(draft.baseUrl);
    if (!apiKey) throw new Error(draft.kind === 'embedding' ? 'embedding_key_required' : 'chat_key_required');
    if (draft.kind === 'generation') {
      await checkGeneration({ baseUrl: draft.baseUrl, model: draft.model, apiKey }, signal);
    } else {
      await checkEmbedding(
        {
          embeddingBaseUrl: draft.baseUrl,
          embeddingModel: draft.model,
          embeddingApiKey: apiKey,
          embeddingDimension: draft.dimension,
          embeddingSendDimensions: draft.sendDimensions,
        },
        signal,
      );
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, errorCode: setupErrorCode(error) };
  }
}
