/**
 * 系统通知引擎（浏览器半侧）：消费宿主生成的通知帧，按「聚焦不弹」发系统级 toast；
 * `main.notifyWhenFocused` 打开时不再做这道判断。
 * 这是独立于宠物的能力，只随 DSH 网页端走——桌面模式不做宠物无关的功能。
 * 不负责产生帧：宿主监听 DSH 事件并写进 `/state`，容器统一轮询发现 counter 变化后调 `notifyFromFrame`；
 * 中断 / 活动门等过滤也已在宿主侧完成。
 * 依赖 shared/notify.ts 的帧到文案映射、成品配置的 `main.notificationsEnabled` 总开关，
 * 以及 app.ts 注入的会话跳转与命名服务（取不到时只降级，不影响弹窗）。
 * @module dsh-pet/src/client/notify
 */

import { frameToToast, truncate, NOTIFY_ICONS as ICON_NAMES, type NotifyFrame } from '../shared/notify.ts';
import { ROUTE_PATH } from '../shared/constants.ts';

let pageVisible = typeof document !== 'undefined' && !document.hidden;
let pageFocused = typeof document !== 'undefined' && document.hasFocus();

function refreshVisible(): void {
  pageVisible = !document.hidden;
}
function refreshFocused(): void {
  pageFocused = document.hasFocus();
}

/** register focus and visibility monitoring, return the unbinding function. */
function initFocusTracking(): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', refreshVisible);
  window.addEventListener('focus', refreshFocused);
  window.addEventListener('blur', refreshFocused);
  return () => {
    document.removeEventListener('visibilitychange', refreshVisible);
    window.removeEventListener('focus', refreshFocused);
    window.removeEventListener('blur', refreshFocused);
  };
}

/** 用户是否在看本页（页面可见且持有焦点）。
 *  系统通知与工作状态播报共用这一条：用户在看就不打扰，走开了才提醒。
 *  {@link isNotifyWhenFocused} 打开时调用方不再走这条路。 */
export function isPageActive(): boolean {
  return pageVisible && pageFocused;
}

/**
 * 这一次要不要提醒。
 *
 * 总开关由调用方先判（系统通知与工作状态播报各有一个）；这里只回答「前台提醒」这一层：
 * 打开就提醒，关闭时只在用户走开 / 页面不可见时才提醒。
 *
 * @param whenFocused - 成品配置的 `main.notifyWhenFocused`。
 * @param pageActive - 用户是否正看着本页（{@link isPageActive}）。
 * @returns 该提醒时为 true。
 */
export function shouldRemind(whenFocused: boolean, pageActive: boolean): boolean {
  return whenFocused || !pageActive;
}

/** Icon URL; pic route provided by host (`assets/pic` → `/dsh-pet-7340/pic/<file>`). */
const PIC = (name: string): string => `${ROUTE_PATH}/pic/${name}.png`;

/** Icon URL table; the file name uses shared as the single source, and the test notification on the settings page also uses it. */
export const NOTIFY_ICONS = {
  done: PIC(ICON_NAMES.done),
  error: PIC(ICON_NAMES.error),
  truncated: PIC(ICON_NAMES.truncated),
  approval: PIC(ICON_NAMES.approval),
  question: PIC(ICON_NAMES.question),
  test: PIC(ICON_NAMES.test),
} as const;

/** The currently effective main switch; it can be updated by reloadNotifications during operation, and it will take effect immediately after the setting page is saved. */
let notifyEnabled = true;

/** 前台聚焦时是否也提醒；同样由 reloadNotifications 更新，缺键按 false。 */
let notifyWhenFocused = false;

/** 前台聚焦时是否也提醒；系统通知与工作状态播报共用这一条。 */
export function isNotifyWhenFocused(): boolean {
  return notifyWhenFocused;
}

/** Session jump and naming: Injected by app.ts, it degrades to not jumping the session and not recognizing the session name when the service cannot be obtained. */
export interface SessionNavigator {
  openSession(sessionId: string): void;
  /** The display name of the session (for notification title); if there is no name, the session is not in the list or cannot be obtained, undefined is returned. */
  sessionTitle?(sessionId: string): string | undefined;
}

/** The currently effective session jumper (app.ts injection; undefined when the old version DSH does not have uiWorkspace). */
let sessionNavigator: SessionNavigator | undefined;

/**
 * Get the display name of a certain conversation (for notification title).
 *
 * @param navigator - Session service injected by app.ts; older versions of DSH may be missing entirely.
 * @param sessionId - Session id carried by the frame; if missing, no query is even performed.
 * @returns session name; when there is no injector, the service does not have this capability, or the query throws an
 * error, undefined is returned, and the caller fallback is fixed copy.
 */
export function sessionTitleFrom(
  navigator: SessionNavigator | undefined,
  sessionId: string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined;
  try {
    return navigator?.sessionTitle?.(sessionId);
  } catch {
    // getSnapshot of host store may be thrown when the first screen list is still pending; if the name cannot be obtained, only the fallback title will be used, and the pop-up window must not be affected.
    return undefined;
  }
}

/**
 * Switch to the specified session and call the window to the foreground.
 *
 * Cut the session first and then call the window. The moment the user sees the window is the target session;
 * `dsh://open` is only sent in the Electron host. Navigating this protocol in the browser will pop up the interception
 * box.
 *
 * @param sessionId - target session; default only attempts to call the window. Silently skip switching when the
 * session is deleted or the service is missing.
 */
export function jumpToSession(sessionId?: string): void {
  if (sessionId !== undefined) {
    // Jump failure (the session has been deleted/the old version does not have this service) must not affect the "call the window back" leg.
    try {
      sessionNavigator?.openSession(sessionId);
    } catch {
      /* Just do not skip the session, continue to call the window. */
    }
  }
  window.focus();
  if (!/electron/i.test(navigator.userAgent)) return;
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = 'dsh://open';
  document.body.append(frame);
  setTimeout(() => frame.remove(), 1000);
}

/** Click the notification: close the pop-up window and jump to the conversation it refers to (see jump details {@link jumpToSession}). */
export function wireNotificationClick(n: Notification, sessionId?: string): void {
  n.onclick = () => {
    n.close();
    jumpToSession(sessionId);
  };
}

/**
 * Send a system notification; the main switch is turned off, the environment is not supported, it is not authorized,
 * or this page is skipped silently while being viewed. Logs are only recorded behind the door: blocked triggers do not
 * generate "pop-up" logs.
 */
function toast(title: string, body?: string, icon?: string, sessionId?: string): void {
  if (!notifyEnabled) return;
  // 开关关着时维持「聚焦不打扰」；打开后照常弹，不再看页面是否活跃。
  if (!shouldRemind(notifyWhenFocused, isPageActive())) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  console.log('[dsh-pet] [notification]' + title + (body ? '：' + body : ''));
  try {
    const opts: NotificationOptions = {};
    if (body) opts.body = truncate(body);
    if (icon) opts.icon = icon;
    // The click behavior and the real event notification share wireNotificationClick; if the icon loading fails, it will only be downgraded to no icon and the pop-up window will not be closed.
    const n = new Notification(title, opts);
    wireNotificationClick(n, sessionId);
  } catch {
    /* Some desktop shells throw errors during construction: ignore, do not interrupt business. */
  }
}

/**
 * Frame → toast concurrency out; unknown frames are silently skipped, and sessionId in the frame is also transparently
 * transmitted to the click behavior. The title uses the session name first: multiple sessions can run in parallel on
 * the same host, and the notification must be able to identify which one came back.
 */
function toastFrame(frame: NotifyFrame): void {
  const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : undefined;
  const t = frameToToast(frame, sessionTitleFrom(sessionNavigator, sessionId));
  if (!t) return;
  toast(t.title, t.body, PIC(t.icon), sessionId);
}

/** The result of applying for notification permission; when failed, the reason and optional copy are provided for display in red on the settings page. */
export type PermissionResult =
  { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'rejected' | 'error'; message?: string };

/**
 * Applying for browser notification permission must be called under user gesture (click), otherwise it may be silently
 * suppressed. Reason for failure: `unsupported` has no Notification, `denied` has been blocked, `rejected` selected
 * block when asking, `error` applied abnormally.
 */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (typeof Notification === 'undefined') return { ok: false, reason: 'unsupported' };
  if (Notification.permission === 'granted') return { ok: true };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') return { ok: true };
    if (p === 'denied') return { ok: false, reason: 'rejected' };
    // The pop-up window is closed directly / not selected: the browser is still default.
    return { ok: false, reason: 'error', message: '权限未授予（' + p + '）' };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** 读两个通知开关（成品配置 main 条目）；拉取或解析失败时按「总开关开启、不额外提醒」处理，不阻塞。 */
async function readNotifySettings(): Promise<{ enabled: boolean; whenFocused: boolean }> {
  try {
    const r = await fetch(ROUTE_PATH + '/config');
    if (!r.ok) return { enabled: true, whenFocused: false };
    const d = (await r.json().catch(() => null)) as { main?: Record<string, unknown> } | null;
    const main = d?.main;
    return {
      enabled: typeof main?.notificationsEnabled === 'boolean' ? main.notificationsEnabled : true,
      whenFocused: main?.notifyWhenFocused === true,
    };
  } catch {
    return { enabled: true, whenFocused: false };
  }
}

/** 重读两个开关（设置页保存开关后调用）；之后新触发的通知按新值执行，无需刷新页面。 */
export async function reloadNotifications(): Promise<void> {
  const settings = await readNotifySettings();
  notifyEnabled = settings.enabled;
  notifyWhenFocused = settings.whenFocused;
}

/** One frame notification → toast; unified polling `/state` by the container is called after discovering the change of `sections.notify`. */
export function notifyFromFrame(frame: unknown): void {
  toastFrame(frame as NotifyFrame);
}

/**
 * Initialize the notification engine: remember the session jumper, read master switch, fallback to apply for
 * permissions and track page focus; do not do polling.
 * @param navigator - Session jump and naming service; when not transmitted, clicking only calls the window, title
 * fallback and fixed copy.
 * @returns releases the function and removes focus monitoring.
 */
export function initNotify(navigator?: SessionNavigator): () => void {
  sessionNavigator = navigator;
  // Master switch reads resolved configuration (failure to pull does not block, default enabled); then reloadNotifications rereads after saving from the settings page.
  void readNotifySettings().then((settings) => {
    notifyEnabled = settings.enabled;
    notifyWhenFocused = settings.whenFocused;
    if (typeof Notification !== 'undefined' && settings.enabled && Notification.permission === 'default') {
      // fallback application; the browser may suppress it when there is no gesture, and the real application is at the switch or button click of the settings page.
      void requestNotificationPermission();
    }
  });
  return initFocusTracking();
}
