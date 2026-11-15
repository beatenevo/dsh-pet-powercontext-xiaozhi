/** One settings and live-interaction entry point for both DSH and standalone hosts. */
import type { FunctionComponent } from 'react';
import { ROUTE_PATH } from '../../shared/constants.ts';
import {
  DEFAULT_OBSERVABILITY,
  type ObservabilityStatus,
  type ObservabilityConfig,
} from '../../shared/observability.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';

export function makeObservabilityCard(rt: SettingsRuntime): FunctionComponent {
  const { h, t, useState, useEffect, useRef } = rt;
  const { cardHead, field, toggleCell } = makeUiKit(rt);
  return function ObservabilityCard() {
    const [status, setStatus] = useState<ObservabilityStatus | null>(null);
    const [draft, setDraft] = useState<ObservabilityConfig>({ ...DEFAULT_OBSERVABILITY });
    const [key, setKey] = useState('');
    const [clearKey, setClearKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const initialized = useRef(false);
    useEffect(() => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        try {
          const response = await fetch(ROUTE_PATH + '/observability', {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
            cache: 'no-store',
          });
          const value = (await response.json()) as ObservabilityStatus;
          if (!response.ok || !value.config || !Array.isArray(value.interactions)) throw new Error('invalid');
          if (controller.signal.aborted) return;
          setStatus(value);
          if (!initialized.current) {
            initialized.current = true;
            setDraft(value.config);
          }
        } catch {
          if (!controller.signal.aborted && !initialized.current) setMessage(t('observationLoadFailed'));
        }
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 3000);
      };
      void poll();
      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }, []);
    const saveOrCheck = async (check: boolean) => {
      if (busy) return;
      setBusy(true);
      setMessage('');
      try {
        const response = await fetch(ROUTE_PATH + '/observability' + (check ? '/check' : ''), {
          method: check ? 'POST' : 'PUT',
          headers: { 'content-type': 'application/json' },
          body: check ? '{}' : JSON.stringify({ ...draft, ...(key ? { spaceKey: key } : {}), clearKey }),
          signal: AbortSignal.timeout(10_000),
        });
        const result = (await response.json()) as ObservabilityStatus & {
          ok?: boolean;
          accepted?: boolean;
          status?: ObservabilityStatus;
        };
        if (!response.ok || result.ok === false) throw new Error('failed');
        if (check) {
          if (!result.status) throw new Error('failed');
          setStatus(result.status);
          setMessage(t(result.accepted ? 'observationAccepted' : 'observationFailed'));
        } else {
          setStatus(result);
          setDraft(result.config);
          setKey('');
          setClearKey(false);
          setMessage(t('observationSaved'));
        }
      } catch {
        setMessage(t('observationFailed'));
      } finally {
        setBusy(false);
      }
    };
    const input = (name: 'baseUrl' | 'agentId' | 'spaceId', label: string) =>
      field(
        t(label),
        h('input', {
          className: INPUT_CLASS,
          type: 'text',
          value: draft[name],
          disabled: busy || !status,
          'aria-label': t(label),
          autoComplete: 'off',
          onChange: (event: { target: { value: string } }) => setDraft({ ...draft, [name]: event.target.value }),
        }),
      );
    const outcomeKey = {
      running: 'observationRunning',
      success: 'observationSuccess',
      error: 'observationError',
      cancelled: 'observationCancelled',
    };
    const deliveryKey = {
      pending: 'observationPending',
      accepted: 'observationDelivered',
      failed: 'observationExportFailed',
    };
    return h('section', {
      className: 'dsh-pet-cfg__card',
      'aria-label': t('observationTitle'),
      children: [
        cardHead(t('observationTitle'), t('observationHint')),
        h('p', { children: t('observationHint') }),
        toggleCell('observationEnabled', draft.enabled, busy || !status, (enabled) => setDraft({ ...draft, enabled })),
        input('baseUrl', 'observationBaseUrl'),
        input('agentId', 'observationAgentId'),
        input('spaceId', 'observationSpaceId'),
        field(
          t('observationKey'),
          h('input', {
            className: INPUT_CLASS,
            type: 'password',
            value: key,
            disabled: busy || !status,
            'aria-label': t('observationKey'),
            autoComplete: 'new-password',
            placeholder: t(status?.hasKey ? 'observationKeySaved' : 'observationKeyEmpty'),
            onChange: (event: { target: { value: string } }) => setKey(event.target.value),
          }),
        ),
        toggleCell('observationClearKey', clearKey, busy || !status, setClearKey),
        toggleCell('observationHttp', draft.allowInsecureHttp, busy || !status, (allowInsecureHttp) =>
          setDraft({ ...draft, allowInsecureHttp }),
        ),
        h('div', {
          className: 'dsh-pet-cfg__grid3',
          children: [
            h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: busy || !status,
              onClick: () => {
                void saveOrCheck(false);
              },
              children: t('observationSave'),
            }),
            h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              disabled: busy || !status?.config.enabled,
              onClick: () => {
                void saveOrCheck(true);
              },
              children: t('observationCheck'),
            }),
            status?.memoryUrl
              ? h('a', {
                  href: status.memoryUrl,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  children: t('observationMemory'),
                })
              : null,
          ],
        }),
        h('p', { role: 'status', children: message || (status?.error ? t('observationFailed') : '') }),
        h('h4', { children: t('observationRecent') }),
        !status?.interactions.length
          ? h('p', { children: t('observationEmpty') })
          : h('ul', {
              children: status.interactions.slice(0, 10).map((item) =>
                h(
                  'li',
                  {
                    children: [
                      h('span', {
                        children: `${item.operation} · ${t(outcomeKey[item.outcome])} · ${item.durationMs === undefined ? '—' : item.durationMs + ' ms'} · ${t(deliveryKey[item.delivery])} `,
                      }),
                      h('a', {
                        href: item.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        children: t('observationView'),
                      }),
                    ],
                  },
                  item.traceId,
                ),
              ),
            }),
        h('p', { children: t('observationEvidence') }),
      ],
    });
  };
}
