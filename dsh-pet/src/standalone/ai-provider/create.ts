/**
 * Assembly root of the independent AI service: initializes settings storage, maintains ready and paused states,
 * connects channel generation and connection testing to the facade.
 *
 * The request is not parsed (returned to ./request), the quota is not defined (returned to ./limits), and the channel
 * details are not written (returned to ./stream and ./test-connection). Must always be true: overall failure when
 * setting read-insecure does not enable old credentials in the environment.
 * @module dsh-pet/src/standalone/ai-provider/create
 */
import { type StandaloneLogger } from '../context.ts';
import { createAiConfig, type StandaloneAiSettings, type StandaloneAiPublicSettings } from '../ai-config.ts';
import { BUILTIN_SERVICES, CUSTOM_SERVICE, builtinService, sameEndpoint } from '../services.ts';
import type {
  AiRuntime,
  AiStore,
  ModelDiscoveryInput,
  StandaloneAiDependencies,
  StandaloneAiService,
} from './types.ts';
import { PROVIDER } from './limits.ts';
import { discoverModels } from './list-models.ts';
import { queryStandaloneBalance } from './balance.ts';
import { createTextStream } from './stream.ts';
import { testAiConnection } from './test-connection.ts';

/**
 * 设置页需要的服务商目录：与后端名录同源，前端不再抄一份地址。
 * 自定义排第一且没有地址——它的 profile 永远是用户自己填的那份。
 */
const SERVICE_CATALOG = [
  { id: CUSTOM_SERVICE, label: '自定义', keyName: 'CUSTOM_API_KEY' as const, protocol: 'openai-compatible' as const },
  ...BUILTIN_SERVICES,
];

/**
 * 把服务商目录附在设置视图上。
 * @param settings - 脱敏设置。
 * @returns 设置 + 目录；目录是静态数据，不含任何密钥。
 */
function withCatalog<T extends StandaloneAiPublicSettings>(settings: T): T & { services: typeof SERVICE_CATALOG } {
  return { ...settings, services: SERVICE_CATALOG };
}

/**
 * Save settings: When flying solo, abort the request in transit first. If it fails, it will be paused and will be
 * restored after the next save is successful.
 * @throws When the service has been released, another save is in progress, or storage layer verification/persist to
 * disk fails.
 */
async function saveSettings(runtime: AiRuntime, store: AiStore, input: unknown): Promise<StandaloneAiPublicSettings> {
  if (runtime.disposed) throw new Error('Standalone AI is disposed.');
  if (runtime.saving) throw new Error('Standalone AI settings are being saved.');
  runtime.saving = true;
  // Abort requests in transit during saving to prevent old settings from continuing to generate output.
  runtime.active?.abort();
  try {
    const result = await store.save(input);
    if (!runtime.disposed) runtime.paused = false;
    return result;
  } catch (error) {
    runtime.paused = true;
    throw error;
  } finally {
    runtime.saving = false;
  }
}

/**
 * 内置服务的模型清单地址与对话地址不同级（opencode 就是），只有草稿地址命中该家时才用它。
 * @param settings - 当前成品配置。
 * @param input - 本次请求里用户填的地址。
 * @returns 显式清单地址；自定义或地址不符时返回 undefined，交回按 baseUrl 推导。
 */
function discoveryUrl(settings: Readonly<StandaloneAiSettings>, input: ModelDiscoveryInput): string | undefined {
  const def = builtinService(settings.service);
  if (!def?.modelsUrl) return undefined;
  const base = (input.baseUrl !== undefined ? input.baseUrl : settings.baseUrl).trim();
  return sameEndpoint(base, def.baseUrl) ? def.modelsUrl : undefined;
}

/**
 * Creating standalone mode AI service.
 * @param home - DSH_HOME.
 * @param logger - log export.
 * @param dependencies - Test injected transmissions and clocks.
 * @returns AI Service.
 * @throws Thrown when the settings cannot be read safely.
 */
export function createStandaloneAi(
  home: string,
  logger: StandaloneLogger,
  dependencies: StandaloneAiDependencies = {},
): StandaloneAiService {
  let store: AiStore;
  try {
    store = createAiConfig(home);
  } catch {
    logger.error('Cannot securely load standalone AI settings.');
    // When the persistence is damaged or the permissions are insecure, the old credentials in the environment cannot be enabled. It would rather fail overall.
    throw new Error('Cannot securely load standalone AI settings.');
  }
  const runtime: AiRuntime = {
    store,
    logger,
    fetcher: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    disposed: false,
    paused: false,
    saving: false,
    active: undefined,
    ready(): boolean {
      return (
        !runtime.disposed &&
        !runtime.paused &&
        !runtime.saving &&
        !!store.current().model &&
        !!store.current().baseUrl &&
        !!store.current().apiKey
      );
    },
  };
  const modelOf = (): string => store.current().model;

  return {
    currentSelection: () => ({ provider: PROVIDER, model: runtime.ready() ? modelOf() : '' }),
    listProviders: () => (runtime.ready() ? [{ id: PROVIDER, name: 'Standalone AI' }] : []),
    listModels: async (provider) =>
      runtime.ready() && provider === PROVIDER ? [{ id: modelOf(), name: modelOf() }] : [],
    resolveModelInfo: async (provider = PROVIDER, model = modelOf(), signal) =>
      runtime.ready() && !signal?.aborted && provider === PROVIDER && model === modelOf()
        ? { id: model, name: model }
        : undefined,
    stream: createTextStream(runtime),
    getSettings: () => withCatalog(store.publicSettings()),
    connectionForSetup: () => {
      const { service, protocol, baseUrl, model, apiKey } = store.current();
      return { service, protocol, baseUrl, model, apiKey };
    },
    saveSettings: async (input) => withCatalog(await saveSettings(runtime, store, input)),
    isReady: () => runtime.ready(),
    balanceAuth: () => ({ provider: store.current().service, apiKey: store.current().apiKey }),
    deepseekKey: () => store.current().deepseekApiKey,
    testConnection: (input, signal) =>
      runtime.disposed
        ? Promise.resolve({ ok: false, message: '服务已关闭' })
        : testAiConnection(runtime.fetcher, store.current(), input, signal),
    discoverModels: (input) =>
      runtime.disposed
        ? Promise.resolve({ ok: false, code: 'input', message: '服务已关闭' })
        : discoverModels(runtime.fetcher, store.current(), {
            ...input,
            modelsUrl: discoveryUrl(store.current(), input),
          }),
    queryBalance: async () =>
      runtime.disposed
        ? { ok: false, provider: '', reason: 'unsupported' }
        : queryStandaloneBalance(store.current().service, store.current().apiKey),
    dispose() {
      runtime.disposed = true;
      runtime.active?.abort();
    },
  };
}
