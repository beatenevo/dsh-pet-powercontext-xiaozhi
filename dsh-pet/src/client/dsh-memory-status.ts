/** Shared bilingual labels for optional DSH project memory. Other locales fall back to English. */
export const dshMemoryZh = {
  memoryDsh: '使用 DSH 的 PowerContext 插件',
  memoryDshHint:
    '复用 DSH 的连接和当前项目范围。桌宠聊天只保存在本地；项目之间隔离近期上下文。插件缺失或连接失败时仍可聊天。保存后生效。',
  dshMemoryLocal: '桌宠聊天仅保存在本机，不写入 DSH 项目记忆。未确定项目时，本轮不带历史上下文。',
  dshMemoryConnected: '项目范围已连接，尚未召回',
  dshMemoryReady: '已召回当前项目记忆',
  dshMemoryEmpty: '当前问题没有相关项目记忆',
  dshMemoryFallback: '共享记忆暂不可用，普通聊天仍可使用',
  dshMemoryPlugin: '请在 DSH 中安装并启用支持共享接口的 PowerContext 插件',
  dshMemorySession: '请先打开一个 DSH 项目会话',
  dshMemoryScope: '请在 PowerContext 中关联当前 DSH 工作区的 Scope；不会自动使用默认范围',
  dshMemoryConnection: '请检查 DSH PowerContext 连接；恢复后自动重试',
};

export const dshMemoryEn: Record<keyof typeof dshMemoryZh, string> = {
  memoryDsh: 'Use the DSH PowerContext plugin',
  memoryDshHint:
    'Reuse the DSH connection and active project Scope. Pet chats stay local; recent context is isolated between projects. Chat works if the plugin or connection is unavailable. Save to apply.',
  dshMemoryLocal:
    'Pet chats stay on this device and are not written to DSH project memory. Unresolved projects use no previous chat context.',
  dshMemoryConnected: 'Project Scope connected; recall has not run',
  dshMemoryReady: 'Recalled relevant project memory',
  dshMemoryEmpty: 'No relevant project memory for this question',
  dshMemoryFallback: 'Shared memory unavailable; ordinary chat remains available',
  dshMemoryPlugin: 'Install and enable a PowerContext DSH plugin supporting the companion interface',
  dshMemorySession: 'Open a DSH project session first',
  dshMemoryScope:
    'Bind the current DSH workspace to a Scope in PowerContext; no default Scope is selected automatically',
  dshMemoryConnection: 'Check the DSH PowerContext connection; it will retry automatically',
};

/** Describe only safe status fields; upstream exception text is never rendered. */
export function describeDshMemory(
  status: { recall: string; error?: string | null; workspace?: string | null; scopeId?: string | null },
  t: (key: keyof typeof dshMemoryZh) => string,
): string {
  if (status.error || status.recall === 'unavailable') {
    const error = status.error ?? '';
    const reason = error.startsWith('plugin-')
      ? 'dshMemoryPlugin'
      : ['session-required', 'workspace-unavailable'].includes(error)
        ? 'dshMemorySession'
        : error === 'scope-unavailable'
          ? 'dshMemoryScope'
          : 'dshMemoryConnection';
    return t('dshMemoryFallback') + ' · ' + t(reason);
  }
  const state =
    status.recall === 'ready' ? 'dshMemoryReady' : status.recall === 'empty' ? 'dshMemoryEmpty' : 'dshMemoryConnected';
  return 'DSH PowerContext · ' + (status.workspace ?? '') + ' · ' + (status.scopeId ?? '') + ' · ' + t(state);
}
