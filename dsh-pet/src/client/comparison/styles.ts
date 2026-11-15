/** Host theme tokens keep the comparison surface consistent with DSH and standalone pet chat. */
export const COMPARISON_CSS = `
.pet-comparison-launch { flex: none; }
.pet-comparison-launch-button { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font: inherit; cursor: pointer; }
.pet-comparison-launch-button small { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pet-comparison-launch-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pet-comparison { --pc-surface: var(--dsw-alias-bg-layer-2, white); --pc-muted: var(--dsw-alias-label-secondary, #61666b); --pc-accent: var(--dsw-alias-state-business-primary, #3b82f6); box-sizing: border-box; margin: 0; width: calc(100vw - 440px); height: calc(100dvh - 170px); max-width: none; max-height: none; position: fixed; inset: 66px auto auto 280px; padding: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg, 16px); background: var(--pc-surface); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-prominent, 0 12px 48px #0002); font: 14px/1.6 var(--dsw-font-family, sans-serif); text-align: left; }
.pet-comparison[data-view=setup] { height: auto; max-height: calc(100dvh - 96px); }
.pet-comparison[open] { display: flex; flex-direction: column; }
.pet-comparison::backdrop { background: #0000000a; }
.pet-comparison *, .pet-comparison *::before, .pet-comparison *::after { box-sizing: border-box; }
.pet-comparison-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex: none; padding: 18px 24px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.pet-comparison-identity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pet-comparison-identity img { object-fit: contain; border-radius: var(--dsw-radius-sm, 8px); flex: none; }
.pet-comparison h2 { font-size: 19px; font-weight: 600; letter-spacing: -.4px; line-height: 1.4; margin: 2px 0 0; }
.pet-comparison h3 { font-size: 14px; font-weight: 600; margin: 0; }
.pet-comparison p { margin: 0; }
.pet-comparison small { color: var(--pc-muted); font-size: 12px; }
.pet-comparison-actions, .pet-comparison-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.pet-comparison-actions { flex-shrink: 0; }
.pet-comparison-body { overflow: auto; overscroll-behavior: contain; min-height: 0; padding: 20px 24px 24px; scrollbar-gutter: stable; }
.pet-comparison-intro { color: var(--pc-muted); font-size: 13px; margin-bottom: 16px !important; max-width: 90ch; }
.pet-comparison button { min-height: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px); padding: 5px 12px; background: var(--pc-surface); color: inherit; font: inherit; font-weight: 500; cursor: pointer; }
.pet-comparison button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pet-comparison button:disabled { opacity: .5; cursor: default; }
.pet-comparison button.pet-comparison-primary { background: var(--pc-accent); color: var(--dsw-alias-label-primary-foreground, white); border-color: transparent; margin-top: 12px; }
.pet-comparison :is(button, select, input, textarea, summary, a):focus-visible, .pet-comparison-launch-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6); outline-offset: 3px; }
.pet-comparison a { color: var(--pc-accent); text-decoration: none; font-size: 12px; }
.pet-comparison a:hover { text-decoration: underline; }
.pet-comparison label { display: block; font-size: 13px; color: var(--pc-muted); }
.pet-comparison :is(textarea, input, select) { font: inherit; color: var(--dsw-alias-label-primary); background: var(--pc-surface); border: 1px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2)); border-radius: var(--dsw-radius-sm, 8px); padding: 8px 10px; min-height: 34px; }
.pet-comparison textarea { display: block; resize: vertical; width: 100%; margin: 8px 0; }
.pet-comparison textarea::placeholder { color: var(--pc-muted); opacity: .8; }
.pet-comparison input { width: 100px; }
.pet-comparison summary { cursor: pointer; font-size: 12px; font-weight: 500; padding: 12px 0; }
.pet-comparison details { border-top: 1px solid var(--dsw-alias-border-l2); }
.pet-comparison details[open] { padding-bottom: 16px; }
.pet-comparison-form, .pet-comparison-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.pet-comparison-form { margin: 6px 0 12px; }
.pet-comparison label.pet-comparison-budget { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
.pet-comparison-toolbar { color: var(--pc-muted); font-size: 12px; gap: 12px 20px; margin-bottom: 16px; }
.pet-comparison-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--pc-muted); white-space: nowrap; }
.pet-comparison-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pet-comparison-status[data-status=running], .pet-comparison-status[data-status=preparing] { color: var(--pc-accent); }
.pet-comparison-status[data-status=failed] { color: var(--dsw-alias-state-error-primary); }
.pet-comparison-summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; padding: 20px 22px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 12px); background: var(--dsw-alias-bg-base); margin-bottom: 10px; }
.pet-comparison-metric { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; font-variant-numeric: tabular-nums; }
.pet-comparison-metric + .pet-comparison-metric { border-left: 1px solid var(--dsw-alias-border-l2); padding-left: 22px; }
.pet-comparison-metric strong { font-size: clamp(24px, 2.6vw, 38px); font-weight: 600; line-height: 1.4; letter-spacing: -1px; }
.pet-comparison-metric[data-positive=true] strong { color: var(--pc-accent); }
.pet-comparison-metric span { font-size: 12px; color: var(--pc-muted); }
.pet-comparison-note { color: var(--pc-muted); font-size: 12px; line-height: 1.7; }
.pet-comparison-round { margin: 24px 0 12px; }
.pet-comparison-round-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.pet-comparison-question-nav { display: flex; flex-wrap: wrap; gap: 5px; }
.pet-comparison-question-nav button { padding: 3px 8px; min-width: 30px; min-height: 30px; font-size: 12px; border-color: transparent; color: var(--pc-muted); }
.pet-comparison-question-nav button[aria-pressed=true] { background: var(--dsw-alias-bg-multi-select); border-color: var(--dsw-alias-border-l2); color: var(--pc-accent); }
.pet-comparison-question { margin: 0 0 14px; padding: 12px 14px; border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-bg-module-platform); font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.pet-comparison-answer { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 12px); overflow: hidden; }
.pet-comparison-answer[data-strategy=memory] { border-color: color-mix(in srgb, var(--pc-accent) 40%, var(--dsw-alias-border-l2)); }
.pet-comparison-answer-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 14px 16px 10px; }
.pet-comparison-answer[data-strategy=memory] .pet-comparison-answer-heading { background: var(--dsw-alias-bg-multi-select); }
.pet-comparison-tokens { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 10px; padding: 12px 16px; font-variant-numeric: tabular-nums; }
.pet-comparison-tokens small, .pet-comparison-tokens strong { display: block; }
.pet-comparison-tokens strong { font-size: 17px; font-weight: 500; margin-top: 2px; }
.pet-comparison-answer-text { white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px; flex: 1; min-height: 116px; font-size: 14px; line-height: 1.85; border-top: 1px solid var(--dsw-alias-border-l2); }
.pet-comparison-answer-meta { padding: 0 16px 12px; display: grid; gap: 6px; }
.pet-comparison label.pet-comparison-review { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
.pet-comparison-review select { padding: 4px 8px; font-size: 12px; min-height: 30px; max-width: 100%; }
.pet-comparison-review select[data-review=pass] { color: var(--pc-accent); }
.pet-comparison-review select[data-review=fail] { color: var(--dsw-alias-state-error-primary); }
.pet-comparison-control { margin-top: 10px; border-top: 0 !important; }
.pet-comparison-table-wrap { overflow-x: auto; }
.pet-comparison table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; margin-bottom: 16px; }
.pet-comparison caption { text-align: left; font-weight: 600; padding-bottom: 10px; }
.pet-comparison :is(th, td) { text-align: right; padding: 9px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; }
.pet-comparison th:first-child { text-align: left; }
.pet-comparison th { font-weight: 500; color: var(--pc-muted); }
.pet-comparison-ledger { padding: 14px; border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-bg-base); }
.pet-comparison-ledger h3 { font-size: 12px; margin-bottom: 10px; }
.pet-comparison-ledger-row { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; font-size: 12px; color: var(--pc-muted); padding: 8px 0; }
.pet-comparison-ledger-row strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.pet-comparison-scope { overflow-wrap: anywhere; font-size: 12px; color: var(--pc-muted); margin: 10px 0 !important; }
.pet-comparison-alert { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 12px 0 !important; }
.pet-comparison-footnote { padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
@media (max-width: 1399px) { .pet-comparison { left: 24px; width: calc(100vw - 144px); } }
@media (max-width: 850px) { .pet-comparison { inset: 12px; width: calc(100vw - 24px); height: calc(100dvh - 24px); } .pet-comparison-header, .pet-comparison-body { padding: 16px; } .pet-comparison-summary { gap: 12px; padding: 16px; } .pet-comparison-metric + .pet-comparison-metric { padding-left: 12px; } }
@media (max-width: 600px) { .pet-comparison-header { gap: 10px; flex-wrap: wrap; } .pet-comparison h2 { font-size: 17px; } .pet-comparison-actions { margin-left: auto; } .pet-comparison-columns, .pet-comparison-form { grid-template-columns: 1fr; } .pet-comparison-summary { grid-template-columns: 1fr 1fr; } .pet-comparison-metric:last-child { grid-column: 1 / -1; padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); } .pet-comparison-metric:last-child strong { font-size: 24px; } .pet-comparison-answer-text { min-height: 80px; } }
`;
