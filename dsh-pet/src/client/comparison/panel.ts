/** A host-mounted comparison dialog, also shared by standalone mode. No raw content is sent to telemetry. */
import type { ChatPanelRuntime } from '../chat/runtime.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import {
  comparisonObservedInput,
  comparisonInputTokens,
  comparisonTotals,
  type ComparisonRun,
  type ComparisonAnswer,
  type MemoryUsage,
} from '../../shared/comparison.ts';

export function makeComparisonPanel(rt: ChatPanelRuntime): () => unknown {
  const { h, useState, useEffect, t } = rt;
  return function ComparisonPanel(): unknown {
    const [open, setOpen] = useState(false);
    const [corpus, setCorpus] = useState('');
    const [questions, setQuestions] = useState('');
    const [moreQuestions, setMoreQuestions] = useState('');
    const [recentBytes, setRecentBytes] = useState(1024);
    const [run, setRun] = useState<ComparisonRun | null>(null);
    const [error, setError] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [reviews, setReviews] = useState<Record<string, string>>({});
    useEffect(() => {
      if (!open) return;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const poll = async (): Promise<void> => {
        try {
          const response = await fetch(ROUTE_PATH + '/comparison', { signal: controller.signal, cache: 'no-store' });
          const value = await response.json();
          if (!response.ok || value.ok === false) throw new Error('unavailable');
          if (!controller.signal.aborted) setRun(value.run);
        } catch {
          if (!controller.signal.aborted) setError(true);
        }
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      };
      void poll();
      return () => {
        controller.abort();
        clearTimeout(timer);
      };
    }, [open]);
    const busy = submitting || run?.status === 'preparing' || run?.status === 'running';
    const number = (value: number | undefined | null): string =>
      value == null ? t('comparisonUnknown') : value.toLocaleString();
    const button = (label: string, onClick: () => void, disabled = false) =>
      h('button', { type: 'button', onClick, disabled, children: label });
    const trace = (url?: string) =>
      url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', children: t('comparisonTrace') }) : null;
    const status = (value: string) =>
      t(
        value === 'preparing'
          ? 'comparisonPreparing'
          : value === 'running'
            ? 'comparisonRunning'
            : value === 'complete'
              ? 'comparisonComplete'
              : value === 'failed'
                ? 'comparisonFailed'
                : value === 'cancelled'
                  ? 'comparisonCancelled'
                  : 'comparisonPending',
      );
    const start = async (): Promise<void> => {
      setSubmitting(true);
      setError(false);
      try {
        const response = await fetch(ROUTE_PATH + '/comparison', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            corpus,
            questions: questions
              .split('\n')
              .map((q) => q.trim())
              .filter(Boolean),
            recentBytes,
          }),
        });
        const value = await response.json();
        if (!response.ok || value.ok === false) throw new Error('start_failed');
        setRun(value.run);
        setReviews({});
      } catch {
        setError(true);
      } finally {
        setSubmitting(false);
      }
    };
    const continueRun = async (): Promise<void> => {
      if (!run) return;
      setSubmitting(true);
      setError(false);
      try {
        const response = await fetch(ROUTE_PATH + '/comparison/continue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: run.id,
            questions: moreQuestions
              .split('\n')
              .map((q) => q.trim())
              .filter(Boolean),
          }),
        });
        const value = await response.json();
        if (!response.ok || value.ok === false) throw new Error('continue_failed');
        setRun(value.run);
        setMoreQuestions('');
      } catch {
        setError(true);
      } finally {
        setSubmitting(false);
      }
    };
    const cancel = async (): Promise<void> => {
      try {
        const response = await fetch(ROUTE_PATH + '/comparison/cancel', { method: 'POST' });
        if (!response.ok) throw new Error('cancel_failed');
      } catch {
        setError(true);
      }
    };
    const exportRun = (): void => {
      if (!run) return;
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { protocol: 'dsh-pet.context-strategy-comparison.v1', run, manualReviews: reviews },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'powercontext-comparison-' + run.id + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const ledger = (usage: MemoryUsage | undefined, label: string) =>
      h('section', {
        className: 'pet-comparison-ledger',
        children: [
          h('h3', { children: label }),
          ...(['generation', 'embedding'] as const).map((kind) =>
            h('p', {
              children: [
                t(kind === 'generation' ? 'comparisonGeneration' : 'comparisonEmbedding') + ': ',
                number(usage?.[kind].requests) + ' ' + t('comparisonRequests') + ' · ',
                t('comparisonInput') +
                  ' ' +
                  number(usage?.[kind].input) +
                  ' · ' +
                  t('comparisonOutput') +
                  ' ' +
                  number(usage?.[kind].output),
              ],
            }),
          ),
        ],
      });
    const answerNode = (answer: ComparisonAnswer, round: number) => {
      const title = t(
        answer.strategy === 'full'
          ? 'comparisonFull'
          : answer.strategy === 'memory'
            ? 'comparisonMemory'
            : 'comparisonShort',
      );
      const key = (run?.id ?? '') + ':' + round + ':' + answer.strategy;
      return h('article', {
        className: 'pet-comparison-answer',
        'data-strategy': answer.strategy,
        children: [
          h('h3', { children: title }),
          h('div', {
            className: 'pet-comparison-tokens',
            children: [
              `${t('comparisonInput')} ${number(comparisonInputTokens(answer.usage))} · ${t('comparisonOutput')} ${number(answer.usage?.outputTokens)}`,
              h('small', {
                children: `${t('comparisonCache')} ${number(answer.usage?.cacheReadTokens)} · ${t('comparisonDuration')} ${number(answer.durationMs)} ms`,
              }),
            ],
          }),
          h('p', { className: 'pet-comparison-answer-text', children: answer.text ?? status(answer.status) }),
          h('small', {
            children:
              `${t('comparisonBytes')} ${number(answer.contextBytes)}` +
              (answer.strategy === 'memory' ? ` · ${t('comparisonRecall')} ${number(answer.recallBytes)}` : ''),
          }),
          trace(answer.traceUrl),
          h('label', {
            children: [
              t('comparisonQuality'),
              h('select', {
                'aria-label': title + ' ' + t('comparisonQuality'),
                value: reviews[key] ?? 'unreviewed',
                disabled: answer.status !== 'complete',
                onChange: (event: { target: { value: string } }) =>
                  setReviews((old) => ({ ...old, [key]: event.target.value })),
                children: ['unreviewed', 'pass', 'fail'].map((value) =>
                  h('option', {
                    value,
                    children: t(
                      value === 'pass'
                        ? 'comparisonPass'
                        : value === 'fail'
                          ? 'comparisonFail'
                          : 'comparisonUnreviewed',
                    ),
                  }),
                ),
              }),
            ],
          }),
        ],
      });
    };
    const totals = run
      ? (['full', 'memory', 'short'] as const).map((strategy) => ({ strategy, ...comparisonTotals(run, strategy) }))
      : [];
    const full = totals[0]?.input,
      memory = totals[1]?.input;
    const saving =
      full !== undefined && full > 0 && memory !== undefined
        ? ((1 - memory / full) * 100).toFixed(1) + '%'
        : t('comparisonUnknown');
    const observedInput = run ? comparisonObservedInput(run) : undefined;
    const observedSaving =
      full !== undefined && full > 0 && observedInput !== undefined
        ? ((1 - observedInput / full) * 100).toFixed(1) + '%'
        : t('comparisonUnknown');
    const memoryOutput = run?.memoryUsage?.generation.output;
    const observedOutput =
      memoryOutput != null && totals[1]?.output !== undefined ? memoryOutput + totals[1].output : undefined;
    return h('div', {
      className: 'pet-comparison-launch',
      children: [
        button(t('comparisonOpen'), () => setOpen(true)),
        open
          ? h('dialog', {
              ref: (node: HTMLDialogElement | null) => {
                if (node && !node.open) node.showModal();
              },
              onCancel: (event: { preventDefault(): void }) => {
                event.preventDefault();
                setOpen(false);
              },
              className: 'pet-comparison',
              role: 'dialog',
              'aria-modal': true,
              'aria-label': t('comparisonTitle'),
              onKeyDown: (event: { key: string }) => {
                if (event.key === 'Escape') setOpen(false);
              },
              children: [
                h('header', {
                  children: [
                    h('h2', { children: t('comparisonTitle') }),
                    button(t('comparisonClose'), () => setOpen(false)),
                  ],
                }),
                h('p', { children: t('comparisonIntro') }),
                h('details', {
                  open: !run,
                  children: [
                    h('summary', { children: t('comparisonCorpus') }),
                    h('label', {
                      children: [
                        t('comparisonCorpus'),
                        h('textarea', {
                          value: corpus,
                          maxLength: 49152,
                          disabled: busy,
                          rows: 5,
                          onChange: (e: { target: { value: string } }) => setCorpus(e.target.value),
                        }),
                      ],
                    }),
                    h('label', {
                      children: [
                        t('comparisonQuestions'),
                        h('textarea', {
                          value: questions,
                          maxLength: 8008,
                          disabled: busy,
                          rows: 3,
                          onChange: (e: { target: { value: string } }) => setQuestions(e.target.value),
                        }),
                      ],
                    }),
                    h('label', {
                      children: [
                        t('comparisonRecent'),
                        h('input', {
                          type: 'number',
                          min: 128,
                          max: 8192,
                          value: recentBytes,
                          disabled: busy,
                          onChange: (e: { target: { value: string } }) => setRecentBytes(Number(e.target.value)),
                        }),
                      ],
                    }),
                    h('p', { children: t('comparisonConsent') }),
                    button(t('comparisonStart'), () => void start(), busy || !corpus.trim() || !questions.trim()),
                  ],
                }),
                error ? h('p', { role: 'alert', children: t('comparisonError') }) : null,
                run
                  ? h('div', {
                      children: [
                        h('div', {
                          className: 'pet-comparison-toolbar',
                          children: [
                            h('strong', { children: status(run.status) + ' · ' + run.model.model }),
                            button(t('comparisonExport'), exportRun),
                            busy ? button(t('comparisonStop'), () => void cancel()) : null,
                            trace(run.preparationTraceUrl),
                          ],
                        }),
                        h('p', {
                          children: `${t('comparisonScope')}: ${run.scopeId ?? '…'} · ${t('comparisonReady')}: ${number(run.preparation?.activeMemories)}`,
                        }),
                        h('section', {
                          className: 'pet-comparison-summary',
                          children: [
                            h('h3', { children: t('comparisonAnswerTotals') }),
                            h('strong', { children: t('comparisonReduction') + ': ' + saving }),
                            h('p', { children: t('comparisonObservedReduction') + ': ' + observedSaving }),
                            h('p', {
                              children:
                                t('comparisonObserved') +
                                ': ' +
                                number(observedInput) +
                                ' · ' +
                                t('comparisonMemoryOutput') +
                                ': ' +
                                number(observedOutput),
                            }),
                            ...totals.map((entry) =>
                              h('p', {
                                children: `${t(entry.strategy === 'full' ? 'comparisonFull' : entry.strategy === 'memory' ? 'comparisonMemory' : 'comparisonShort')}: ${t('comparisonInput')} ${number(entry.input)} · ${t('comparisonOutput')} ${number(entry.output)} · ${t('comparisonCache')} ${number(entry.cacheRead)}`,
                              }),
                            ),
                          ],
                        }),
                        h('p', { children: t('comparisonDataset') }),
                        run.status === 'complete' && run.rounds.length < 32
                          ? h('details', {
                              children: [
                                h('summary', { children: t('comparisonContinue') }),
                                h('p', { children: t('comparisonContinueHint') }),
                                h('textarea', {
                                  'aria-label': t('comparisonContinue'),
                                  value: moreQuestions,
                                  rows: 3,
                                  maxLength: 8008,
                                  onChange: (event: { target: { value: string } }) =>
                                    setMoreQuestions(event.target.value),
                                }),
                                button(
                                  t('comparisonContinue'),
                                  () => void continueRun(),
                                  submitting || !moreQuestions.trim(),
                                ),
                              ],
                            })
                          : null,
                        ...run.rounds.map((round, index) =>
                          h('section', {
                            className: 'pet-comparison-round',
                            children: [
                              h('h3', { children: `${index + 1}. ${round.question}` }),
                              h('div', {
                                className: 'pet-comparison-columns',
                                children: round.answers
                                  .filter((answer) => answer.strategy !== 'short')
                                  .map((answer) => answerNode(answer, index)),
                              }),
                              h('details', {
                                children: [
                                  h('summary', { children: t('comparisonShort') }),
                                  answerNode(
                                    round.answers.find((answer) => answer.strategy === 'short')!,
                                    index,
                                  ),
                                ],
                              }),
                            ],
                          }),
                        ),
                        h('div', {
                          className: 'pet-comparison-columns',
                          children: [
                            ledger(run.preparation, t('comparisonPreparation')),
                            ledger(run.memoryUsage, t('comparisonAccounting')),
                          ],
                        }),
                        run.accountingError || !run.memoryUsage
                          ? h('p', { role: 'status', children: t('comparisonIncomplete') })
                          : null,
                        !run.preparationTraceUrl ? h('p', { children: t('comparisonNoTrace') }) : null,
                      ],
                    })
                  : null,
                h('p', { className: 'pet-comparison-note', children: t('comparisonLimit') }),
              ],
            })
          : null,
      ],
    });
  };
}
