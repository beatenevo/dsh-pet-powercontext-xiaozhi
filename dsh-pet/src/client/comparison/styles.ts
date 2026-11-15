/** Scoped styles reuse the host theme and keep DSH visible around the comparison dialog. */
export const COMPARISON_CSS = `
.pet-comparison-launch { flex: none; padding: 4px 0; }
.pet-comparison { box-sizing: border-box; margin: 0; width: 84vw; height: 90vh; max-width: none; max-height: none; position: fixed; inset: 5vh 12vw 5vh 4vw; z-index: 500; overflow: auto; padding: 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-module-platform, white); color: var(--dsw-alias-label-primary); box-shadow: 0 16px 64px #0003; font-size: 14px; line-height: 1.6; text-align: left; }
.pet-comparison::backdrop { background: #0002; }
.pet-comparison header, .pet-comparison-toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.pet-comparison header { justify-content: space-between; }
.pet-comparison h2, .pet-comparison h3 { margin: 4px 0 12px; }
.pet-comparison p { margin: 8px 0; }
.pet-comparison label { display: block; margin: 10px 0; }
.pet-comparison textarea { display: block; box-sizing: border-box; width: 100%; font: inherit; }
.pet-comparison input, .pet-comparison select { margin-left: 12px; font: inherit; }
.pet-comparison button { cursor: pointer; padding: 6px 12px; font: inherit; }
.pet-comparison button:disabled { cursor: default; opacity: .5; }
.pet-comparison summary { cursor: pointer; padding: 8px 0; }
.pet-comparison-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.pet-comparison-answer, .pet-comparison-ledger, .pet-comparison-summary { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 16px; margin: 8px 0; }
.pet-comparison-answer-text { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 90px; }
.pet-comparison small { display: block; color: var(--dsw-alias-label-secondary); }
.pet-comparison-tokens { font-weight: 600; font-variant-numeric: tabular-nums; }
.pet-comparison-tokens small { font-weight: normal; }
.pet-comparison-note { color: var(--dsw-alias-label-secondary); }
.pet-comparison-round { margin: 24px 0; }
@media (max-width: 650px) { .pet-comparison { inset: 2vh 2vw; width: 96vw; height: 96vh; padding: 12px; } .pet-comparison-columns { grid-template-columns: 1fr; } }
`;
