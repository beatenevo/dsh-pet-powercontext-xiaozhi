# Compare answers and token use in DSH

[简体中文](../../zh/guides/token-comparison.md)

This development feature requires a build containing the comparison panel. It is not included in the published `0.1.0-beta.1` package.

Open **Pet chat → Token comparison** inside DSH. The panel uses the DSH theme and current pet avatar, keeps the host sidebar and pet visible on wide desktop screens, and places two independently generated answers side by side. Standalone chat exposes the same tool.

## Prepare and run

1. Configure the pet's chat model, or select the host's current model. The experiment freezes that provider/model selection and uses identical instructions, temperature and output limits for every arm. It does not fall back to another model on failure.
2. Save a direct PowerContext Server connection in the pet memory settings. The experiment uses this connection even if normal chat uses native memory or the DSH shared-memory plugin. The companion read service stays read-only; experiments never capture into an existing pet/project scope. A server configured only inside `powercontext-dsh` is not automatically a direct pet connection.
3. Optionally [connect AI Vision](observability.md), including the Server exporter. Without it, the experiment still works, but trace links are absent.
4. Paste the original background record, then one question per line. Decide the answer requirements before running. Keep the record within **49,152 UTF-8 bytes**, use at most **eight questions**, and select a recent-context budget between **128 and 8,192 bytes**.
5. Select **Prepare memory and run**. This creates a separate persistent scope, submits the exact record as one Source, explicitly flushes one processing window, and checks for active memory before generating answers. Source acceptance alone is insufficient. It makes paid model calls.
6. Use the question numbers beside **Compare answers** to switch questions; manual review labels are retained while switching. Inspect both answers and expand the short-history control beneath each pair. Mark each answer as meeting requirements, missing/incorrect, or unreviewed. Export the JSON result before starting another run or restarting the host.

**Reuse this memory for more questions** appends another batch after completion. Each batch allows up to eight questions, with 32 in total. The same corpus, model, recall configuration and scope are retained; no second capture or preparation occurs. Cumulative input includes the preparation ledger exactly once. Repeated questions are allowed, but should be identified as reuse trials, not additional independent quality cases.

The corpus remains fixed throughout a run. Generated answers never enter later prompts or memory. Full history sends the complete supplied record; the memory arm sends its bounded UTF-8 tail plus actual recalled context; the control sends the identical tail without memory. Arm order alternates across questions to expose order/cache effects. This is a **controlled context-strategy replay**, not execution of the DSH task agent or a measurement of DSH's default compaction policy. The normal DSH plugin appends prepared context; enabling it alone does not prove token savings.

## Read the panel

The top summary shows answer input reduction, input reduction including memory overhead, and combined answer/memory generation output. Expand **Token breakdown & AI Vision** for strategy totals, preparation and cumulative ledgers, the experiment scope and preparation trace. **Export results** and **Close** stay in the header; Escape also closes the panel and returns focus to pet chat.

- **Answer input reduction** compares provider-reported input tokens for all completed pairs, including separately reported cache buckets. Incomplete answers or missing input counts prevent an aggregate reduction from being displayed.
- **Observed input including memory** adds the memory arm’s answer input, scope generation input and embedding input. It remains unknown when a required counter or completed answer is missing. It is a cross-model token-count comparison, not a bill; output is displayed separately. Negative reduction means increased input, and is retained without rounding it to zero.
- Each answer shows input/output/cache tokens, context bytes, recall bytes when applicable, duration and an optional AI Vision link. Unknown counters remain unknown; zero is shown only when reported. Manual quality labels are judgments, not automated semantic-equivalence scores.
- **One-time preparation** shows the isolated scope's initial generation and embedding ledger counters. **PowerContext overhead** shows the latest cumulative counters, including preparation and subsequent recall. These panels overlap: do not add preparation twice.
- A ledger failure, pending processing or unreported usage prevents a complete net-savings claim. Memory generation and embedding can use different models and tokenizers from the answer model. Adding their token counts is not a currency estimate. Compare cache pricing, failures, output and provider billing separately; the tool does not invent a price or break-even point.

In AI Vision, follow an answer's link to its `dsh_pet.comparison.answer` root, model call and optional recall stages. Preparation has a separate `dsh_pet.comparison.prepare` trace. Metadata adds a random experiment ID (`dsh_pet.comparison.id`), a strategy (`prepare`, `full`, `memory`, `short`) and a one-based question number (`dsh_pet.comparison.round`, zero for preparation). Prompts, answers, source records and credentials remain outside observability spans. Ingest acceptance still requires storage/UI readback before claiming end-to-end observation.

## Before a live demonstration

Validate ordinary pet chat, memory generation and recall separately before starting a comparison. A healthy Server can still have an unsupported generation protocol, unavailable model or incorrect embedding configuration. The chat provider and PowerContext inference provider are configured separately; an OpenAI-compatible address does not by itself establish support for both Chat Completions and Responses.

For custom providers, declare the model's supported reasoning modes and message roles correctly in DSH. The comparison requests reasoning off only when the model advertises that capability. A model that continues reasoning can exhaust the 1,024-token output budget before finishing an answer. Correct the provider configuration, then start a fresh run; a truncated answer remains incomplete and must not be reported as a successful saving. Do not change the provider configuration while an experiment is running.

Cold recall can exceed the configured `chatMemory.timeoutMs`. Check that setting and the Server's readiness before the run, and retain the same recall settings across strategies and reuse batches. Source synchronization, background processing and successful recall are separate checkpoints. Inspect the cumulative memory ledger after processing settles: preparation counters overlap with cumulative counters, and additional background work must not be omitted from the cost comparison.

## Limits and lifecycle

Only one experiment runs per host. Each question batch has a 15-minute deadline; preparation is bounded to four minutes and each answer to two minutes with a 1,024-token output budget. Normal memory recall uses the configured recall timeout and byte/item budgets. Truncated, failed or cancelled generations are incomplete, even if some usage was reported. Stop cancels active requests and prevents further arms; it cannot undo provider charges or already accepted Source processing. There are no automatic retries.

Results and manual reviews are local to this host/browser session; browser refresh discards manual reviews, and host restart or the next run discards the previous result. Export includes the original record and answers, so handle it as private content. The isolated PowerContext scope remains on the configured Server; its ID is shown for inspection or cleanup through the Server's supported management tools. Experiments do not delete existing scopes. They do not issue robot commands or modify the normal chat memory policy.

A single synthetic scenario is a demonstration, not a general benchmark. Include short and long histories, repeated runs and questions about missing facts before making a public savings claim.
