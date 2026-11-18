/** Interface access copy; untranslated locales use the English fallback. */
export const interfaceAccessEn = {
  apiIdLabel: 'API Pet ID',
  apiIdHint: 'External pet query ID. Leave blank to use the internal ID. Changes preserve chat history and memory.',
  accessTokenTitle: 'Interface access token',
  accessTokenHint:
    'Use 43 letters, digits, underscores or hyphens. External API requests use X-DSH-Pet-Token. Saving takes effect immediately; DSH sessions and desktop pets remain connected.',
  accessTokenConfigured: 'A token is configured. Enter a new value to replace it.',
  accessTokenUnset: 'No external API token is configured.',
  accessTokenSaved: 'Saved. The previous token is no longer valid.',
  accessTokenFailed: 'Could not load or save the token. Check your DSH session and retry.',
};
export const interfaceAccessZh = {
  apiIdLabel: '接口 Pet ID',
  apiIdHint: '外部请求的 pet 参数使用此值，留空使用内部 ID。修改后保留原聊天记录与记忆。',
  accessTokenTitle: '接口访问 Token',
  accessTokenHint:
    '填写 43 位字母、数字、下划线或短横线。外部接口通过 X-DSH-Pet-Token 携带，保存立即生效；DSH 会话与桌宠继续正常使用。',
  accessTokenConfigured: '已配置 Token；填写新值可替换，当前值不回显。',
  accessTokenUnset: '尚未配置外部接口 Token。',
  accessTokenSaved: '已保存，旧 Token 已失效。',
  accessTokenFailed: '读取或保存失败，请检查 DSH 登录状态后重试。',
};
