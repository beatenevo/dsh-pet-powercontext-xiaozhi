/**
 * Plugin entry point: Cordis plugin, assembles the configuration, route, slash command, polling and desktop Helper
 * of host side to ctx. The assembly sequence cannot be changed: `getHandlePetRoute` is used lazily (`httpRoute` is
 * created later in this function), `startHelper` must be called last.
 * @module dsh-pet/src/host/index
 */
import { createHostSetup } from './plugin/setup.ts';
import { createComparisonService } from './comparison/service.ts';
import { PetObservability } from './observability/service.ts';
import { registerRobot } from './plugin/robot.ts';
import { registerManagedMemory } from './plugin/managed-memory.ts';
import { readAllConfig } from './config.ts';
import { currentEnvironment, setCityProvider } from './environment.ts';
import { createHttpRoute, registerHttpRoute } from './plugin/http-route.ts';
import { registerLifecycle } from './plugin/lifecycle.ts';
import { registerChatCommand } from './plugin/command-chat.ts';
import { registerPetCommand } from './plugin/command-pet.ts';
import { registerLoops } from './plugin/loops.ts';
import { registerBalanceCommand } from './plugin/command-balance.ts';
import { registerSessionWatch } from './plugin/session-watch.ts';
import { createDesktopHelper } from './plugin/desktop-helper.ts';
import { createBalancePoll } from './plugin/balance-poll.ts';
import { createChatMemory } from './plugin/chat-memory.ts';
import { createSessionNotify } from './plugin/session-notify.ts';
import { createPetLookup } from './plugin/pet-lookup.ts';
import { createDownloadReport } from './plugin/download-report.ts';
import { createWorkStatusBridge } from './plugin/work-status-bridge.ts';
import { registerTodoReminders } from './plugin/todo-reminders.ts';
import { DEEPSEEK_OFFICIAL_PROVIDER_ID } from './balance/providers/deepseek-official.ts';
import { ensureDeepseekAsrProvider } from './voice/builtin-deepseek-asr.ts';
import { ensureDeepseekTtsProvider } from './voice/builtin-deepseek-tts.ts';
import { ensureDshSpeechProvider } from './voice/builtin-dsh.ts';
import { ensureEdgeProvider } from './voice/builtin-edge.ts';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createVoiceService } from './voice/speak.ts';
import { createHearService } from './voice/hear.ts';
import { TODO_FILE_NAME, TodoStore } from './todo/store.ts';
import { join } from 'node:path';
import type { PetRouteDeps } from './routes/types.ts';

/** Plugin row id (consistent with cordis.patch.yml) */
export const name = 'pet';
/** Services that need to be injected: webServer (route) + agentDefaultModel (current service provider) + credentials (credential) + llm (dialog model call) + commands (/ balance slash command) + connection (desktop Helper "Open AI Authenticated site URL used in Settings) */
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection'];

/** host plugin body: register `/dsh-pet-7340` prefix route with slash command (/ balance / pet / chat); ctx temporarily uses any (peer type package cannot be parsed locally). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected webServer/locale services have no static types.
export function apply(ctx: any): void {
  const setup = createHostSetup(ctx);
  const {
    userRoot,
    log,
    configPaths,
    thumbUserRoot,
    memeDirsFor,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    playback,
    workStatus,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  } = setup;
  const workStatusBridge = createWorkStatusBridge({ state, workStatus, EXTERNAL_WORK_SESSION });
  const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
  const downloadReport = createDownloadReport({
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
    publishWorkStatus,
    workStatus,
  });
  const { reportDownload, stopDownloadSlotTimer } = downloadReport;
  const petLookup = createPetLookup({ state, configPaths });
  const { lock, sleep, sleepRefusalText } = petLookup;
  const sessionNotify = createSessionNotify({ ctx, publishWorkStatus, state, workStatus });
  const {
    pushNotifyFrame,
    turnFlags,
    terminalTimers,
    lastTodoText,
    lastReplyText,
    toolsInFlight,
    cancelTerminalCleanup,
    scheduleTerminalCleanup,
    notifyActivityTimers,
    scheduleCompletionNotify,
  } = sessionNotify;
  // 天气城市覆盖：配置里写了就按它查，不再由 IP 归属地库决定。
  // 只注入这一次——/environment 路由与 system 时间行调的是同一个 currentEnvironment，
  // 各自再去读配置就会出现「气泡说扬州、碎碎念说南京」。
  setCityProvider(() => {
    const city = readAllConfig(configPaths).main?.environmentCity;
    return typeof city === 'string' && city.trim() !== '' ? city.trim() : undefined;
  });
  const observability = new PetObservability(userRoot);
  ctx.effect(() => () => observability.shutdown());
  const comparison = createComparisonService(ctx, configPaths, observability);
  ctx.effect(() => () => comparison.shutdown());
  const robot = registerRobot(ctx, userRoot, state, () => httpRoute.handlePetRoute, observability);
  const chatMemory = createChatMemory({
    ctx,
    configPaths,
    log,
    memeDirsFor,
    playback,
    state,
    userRoot,
    observability,
    robot,
  });
  const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;

  const balancePoll = createBalancePoll({ ctx, configPaths, getActivePetId, log, state, standaloneAiBalance });
  const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } =
    balancePoll;

  // To-do list: a user-level data (regardless of pets), persist to disk in the plugin data root; reminder loop and / todos route share the same instance.
  const todos = new TodoStore({ file: join(userRoot, TODO_FILE_NAME), log });

  const desktopHelper = createDesktopHelper({
    ctx,
    configPaths,
    effectivePetList,
    log,
    reportDownload,
    thumbUserRoot,
    // Lazy access: handlePetRoute is assembled below, Helper is only actually called when starting/receiving requests
    getHandlePetRoute: () => httpRoute.handlePetRoute,
  });
  const { startHelper, stopHelper, markDisposed } = desktopHelper;

  // 内置语音实现与第三方走同一条注册路径：先登记，两个服务才解析得到各自的实现。
  // 识别那侧惰性依赖宿主服务，没装语音输入插件也能登记——调用时才回 unsupported。
  ensureEdgeProvider();
  ensureDshSpeechProvider({ speechToText: () => setup.optionalService('speechToText') });
  // DeepSeek 官方语音：鉴权复用 DSH 的 DEEPSEEK_API_KEY，与余额那条路一致；
  // 独立模式依次借「语音专用 key」和「余额选 DeepSeek 时的那把」，最后才回落 DSH 凭据
  const resolveDeepseekKey = async (): Promise<string | undefined> => {
    const dedicated = setup.standaloneDeepseekKey();
    if (dedicated) return dedicated;
    const standalone = setup.standaloneAiBalance();
    if (standalone?.provider === DEEPSEEK_OFFICIAL_PROVIDER_ID && standalone.apiKey) return standalone.apiKey;
    const resolved = await ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'));
    return resolved?.value;
  };
  ensureDeepseekTtsProvider({ resolveKey: resolveDeepseekKey });
  ensureDeepseekAsrProvider({ resolveKey: resolveDeepseekKey });

  const deps: PetRouteDeps = {
    comparison,
    observability,
    robot,
    memorySetup: registerManagedMemory(ctx, setup, () => httpRoute.memoryConfig),
    ...setup,
    ...petLookup,
    ...workStatusBridge,
    ...chatMemory,
    ...balancePoll,
    ...desktopHelper,
    ...sessionNotify,
    ctx,
    todos,
    // 环境查询：/environment 与 system 时间行共用同一个取数口。
    // 传了 city 就照传（空串 = 忽略配置、按 IP 定位，设置页「检测」走这条）；
    // 没传则交回 currentEnvironment 里注入的读取口。
    environment: (opts?: { fresh?: boolean; city?: string }) =>
      currentEnvironment({
        force: opts?.fresh === true,
        ...(opts?.city === undefined ? {} : { city: opts.city }),
      }),
    // 语音合成：缓存落 userRoot，失败只留日志，不打断宿主。
    // 请求没带音色时用配置里的那个值——代码里没有第二份默认音色。
    voice: createVoiceService({
      userRoot,
      log,
      configuredVoice: () => {
        const name = readAllConfig(configPaths).main?.voiceName;
        return typeof name === 'string' && name ? name : undefined;
      },
    }),
    // 语音识别：实现来自注册表；请求没带 provider 时用配置里的那个值，没有第二份默认
    speech: createHearService({
      configuredProvider: () => {
        const provider = readAllConfig(configPaths).main?.speechProvider;
        return typeof provider === 'string' && provider ? provider : undefined;
      },
    }),
  };
  const httpRoute = createHttpRoute(deps);
  registerHttpRoute(ctx, httpRoute.handlePetRoute);
  deps.memorySetup?.resume();

  registerSessionWatch({
    ctx,
    cancelTerminalCleanup,
    lastTodoText,
    lastReplyText,
    notifyActivityTimers,
    publishWorkStatus,
    pushNotifyFrame,
    scheduleCompletionNotify,
    scheduleTerminalCleanup,
    terminalTimers,
    toolsInFlight,
    turnFlags,
    workStatus,
  });

  registerBalanceCommand({ ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText });

  registerLoops({
    ctx,
    balancePeriodSec,
    configPaths,
    lastWhisperAt,
    lock,
    log,
    publishWhisper,
    publishSleepTalk,
    refreshBalance,
    sleep,
    standaloneAiPolicy,
    whisperPeriodSec,
  });

  registerPetCommand({ ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId });

  registerChatCommand({ ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText });

  // To-do reminder: starts and stops with the plugin lifecycle; when the lock is held by a third party, the pet is
  // skipped by pickReminderSpeaker. The broadcast switch is read and used: after the configuration is changed, the
  // next reminder will take effect without restarting.
  registerTodoReminders({
    ctx,
    effectivePetList,
    isVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,
    lock,
    log,
    sleep,
    state,
    todos,
    waiterCount: () => state.waiterCount(),
  });

  registerLifecycle({
    ctx,
    lock,
    markDisposed,
    playback,
    state,
    stopDownloadSlotTimer,
    stopHelper,
    stopWorkStatusFlush,
  });

  // Pull up the desktop Helper after the route is ready (only an warning will be issued when Electron is missing, and will not affect DSH and the browser overlay)
  startHelper();
}
