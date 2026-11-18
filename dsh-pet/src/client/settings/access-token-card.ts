/** DSH-owned settings form for a write-only external pet API credential. */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';

/** Create a credential editor that keeps authentication with the DSH session. */
export function makeAccessTokenCard(rt: SettingsRuntime) {
  const { h, t, useState, useEffect } = rt;
  const { field } = makeUiKit(rt);
  return function AccessTokenCard() {
    const [token, setToken] = useState('');
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
      const controller = new AbortController();
      void fetch(ROUTE_PATH + '/access-token', { signal: controller.signal, cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('failed');
          const result = (await response.json()) as { configured?: unknown };
          if (typeof result.configured !== 'boolean') throw new Error('failed');
          if (!controller.signal.aborted) setConfigured(result.configured);
        })
        .catch(() => {
          if (!controller.signal.aborted) setMessage(t('accessTokenFailed'));
        });
      return () => controller.abort();
    }, []);
    const save = async () => {
      if (busy || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
      setBusy(true);
      setMessage('');
      try {
        const response = await fetch(ROUTE_PATH + '/access-token', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok || ((await response.json()) as { ok?: boolean }).ok !== true) throw new Error('failed');
        setToken('');
        setConfigured(true);
        setMessage(t('accessTokenSaved'));
      } catch {
        setMessage(t('accessTokenFailed'));
      } finally {
        setBusy(false);
      }
    };
    return h('section', {
      className: 'dsh-pet-cfg__card',
      children: [
        h('h3', { children: t('accessTokenTitle') }),
        h('p', { children: t('accessTokenHint') }),
        h('p', { children: configured === null ? '' : t(configured ? 'accessTokenConfigured' : 'accessTokenUnset') }),
        field(
          t('accessTokenTitle'),
          h('input', {
            className: INPUT_CLASS,
            type: 'password',
            value: token,
            autoComplete: 'new-password',
            'aria-label': t('accessTokenTitle'),
            disabled: busy || configured === null,
            maxLength: 43,
            onChange: (event: { target: { value: string } }) => setToken(event.target.value),
          }),
        ),
        h('button', {
          type: 'button',
          className: 'dsh-pet-cfg__btn is-primary',
          disabled: busy || configured === null || !/^[A-Za-z0-9_-]{43}$/.test(token),
          onClick: () => {
            void save();
          },
          children: t('save'),
        }),
        h('p', { role: 'status', children: message }),
      ],
    });
  };
}
