/**
 * ctx.llm stand-in: transposed when there is an independent AI service, and explicitly unavailable when not.
 *
 * The shape must be consistent with the llm service of DSH (the route and settings pages only recognize these
 * methods); the generation logic is not implemented (returned to ./ai-provider). This must always be true: when not
 * connected to the model, every call throws an error or gives an empty list, and never pretends to be successful.
 * @module dsh-pet/src/standalone/llm-facade
 */

/** The contract for ctx.llm's substitute must have the same shape as DSH. */
export interface StandaloneModelService {
  currentSelection(): { provider: string; model: string };
  listProviders(): unknown[];
  listModels(provider: string): Promise<unknown[]>;
  resolveModelInfo(provider?: string, model?: string, signal?: AbortSignal): Promise<unknown>;
  stream(options: unknown): AsyncIterable<unknown>;
  isReady(): boolean;
  /**
   * Service provider and key used for balance inquiry.
   *
   * The balance in standalone mode does not go through DSH's credential store and account services, and the
   * self-filled key can only be handed over here. Open a separate method instead of stuffing it into currentSelection:
   * the balance service provider and the model service provider for chatting are two different things. If they are
   * mixed together, the model parser will not be able to recognize its own provider.
   */
  balanceAuth(): { provider: string; apiKey: string };
  /**
   * 单独保存的 DeepSeek 语音密钥；空串表示没单独配。
   *
   * 对话密钥属于用户选的任意服务商，只有它恰好是 DeepSeek 时才能给语音用；
   * 这个字段让「对话走别家、语音仍用 DeepSeek」成立。
   */
  deepseekKey(): string;
  dispose(): void;
}

/** llm plane actually used by host route. */
export interface LlmFacade {
  listProviders(): unknown[];
  listModels(provider: string): Promise<unknown[]>;
  resolveModelInfo(provider?: string, model?: string, signal?: AbortSignal): Promise<unknown>;
  stream(request: unknown): AsyncIterable<unknown>;
}

/** There is AI service: direct transposition without any conversion. */
export function createLlmFacade(ai: StandaloneModelService): LlmFacade {
  return {
    listProviders: () => ai.listProviders(),
    listModels: (provider) => ai.listModels(provider),
    resolveModelInfo: (provider, model, signal) => ai.resolveModelInfo(provider, model, signal),
    stream: (request) => ai.stream(request),
  };
}

/** No AI service: The model capability is explicitly unavailable, allowing the caller to get a readable reason instead of an empty result. */
export function createOfflineLlm(): LlmFacade {
  return {
    listProviders: () => [],
    listModels: async () => [],
    // The contract is asynchronous, and the substitute must also return Promise: when returning undefined synchronously, any . then() will explode immediately.
    resolveModelInfo: async () => undefined,
    // Contract requirement AsyncIterable: The function written as async will cause for await to immediately throw
    // TypeError, and the rejected Promise will not be taken over, and the process may be terminated directly. No need
    // to async function *: If you throw yield incorrectly, it will be blocked by require-yield.
    stream: () => ({
      [Symbol.asyncIterator](): AsyncIterator<never> {
        return {
          next: async (): Promise<IteratorResult<never>> => {
            throw new Error('dsh-pet standalone: no model configured; whispers and chat are unavailable');
          },
        };
      },
    }),
  };
}
