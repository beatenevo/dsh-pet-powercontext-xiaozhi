/** A host-mounted comparison dialog, also shared by standalone mode. No raw content is sent to telemetry. */
import { avatarUrl } from '../../shared/avatar.ts';
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

interface CompanionIdentity {
  petName: string;
  assetRoot: string;
  avatarVersion: number;
}

export function makeComparisonPanel(rt: ChatPanelRuntime): (pet: CompanionIdentity) => unknown {
  const { h, useState, useEffect, useRef, t } = rt;
  return function ComparisonPanel(pet: CompanionIdentity): unknown {
    const [open, setOpen] = useState(false);
    const [selectedRound, setSelectedRound] = useState(0);
    const launchRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
      const trigger = launchRef.current;
      if (open) return () => trigger?.focus();
    }, [open]);
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
    const button = (label: string, onClick: () => void, disabled = false, primary = false) =>
      h('button', {
        type: 'button',
        className: primary ? 'pet-comparison-primary' : undefined,
        onClick,
        disabled,
        children: label,
      });
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
        setSelectedRound(0);
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
            h('div', {
              className: 'pet-comparison-ledger-row',
              children: [
                h('span', { children: t(kind === 'generation' ? 'comparisonGeneration' : 'comparisonEmbedding') }),
                h('span', { children: number(usage?.[kind].requests) + ' ' + t('comparisonRequests') }),
                h('strong', { children: t('comparisonInput') + ' ' + number(usage?.[kind].input) }),
                h('span', { children: t('comparisonOutput') + ' ' + number(usage?.[kind].output) }),
              ],
            }),
          ),
        ],
      });
    const strategyTitle = (strategy: string) =>
      t(strategy === 'full' ? 'comparisonFull' : strategy === 'memory' ? 'comparisonMemory' : 'comparisonShort');
    const answerNode = (answer: ComparisonAnswer, round: number) => {
      const title = strategyTitle(answer.strategy);
      const key = (run?.id ?? '') + ':' + round + ':' + answer.strategy;
      return h('article', {
        className: 'pet-comparison-answer',
        'data-strategy': answer.strategy,
        children: [
          h('div', {
            className: 'pet-comparison-answer-heading',
            children: [
              h('h3', { children: title }),
              h('span', {
                className: 'pet-comparison-status',
                'data-status': answer.status,
                children: status(answer.status),
              }),
            ],
          }),
          h('div', {
            className: 'pet-comparison-tokens',
            children: [
              h('div', {
                children: [
                  h('small', { children: t('comparisonInput') + ' Token' }),
                  h('strong', { children: number(comparisonInputTokens(answer.usage)) }),
                ],
              }),
              h('div', {
                children: [
                  h('small', { children: t('comparisonOutput') + ' Token' }),
                  h('strong', { children: number(answer.usage?.outputTokens) }),
                ],
              }),
              h('div', {
                children: [
                  h('small', { children: t('comparisonDuration') }),
                  h('strong', { children: number(answer.durationMs) + ' ms' }),
                ],
              }),
            ],
          }),
          h('p', { className: 'pet-comparison-answer-text', children: answer.text ?? status(answer.status) }),
          h('div', {
            className: 'pet-comparison-answer-meta',
            children: [
              h('small', {
                children:
                  `${t('comparisonCache')} ${number(answer.usage?.cacheReadTokens)} · ${t('comparisonBytes')} ${number(answer.contextBytes)}` +
                  (answer.strategy === 'memory' ? ` · ${t('comparisonRecall')} ${number(answer.recallBytes)}` : ''),
              }),
              trace(answer.traceUrl),
            ],
          }),
          h('label', {
            className: 'pet-comparison-review',
            children: [
              t('comparisonQuality'),
              h('select', {
                'aria-label': title + ' ' + t('comparisonQuality'),
                'data-review': reviews[key] ?? 'unreviewed',
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
    const reduction = (input: number | undefined) =>
      full !== undefined && full > 0 && input !== undefined
        ? ((1 - input / full) * 100).toFixed(1) + '%'
        : t('comparisonUnknown');
    const observedInput = run ? comparisonObservedInput(run) : undefined;
    const memoryOutput = run?.memoryUsage?.generation.output;
    const observedOutput =
      memoryOutput != null && totals[1]?.output !== undefined ? memoryOutput + totals[1].output : undefined;
    const index = Math.min(selectedRound, Math.max(0, (run?.rounds.length ?? 1) - 1));
    const round = run?.rounds[index];
    const completed = run?.rounds.filter((r) => r.answers.every((a) => a.status === 'complete')).length ?? 0;
    const metric = (label: string, value: string, detail: string, positive: boolean) =>
      h('div', {
        className: 'pet-comparison-metric',
        'data-positive': positive,
        children: [h('small', { children: label }), h('strong', { children: value }), h('span', { children: detail })],
      });
    const setup = h('details', {
      className: 'pet-comparison-setup',
      open: !run,
      children: [
        h('summary', { children: t(run ? 'comparisonNewRun' : 'comparisonSetup') }),
        h('div', {
          className: 'pet-comparison-form',
          children: [
            h('label', {
              children: [
                t('comparisonCorpus'),
                h('textarea', {
                  value: corpus,
                  maxLength: 49152,
                  disabled: busy,
                  rows: 7,
                  placeholder: t('comparisonCorpusHint'),
                  onChange: (e: { target: { value: string } }) => setCorpus(e.target.value),
                }),
              ],
            }),
            h('div', {
              children: [
                h('label', {
                  children: [
                    t('comparisonQuestions'),
                    h('textarea', {
                      value: questions,
                      maxLength: 8008,
                      disabled: busy,
                      rows: 4,
                      placeholder: t('comparisonQuestionsHint'),
                      onChange: (e: { target: { value: string } }) => setQuestions(e.target.value),
                    }),
                  ],
                }),
                h('label', {
                  className: 'pet-comparison-budget',
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
              ],
            }),
          ],
        }),
        h('p', { className: 'pet-comparison-note', children: t('comparisonConsent') }),
        button(t('comparisonStart'), () => void start(), busy || !corpus.trim() || !questions.trim(), true),
      ],
    });
    return h('div', {
      className: 'pet-comparison-launch',
      children: [
        h('button', {
          type: 'button',
          ref: launchRef,
          onClick: () => setOpen(true),
          className: 'pet-comparison-launch-button',
          'aria-label': t('comparisonOpen'),
          'aria-haspopup': 'dialog',
          children: [h('span', { children: t('comparisonOpen') }), h('small', { children: 'PowerContext' })],
        }),
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
              'data-view': run ? 'results' : 'setup',
              'aria-label': t('comparisonTitle'),
              children: [
                h('header', {
                  className: 'pet-comparison-header',
                  children: [
                    h('div', {
                      className: 'pet-comparison-identity',
                      children: [
                        h('img', { src: avatarUrl(pet.assetRoot, pet.avatarVersion), alt: '', width: 44, height: 44 }),
                        h('div', {
                          children: [
                            h('small', { children: (pet.petName || t('comparisonCompanion')) + ' / PowerContext' }),
                            h('h2', { children: t('comparisonTitle') }),
                          ],
                        }),
                      ],
                    }),
                    h('div', {
                      className: 'pet-comparison-actions',
                      children: [
                        run ? button(t('comparisonExport'), exportRun) : null,
                        button(t('comparisonClose'), () => setOpen(false)),
                      ],
                    }),
                  ],
                }),
                h('div', {
                  className: 'pet-comparison-body',
                  children: [
                    h('p', { className: 'pet-comparison-intro', children: t('comparisonIntro') }),
                    error
                      ? h('p', { className: 'pet-comparison-alert', role: 'alert', children: t('comparisonError') })
                      : null,
                    !run ? setup : null,
                    run
                      ? h('div', {
                          className: 'pet-comparison-results',
                          children: [
                            h('div', {
                              className: 'pet-comparison-toolbar',
                              children: [
                                h('span', {
                                  className: 'pet-comparison-status',
                                  'data-status': run.status,
                                  role: 'status',
                                  children: status(run.status),
                                }),
                                h('span', { children: run.model.model }),
                                h('span', {
                                  children: `${t('comparisonProgress')} ${completed} / ${run.rounds.length}`,
                                }),
                                h('span', {
                                  children: `${t('comparisonReady')} ${number(run.preparation?.activeMemories)}`,
                                }),
                                busy ? button(t('comparisonStop'), () => void cancel()) : null,
                              ],
                            }),
                            h('section', {
                              className: 'pet-comparison-summary',
                              'aria-label': t('comparisonAnswerTotals'),
                              children: [
                                metric(
                                  t('comparisonReduction'),
                                  reduction(memory),
                                  `${number(full)} → ${number(memory)}`,
                                  full !== undefined && memory !== undefined && memory < full,
                                ),
                                metric(
                                  t('comparisonObservedReduction'),
                                  reduction(observedInput),
                                  `${number(full)} → ${number(observedInput)}`,
                                  full !== undefined && observedInput !== undefined && observedInput < full,
                                ),
                                metric(
                                  t('comparisonMemoryOutput'),
                                  number(observedOutput),
                                  t('comparisonOutputCaveat'),
                                  false,
                                ),
                              ],
                            }),
                            h('p', { className: 'pet-comparison-note', children: t('comparisonSummaryHint') }),
                            round
                              ? h('section', {
                                  className: 'pet-comparison-round',
                                  children: [
                                    h('div', {
                                      className: 'pet-comparison-round-heading',
                                      children: [
                                        h('h3', { children: t('comparisonAnswers') }),
                                        h('nav', {
                                          className: 'pet-comparison-question-nav',
                                          'aria-label': t('comparisonChooseQuestion'),
                                          children: run.rounds.map((r, i) =>
                                            h('button', {
                                              type: 'button',
                                              'aria-pressed': i === index,
                                              'aria-label': `${i + 1}. ${r.question}`,
                                              title: r.question,
                                              onClick: () => setSelectedRound(i),
                                              children: String(i + 1),
                                            }),
                                          ),
                                        }),
                                      ],
                                    }),
                                    h('h4', {
                                      className: 'pet-comparison-question',
                                      children: `${index + 1}. ${round.question}`,
                                    }),
                                    h('div', {
                                      className: 'pet-comparison-columns',
                                      children: round.answers
                                        .filter((a) => a.strategy !== 'short')
                                        .map((a) => answerNode(a, index)),
                                    }),
                                    h('details', {
                                      className: 'pet-comparison-control',
                                      children: [
                                        h('summary', { children: t('comparisonShort') }),
                                        answerNode(
                                          round.answers.find((a) => a.strategy === 'short')!,
                                          index,
                                        ),
                                      ],
                                    }),
                                    h('p', { className: 'pet-comparison-note', children: t('comparisonDataset') }),
                                  ],
                                })
                              : null,
                            run.status === 'complete' && run.rounds.length < 32
                              ? h('details', {
                                  className: 'pet-comparison-continue',
                                  children: [
                                    h('summary', { children: t('comparisonContinue') }),
                                    h('p', { className: 'pet-comparison-note', children: t('comparisonContinueHint') }),
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
                                      true,
                                    ),
                                  ],
                                })
                              : null,
                            h('details', {
                              className: 'pet-comparison-accounting',
                              children: [
                                h('summary', { children: t('comparisonDetails') }),
                                h('div', {
                                  className: 'pet-comparison-table-wrap',
                                  children: h('table', {
                                    children: [
                                      h('caption', { children: t('comparisonAnswerTotals') }),
                                      h('thead', {
                                        children: h('tr', {
                                          children: (
                                            [
                                              'comparisonStrategy',
                                              'comparisonInput',
                                              'comparisonOutput',
                                              'comparisonCache',
                                            ] as const
                                          ).map((key) => h('th', { scope: 'col', children: t(key) })),
                                        }),
                                      }),
                                      h('tbody', {
                                        children: totals.map((entry) =>
                                          h('tr', {
                                            children: [
                                              h('th', { scope: 'row', children: strategyTitle(entry.strategy) }),
                                              ...[entry.input, entry.output, entry.cacheRead].map((value) =>
                                                h('td', { children: number(value) }),
                                              ),
                                            ],
                                          }),
                                        ),
                                      }),
                                    ],
                                  }),
                                }),
                                h('div', {
                                  className: 'pet-comparison-columns',
                                  children: [
                                    ledger(run.preparation, t('comparisonPreparation')),
                                    ledger(run.memoryUsage, t('comparisonAccounting')),
                                  ],
                                }),
                                h('p', {
                                  className: 'pet-comparison-note',
                                  children: `${t('comparisonObserved')}: ${number(observedInput)}`,
                                }),
                                h('p', {
                                  className: 'pet-comparison-scope',
                                  children: `${t('comparisonScope')}: ${run.scopeId ?? '…'}`,
                                }),
                                trace(run.preparationTraceUrl),
                                !run.preparationTraceUrl ? h('p', { children: t('comparisonNoTrace') }) : null,
                              ],
                            }),
                            run.accountingError || !run.memoryUsage
                              ? h('p', {
                                  className: 'pet-comparison-alert',
                                  role: 'status',
                                  children: t('comparisonIncomplete'),
                                })
                              : null,
                            setup,
                          ],
                        })
                      : null,
                    h('p', {
                      className: 'pet-comparison-note pet-comparison-footnote',
                      children: t('comparisonLimit'),
                    }),
                  ],
                }),
              ],
            })
          : null,
      ],
    });
  };
}
