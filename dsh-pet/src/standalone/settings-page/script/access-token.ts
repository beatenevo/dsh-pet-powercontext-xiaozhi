/** Wire token replacement without exposing the saved credential in page markup or storage. */
export function accessTokenScript(): string {
  return `
function wireAccessToken() {
  const form = byId('access-token-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = byId('access-token');
    const next = field.value;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/standalone-ai/access-token', {
        method: 'PUT', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: next }),
      });
      if (!response.ok) throw new Error('保存失败，请检查格式或从桌宠菜单重新打开设置。');
      TOKEN = next;
      field.value = '';
      setStatus(byId('access-token-status'), '已生效，无需重启。请同步更新外部调用方的 Token。', 'ok');
    } catch {
      setStatus(byId('access-token-status'), '未确认保存成功。请从桌宠菜单重新打开设置后重试。', 'error');
    } finally { button.disabled = false; }
  });
}
`;
}
