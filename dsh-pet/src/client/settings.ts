/**
 * "Desktop pet configuration" settings page (`settings.section` slot, id is pet-config): Edit the pet list and global
 * default value of the main entry. This file is the assembly root: it holds the form state, strings together loading
 * and writing, and puts the cards into one page; cards, dictionaries, styles and HTTP are all in `settings/` . The
 * editable main entry in the read-only resolved configuration does not automatically spell the entry-level
 * fields; the file pet will never write back. The user layer is fully written for both saving and synchronization, and
 * then the resolved value returned by the host is handed over to the container for re-rendering - both methods do
 * not require refreshing the page.
 * @module dsh-pet/src/client/settings
 */
import { activeDshSession } from './chat/dsh-session.ts';
import { ROUTE_PATH } from '../shared/constants.ts';
import { avatarUrl } from '../shared/avatar.ts';
import { DEFAULT_FONT } from '../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../shared/physics.ts';
import type { FontConfig, ModelSelection, PhysicsParams, Weights } from '../shared/types.ts';
import type { FunctionComponent } from 'react';
import { DEFAULT_CHAT_MEMORY, type ChatMemoryConfig } from '../shared/chat-memory-config.ts';
import { requestNotificationPermission } from './notify.ts';
import { injectSettingsCss } from './settings/css.ts';
import { type Feedback, makeActions } from './settings/actions.ts';
import { petBridge } from './settings/bridge.ts';
import { type MergedConfig, readConfigEntries, readMainConfig } from './settings/config/index.ts';
import { type DialogState, makeDialog } from './settings/dialog.ts';
import { makeEnvironmentCard } from './settings/environment-card.ts';
import { makeFontCard } from './settings/font-card.ts';
import { makeGlobalCard, type GlobalFlagKey, type GlobalFlags } from './settings/global-card.ts';
import { makeLoadStatus } from './settings/load-status.ts';
import { makeModelCard, type ChatFlagKey, type ChatFlagValues, type ModelFieldKey } from './settings/model-card.ts';
import { makeMemorySetup } from './settings/memory-setup.ts';
import { makeObservabilityCard } from './settings/observability-card.ts';
import type { MemorySetupStatus } from '../shared/memory-setup.ts';
import { makeMobileCard } from './settings/mobile-card.ts';
import { makeMotionCard } from './settings/motion-card.ts';
import { makeModelPicker } from './settings/picker/index.ts';
import { makeVoicePicker } from './settings/picker/voice-picker.ts';
import { runNotificationTest } from './settings/notify-test.ts';
import { makeKindTabs } from './settings/kind-tabs.ts';
import { makePathsCards } from './settings/paths-cards.ts';
import { makePetCard } from './settings/pet-card.ts';
import { uploadPetAvatar } from './settings/avatar-upload.ts';
import { makePetTabs } from './settings/pet-tabs.ts';
import { createWriteFlow } from './settings/config/index.ts';
import { makePhysicsCard } from './settings/physics-card.ts';
import { makeShortcutsCard } from './settings/shortcuts-card.ts';
import { attachTipLayer } from './settings/tip-layer.ts';
import type { ShortcutHost } from './app-shortcut.ts';
import type { SettingsRuntime } from './settings/runtime.ts';
import { useConfigLoad } from './settings/config/index.ts';
import { usePetList } from './settings/use-pet-list.ts';
import { useRemoteData } from './settings/use-remote-data.ts';
import { makeUiKit } from './settings/ui.ts';
import { makeVoiceCard, type VoiceOption } from './settings/voice-card.ts';
import { DEFAULT_WEIGHTS } from '../shared/weights.ts';

// The true sources of the dictionary and bridge are all in settings/: the locale register of the host, the container and the test fixture are all fetched here, and are not referenced by their respective deep paths.
export { dicts, NS } from './settings/locales/index.ts';
export type { Key } from './settings/locales/index.ts';
export { petBridge };

/**
 * Create the "desktop pet configuration" setting page component. The browser side is in the form of a single file
 * `__ModuleLoader__` . The react capability can only be injected by the host at runtime. Therefore, a factory is used
 * to receive dependencies, create the component, and then register the configuration page slot.
 * @param rt - Runtime injected dependencies: `h` , hooks and translation function `t` .
 * @param ctx - Client context: only used to read the shortcut keys changed by the user.
 * @returns setup page component; `close` is provided by the setup page shell and is not used by this page.
 */
export function makePetConfigSection(
  rt: SettingsRuntime,
  ctx: ShortcutHost,
): FunctionComponent<{ close?: () => void }> {
  const { h, useState, useEffect, useRef, useCallback, t } = rt;

  // Style injection is idempotent, and repeated rendering will not cause repeated insertion.
  injectSettingsCss();

  const { q } = makeUiKit({ h, t });

  // Cards are separated into files in settings/, and only one instance is created here: the component type must be
  // stable across renderings, otherwise the selector's floating state (open/search word/highlight) will be lost every
  // time it is rendered.
  const ModelPicker = makeModelPicker({ h, useState, useEffect, useRef, t });
  const VoicePicker = makeVoicePicker({ h, useState, useEffect, useRef });
  const PetTabs = makePetTabs({ h, t });
  const KindTabs = makeKindTabs({ h, t });
  const PetCard = makePetCard(rt);
  const GlobalCard = makeGlobalCard(rt);
  const EnvironmentCard = makeEnvironmentCard(rt);
  const VoiceCard = makeVoiceCard(rt, VoicePicker);
  const FontCard = makeFontCard(rt);
  const ModelCard = makeModelCard(
    { ...rt, readSessionId: () => activeDshSession((name) => ctx.get?.(name)) },
    ModelPicker,
  );
  const MemorySetup = makeMemorySetup(rt);
  const ObservabilityCard = makeObservabilityCard(rt);
  const PhysicsCard = makePhysicsCard(rt);
  const MotionCard = makeMotionCard(rt);
  const ShortcutsCard = makeShortcutsCard(rt, ctx);
  const MobileCard = makeMobileCard(rt);
  const Actions = makeActions(rt);
  const { ConfigMetaCard, StorageCard } = makePathsCards(rt);
  const SettingsDialog = makeDialog(rt);
  const LoadStatus = makeLoadStatus({ h, t });

  return function PetConfigSection() {
    const [saving, setBusy] = useState(false);
    const [preparingMemory, setPreparingMemory] = useState(false);
    const [msg, setMsg] = useState<Feedback>({ kind: '', text: '' });
    // The feedback for permission application is displayed locally next to the button and is separated from the save feedback.
    const [permMsg, setPermMsg] = useState<Feedback>({ kind: '', text: '' });
    // Set the page root node: Ctrl + S only take over when it is visible (DSH, if you keep this component mounted on other settings pages, you cannot take away other people's shortcut keys)
    const rootRef = useRef<HTMLElement | null>(null);
    // Confirmation/prompt pop-up window: remove deletes pets, lastOne only has one left and cannot be deleted, sync sync overwrites, corrupt user configuration is damaged.
    const [dialog, setDialog] = useState<DialogState>(null);
    // The additions, deletions, changes and selected items in the pet list are all in settings/use-pet-list.ts: the list covers all entries (main + file pets).
    const {
      pets,
      mainPets,
      kinds,
      kind,
      visiblePets,
      selId,
      entryPrompt,
      select,
      selectKind,
      update,
      add,
      requestRemove,
      remove,
      replace,
      packWrites,
    } = usePetList(rt, setDialog);
    // One-time pulled host data: persist to disk location (two path cards) and candidate model list (drop-down box).
    const { paths, catalog, catalogFailed } = useRemoteData(rt);

    // Description bubble: hang body positioning (pseudo elements will be cut off by the edge of the window and the scroll container), and be removed together with the page unmount.
    useEffect(() => attachTipLayer(), []);

    // Tone list: a one-time pull that has nothing to do with the configuration. If it fails, just leave it blank (the pull-down will only display the current value).
    // 宿主按 provider 分组返回；这里拍平成一维并带上组名，由下拉渲染成 optgroup 式的分隔标题。
    useEffect(() => {
      let alive = true;
      void fetch(ROUTE_PATH + '/voice/voices')
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { providers?: { name?: string; voices?: VoiceOption[] }[] } | null) => {
          if (!alive || !body || !Array.isArray(body.providers)) return;
          setVoiceOptions(
            body.providers.flatMap((group) =>
              (Array.isArray(group.voices) ? group.voices : []).map((voice) => ({
                ...voice,
                ...(group.name === undefined ? {} : { providerName: group.name }),
              })),
            ),
          );
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []);

    // 识别实现列表：与音色列表同构的一次性拉取，失败留空即可。
    useEffect(() => {
      let alive = true;
      void fetch(ROUTE_PATH + '/voice/hear-providers')
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { providers?: { id: string; name: string }[] } | null) => {
          if (!alive || !body || !Array.isArray(body.providers)) return;
          setSpeechProviders(body.providers);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []);

    // System notification master switch: Identical to other global switches, the switch only changes the local status
    // and writes the entire package with "Save". No immediate writing: PUT /config will restart the desktop Helper,
    // and all desktop pet windows will be rebuilt (drag the drop point to clear, and the pet will jump back to the
    // corner). The engine reread is placed after the save is successful (persist is called reloadNotifications), and
    // it takes effect immediately after saving without refreshing.
    const [notifyEnabled, setNotifyEnabled] = useState(true);
    // 前台聚焦时也提醒：默认关（维持「不打扰」），与通知开关相邻，随「保存」整包写入。
    const [notifyWhenFocused, setNotifyWhenFocused] = useState(false);
    // Click the sound effect switch: Same as the notification switch, the entire package is written with "Save"; the initial value true is the built-in default, and the loading effect will be overwritten with the resolved value value.
    const [clickSound, setClickSound] = useState(true);
    // Emoji package image switch (global): The switch only changes the local status and is submitted with "Save".
    const [whisperImage, setWhisperImage] = useState(false);
    const [chatImage, setChatImage] = useState(false);
    // Dialogue action linkage switch (global): Same as above, submitted with "Save"; the initial value only takes place, and will be overwritten by the resolved value value after successful loading.
    const [chatAnimation, setChatAnimation] = useState(true);
    // Throw lock switch (global): The switch only changes the local state and is submitted with "Save".
    const [confineScreen, setConfineScreen] = useState(false);
    // System system tray switch (global): Submit together with "Save"; the host side will decide based on this whether to build a system tray and whether it is worth resident Helper when there is no desktop pet.
    const [trayEnabled, setTrayEnabled] = useState(true);
    // 语音播报开关与音色（全局默认）：随「保存」整包写入；音色初值留空，加载后由成品值覆盖。
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    // 不在前端写默认音色：空串表示「还没拿到成品值」，保存时这一项不提交，免得用本地猜的 id 覆盖配置
    const [voiceName, setVoiceName] = useState('');
    // Playback volume (global coefficient 0–1): The initial value 1 is the built-in default (maximum volume), which will be overwritten by the resolved value value after loading.
    const [voiceVolume, setVoiceVolume] = useState(1);
    // The other three types of voice switches (periodic whisper/to-do reminder/working status broadcast): are on the same level as voice broadcast, and the initial value false is the built-in default.
    const [voiceWhisperEnabled, setVoiceWhisperEnabled] = useState(false);
    const [voiceTodoEnabled, setVoiceTodoEnabled] = useState(false);
    const [voiceNotifyEnabled, setVoiceNotifyEnabled] = useState(false);
    // Optional voice: from host / voice/voices, if not available, leave it blank - the drop-down will only display the current value, never hard-code the voice id.
    const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
    // 语音识别实现：请求没带 provider 时用它；空串表示「还没拿到成品值」，保存时该项不提交。
    const [speechProvider, setSpeechProvider] = useState('');
    // 可选识别实现：来自宿主 /voice/hear-providers，拉不到就留空（下拉只显示当前值）。
    const [speechProviders, setSpeechProviders] = useState<{ id: string; name: string }[]>([]);
    // 天气城市覆盖（全局，只读 main）：空串是有效值 = 跟随 IP 自动定位，所以初值就是空串。
    const [environmentCity, setEnvironmentCity] = useState('');
    // Physical parameters (global): Only the local status is changed, and the entire package is written with "Save"; the initial value is only a placeholder, and editing and saving are allowed only after the resolved value is loaded successfully.
    const [physics, setPhysics] = useState<PhysicsParams>({ ...DEFAULT_PHYSICS });
    // Font (global default): The same set of semantics as physics; the initial value is only a placeholder, and editing and saving are allowed only after the resolved value is loaded successfully.
    const [font, setFont] = useState<FontConfig>({ ...DEFAULT_FONT });
    // Action frequency weight (main entry): The total of the three items is ≤ 100, and the random action is the margin; written with the "Save" package.
    const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
    // AI model (entry level): whisper / talk to the respective service provider and model, leave both blank = follow the current conversation; write the entire package with "Save".
    const [whisperModel, setWhisperModel] = useState<ModelSelection>({ provider: '', model: '' });
    const [chatModel, setChatModel] = useState<ModelSelection>({ provider: '', model: '' });
    // Number of dialogue history items (global default): The initial value 10 is the built-in default, and the loading effect will be overwritten with the resolved value main.chatMemoryRounds.
    const [chatMemory, setChatMemory] = useState(10);
    const [longTermMemory, setLongTermMemory] = useState<ChatMemoryConfig>({ ...DEFAULT_CHAT_MEMORY });
    // The upper limit of the number of dialogue pictures (global default): The initial value of 20 is the built-in default, which will be overwritten by the resolved value value after loading.
    const [chatImageLimit, setChatImageLimit] = useState(20);
    // The cached version number of the avatar preview: change it after the upload is successful, and the preview will be re-fetched (the same URL will be remembered by the browser).
    const [avatarVersion, setAvatarVersion] = useState(Date.now());
    // The avatar is being uploaded: the button is disabled and the copy is changed, which is separated from the "save" busy - the upload does not write the configuration.
    const [avatarBusy, setAvatarBusy] = useState(false);

    // The same set of controls must be updated when reading and restoring to default for the first time to avoid writing back expired values the next time you save.
    const applyConfig = useCallback(
      (merged: MergedConfig) => {
        // Take one copy each of the entry list and the global field: the former is for the label strip and the write-back plan when saving, and the latter is for the global card.
        const entries = readConfigEntries(merged);
        const patch = readMainConfig(merged);
        if (entries === null || patch === null) throw new Error('Invalid config response');
        replace(entries);
        if (patch.notificationsEnabled !== undefined) setNotifyEnabled(patch.notificationsEnabled);
        if (patch.notifyWhenFocused !== undefined) setNotifyWhenFocused(patch.notifyWhenFocused);
        if (patch.clickSoundEnabled !== undefined) setClickSound(patch.clickSoundEnabled);
        if (patch.whisperImageEnabled !== undefined) setWhisperImage(patch.whisperImageEnabled);
        if (patch.chatImageEnabled !== undefined) setChatImage(patch.chatImageEnabled);
        if (patch.chatAnimationEnabled !== undefined) setChatAnimation(patch.chatAnimationEnabled);
        if (patch.confineToScreen !== undefined) setConfineScreen(patch.confineToScreen);
        if (patch.trayEnabled !== undefined) setTrayEnabled(patch.trayEnabled);
        if (patch.voiceEnabled !== undefined) setVoiceEnabled(patch.voiceEnabled);
        if (patch.voiceName !== undefined) setVoiceName(patch.voiceName);
        if (patch.voiceVolume !== undefined) setVoiceVolume(patch.voiceVolume);
        if (patch.voiceWhisperEnabled !== undefined) setVoiceWhisperEnabled(patch.voiceWhisperEnabled);
        if (patch.voiceTodoEnabled !== undefined) setVoiceTodoEnabled(patch.voiceTodoEnabled);
        if (patch.voiceNotifyEnabled !== undefined) setVoiceNotifyEnabled(patch.voiceNotifyEnabled);
        if (patch.speechProvider !== undefined) setSpeechProvider(patch.speechProvider);
        if (patch.environmentCity !== undefined) setEnvironmentCity(patch.environmentCity);
        if (patch.physics !== undefined) setPhysics(patch.physics);
        if (patch.font !== undefined) setFont(patch.font);
        if (patch.animationWeights !== undefined) setWeights(patch.animationWeights);
        if (patch.whisperModel !== undefined) setWhisperModel(patch.whisperModel);
        if (patch.chatModel !== undefined) setChatModel(patch.chatModel);
        if (patch.chatMemoryRounds !== undefined) setChatMemory(patch.chatMemoryRounds);
        if (patch.chatMemory !== undefined) setLongTermMemory(patch.chatMemory);
        if (patch.chatImageLimit !== undefined) setChatImageLimit(patch.chatImageLimit);
      },
      [replace],
    );

    // When the configuration is not ready (loading/failed), the entire page is read-only to avoid editing the placeholder value and then saving it back.
    const { loadState, retry } = useConfigLoad(rt, applyConfig);
    const busy = saving || preparingMemory || loadState !== 'ready';

    // Switch system notification: only change the local status (when opening, use this user gesture to apply for permission), and the configuration is written in the entire package when "Save" is clicked.
    const toggleNotify = async (v: boolean) => {
      setNotifyEnabled(v);
      // Use user gestures to apply for system notification permission when enabled (automatic application without gestures may be silently suppressed by the browser).
      if (v) await requestNotificationPermission();
    };

    // "Test pop-up window": Get permission first and then send a test notification. The reason and guidance will be displayed on the spot.
    const testNotification = () => void runNotificationTest({ t, report: setPermMsg });

    // The currently selected pet object (form data source); selId is maintained synchronously by add/remove/sync, and the list is always valid when it is not empty.
    const cur = pets.find((p) => p.id === selId) ?? null;
    // The avatar can only belong to pet pack: main (including instances without assetRoot) uses the plugin to default to logo, and no entry point is uploaded.
    const avatarEditable = cur !== null && cur.assetRoot !== undefined && cur.assetRoot !== 'main';

    /**
     * Upload the current pet's avatar: persist to disk directly without "save" - the avatar is not a configuration
     * field, and you do not need to click save after changing it. The ownership depends on the asset root (the file
     * pet is the directory prefix, and multiple instances of the same asset root share one file).
     */
    const uploadAvatar = (file: File): void => {
      if (cur === null) return;
      const assetRoot = cur.assetRoot ?? '';
      setAvatarBusy(true);
      void (async () => {
        try {
          const result = await uploadPetAvatar(assetRoot, file);
          if (!result.ok) {
            setMsg({ kind: 'err', text: result.message });
            return;
          }
          // Change the version number to re-fetch the preview immediately, otherwise the browser will still use the old image in the cache.
          setAvatarVersion(Date.now());
          setMsg({ kind: 'ok', text: t('avatarUploaded') });
        } catch (error) {
          setMsg({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setAvatarBusy(false);
        }
      })();
    };

    // Number of file pet entries: only used for title prompt "Another n only comes from pet/directory".
    const packCount = kinds.filter((item) => item.kind === 'pack').length;

    // The current values of the seven top-level switches: each card recognizes its own several items, and the key name has the same name as the resolved configuration field.
    const globalFlags: GlobalFlags = {
      notificationsEnabled: notifyEnabled,
      notifyWhenFocused,
      clickSoundEnabled: clickSound,
      confineToScreen: confineScreen,
      trayEnabled,
    };
    const chatFlags: ChatFlagValues = {
      whisperImageEnabled: whisperImage,
      chatImageEnabled: chatImage,
      chatAnimationEnabled: chatAnimation,
    };

    // The notification switch requires user gestures to apply for permission, and the remaining six are pure setState;
    // unified into a "key name → setter" lookup table to avoid long switch. The two switches share this table: the
    // mapping from key name to setter is write-only once, and the card only returns the key name.
    const flagSetters: Record<GlobalFlagKey | ChatFlagKey, (value: boolean) => void> = {
      notificationsEnabled: (value) => void toggleNotify(value),
      notifyWhenFocused: setNotifyWhenFocused,
      clickSoundEnabled: setClickSound,
      confineToScreen: setConfineScreen,
      trayEnabled: setTrayEnabled,
      whisperImageEnabled: setWhisperImage,
      chatImageEnabled: setChatImage,
      chatAnimationEnabled: setChatAnimation,
    };
    const setGlobalFlag = (key: GlobalFlagKey, value: boolean): void => flagSetters[key](value);
    const setChatFlag = (key: ChatFlagKey, value: boolean): void => flagSetters[key](value);

    /** Partial patch writing: The font and physical parameters are "the entire object + changing a few fields". */
    const patchFont = (patch: Partial<FontConfig>): void => setFont((current) => ({ ...current, ...patch }));
    const patchPhysics = (patch: Partial<PhysicsParams>): void => setPhysics((current) => ({ ...current, ...patch }));

    /** Each of the two model fields has a status, and the card only returns the key name. */
    const setModel = (key: ModelFieldKey, value: ModelSelection): void => {
      if (key === 'whisperModel') setWhisperModel(value);
      else setChatModel(value);
    };

    // The write path is at settings/write-flow.ts: saving, request synchronization and "confirmation" distribution all
    // use the same verification and persist to disk. The callback is passed instead of the value - save. Each time the
    // rendering is rebuilt, the capture state will be saved with the old value.
    const write = createWriteFlow({
      fields: () => ({
        // PUT /config write-only User master configuration: Only main layer instances can be submitted, and pack instances go to POST /pet-config.
        pets: mainPets,
        notificationsEnabled: notifyEnabled,
        notifyWhenFocused,
        clickSoundEnabled: clickSound,
        whisperImageEnabled: whisperImage,
        chatImageEnabled: chatImage,
        chatAnimationEnabled: chatAnimation,
        confineToScreen: confineScreen,
        trayEnabled,
        voiceEnabled,
        // 空串 = 还没加载到成品值：不提交，免得用一个本地猜的音色覆盖配置
        ...(voiceName === '' ? {} : { voiceName }),
        voiceVolume,
        voiceWhisperEnabled,
        voiceTodoEnabled,
        voiceNotifyEnabled,
        // 空串 = 还没加载到成品值：不提交，免得用一个本地猜的识别实现覆盖配置
        ...(speechProvider === '' ? {} : { speechProvider }),
        // 城市覆盖与上面两项不同：空串是有效值（= 恢复自动定位），必须照常提交
        environmentCity,
        physics,
        whisperModel,
        chatModel,
        chatMemoryRounds: chatMemory,
        chatMemory: longTermMemory,
        chatImageLimit,
        font,
        animationWeights: weights,
      }),
      busy: () => busy,
      setBusy,
      setMsg,
      setDialog,
      dialog: () => dialog,
      applyConfig,
      packWrites,
      userFile: () => paths?.user ?? '',
      t,
      onRemove: remove,
    });

    // The shortcut keys must use the latest save: save is rebuilt every time it is rendered (the closure captures pets
    // / physics and other states). Directly inserting it into useEffect ([]) will save the old state; here it is
    // forwarded once for each rendering.
    const saveRef = useRef<() => void>(() => {});
    useEffect(() => {
      saveRef.current = () => void write.save();
    });

    // Ctrl + S / Cmd + S Save: The page is very long, so you don’t have to scroll to the bottom to find the button
    // after making changes. Only take over when this settings page is visible, and only preventDefault when you really
    // want to save it, otherwise the browser's "Save Web Page" will be blocked.
    useEffect(() => {
      const onKey = (e: KeyboardEvent): void => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        if (e.key.toLowerCase() !== 's') return;
        const root = rootRef.current;
        if (!root || !root.isConnected || root.getClientRects().length === 0) return;
        e.preventDefault();
        saveRef.current();
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, []);

    // The card order is the reading order: edit the pet first, then change the global default, and finally the persist to disk location and pop-up window.
    return h('section', {
      ref: rootRef,
      className: 'dsh-pet-cfg',
      style: { maxWidth: '720px' },
      children: [
        // Title: intro and "Extra Pet" description are both included in question marks.
        h('h2', {
          className: 'dsh-pet-cfg__title',
          children: [
            t('nav'),
            q(packCount > 0 ? t('intro') + '\n' + t('extraPetsHint').replace('{n}', String(packCount)) : t('intro')),
          ],
        }),

        h(LoadStatus, { loadState, onRetry: retry }),

        h(KindTabs, { kinds, kind, busy, onSelect: selectKind }),
        h(PetTabs, { pets: visiblePets, selId, busy, onSelect: select, onAdd: add }),
        h(PetCard, {
          pet: cur,
          busy,
          msg,
          entryPrompt,
          // The preview and chat panel have the same address: the built-in default is logo, so there is no need to distinguish whether there is an avatar or not.
          avatarSrc: avatarUrl(cur?.assetRoot ?? '', avatarVersion),
          avatarBusy,
          // Built-in entries do not have this capability: if onAvatar is not passed, the card will only render the preview.
          ...(avatarEditable ? { onAvatar: uploadAvatar } : {}),
          onChange: update,
          onSave: () => void write.save(),
          onRemove: requestRemove,
        }),
        h(GlobalCard, { busy, values: globalFlags, onChange: setGlobalFlag }),
        h(VoiceCard, {
          busy,
          enabled: voiceEnabled,
          voiceName,
          volume: voiceVolume,
          voices: voiceOptions,
          whisperEnabled: voiceWhisperEnabled,
          todoEnabled: voiceTodoEnabled,
          notifyEnabled: voiceNotifyEnabled,
          speechProvider,
          speechProviders,
          onSpeechProviderChange: setSpeechProvider,
          onToggle: setVoiceEnabled,
          onVoiceChange: setVoiceName,
          onVolumeChange: setVoiceVolume,
          onWhisperToggle: setVoiceWhisperEnabled,
          onTodoToggle: setVoiceTodoEnabled,
          onNotifyToggle: setVoiceNotifyEnabled,
        }),
        h(FontCard, { busy, font, onChange: patchFont }),
        h(ModelCard, {
          petId: selId,
          busy,
          catalog,
          failed: catalogFailed,
          whisperModel,
          chatModel,
          onModelChange: setModel,
          chatMemory,
          longTermMemory,
          onLongTermMemoryChange: setLongTermMemory,
          chatImageLimit,
          onChatMemoryChange: setChatMemory,
          onChatImageLimitChange: setChatImageLimit,
          values: chatFlags,
          onFlagChange: setChatFlag,
        }),
        h(MemorySetup, {
          disabled: saving || loadState !== 'ready' || longTermMemory.backend === 'dsh-powercontext',
          onBusy: setPreparingMemory,
          onBinding: (binding: NonNullable<MemorySetupStatus['binding']>) => {
            if (longTermMemory.backend !== 'dsh-powercontext') {
              setLongTermMemory(binding.chatMemory);
              setChatMemory(binding.chatMemoryRounds);
            }
          },
        }),
        h(PhysicsCard, { busy, physics, onChange: patchPhysics }),
        h(MotionCard, { busy, weights, onChange: setWeights }),
        h(MobileCard, { busy, physics, onChange: patchPhysics }),
        h(EnvironmentCard, { busy, city: environmentCity, onChange: setEnvironmentCity }),
        h(Actions, {
          busy,
          msg,
          permMsg,
          onSave: () => void write.save(),
          onSync: write.requestSync,
          onTestNotification: testNotification,
        }),

        // Save button The following is a reference card: read-only description, no need to click save whether to change it or not.
        h(ShortcutsCard, {}),
        h(ObservabilityCard, {}),

        // The persist to disk position of both cards is meta. If it cannot be read, the whole block will not appear.
        paths ? h(ConfigMetaCard, { paths }) : null,
        paths ? h(StorageCard, { paths }) : null,

        dialog
          ? h(SettingsDialog, { dialog, selId, onDismiss: () => setDialog(null), onConfirm: write.confirmDialog })
          : null,
      ],
    });
  };
}
