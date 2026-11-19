# Observe the pet and PowerContext with AI Vision

[简体中文](../../zh/guides/observability.md)

This guide describes the current source build. Content capture, background filtering and same-trace memory delivery require a build containing these changes. Observation is optional; disabling it, missing credentials or an unavailable collector must not prevent chat, memory fallback, voice or existing robot controls.

## Connect

1. Deploy [AI Vision](https://github.com/ob-labs/ai-vision-ob) with its SigNoz data source. Native PowerContext views require the matching SigNoz `/api/v1/ai-vision/memory/operations` capability and preservation of instrumentation scope. A Langfuse SDK-compatible ingest endpoint is supported; the Langfuse storage data source does not provide this native scan.
2. Create an Agent in your AI Vision space and configure its SigNoz data source. Obtain the **Agent UUID**, **Space UUID** and **SpaceKey** from the platform. These are not model API credentials.
3. In DSH, open the pet settings and find **AI Vision observability**. In standalone mode, open the local settings window and choose **AI Vision**.
4. Enter the platform base URL, Agent UUID, Space UUID and SpaceKey, enable observation, then select **Save observation settings**. HTTPS is the default; loopback HTTP is allowed. For a trusted private HTTP deployment, explicitly enable the HTTP option. URLs must not contain credentials, query strings or fragments.
5. Select **Test trace export**. Acceptance means the authenticated ingest endpoint accepted an OTLP request. Open the resulting interaction to confirm that the platform stored and can query it; a successful upload alone does not prove that.

The key is write-only, stored in `observability.json` under the pet's private data directory, outside the npm installation. GET `/config` and observation status do not return it. Leave the key field blank to retain it for the same destination, Agent and space. Changing any of these requires entering a key again. To remove it, disable observation, select **Delete saved key**, then save. The browser links require normal AI Vision login and carry no credentials.

## Include PowerContext Server operations

The pet emits its own operation spans and passes a W3C `traceparent` to PowerContext. To see the Server's native preparation and search stages, the Server must also export traces to the same AI Vision Agent/data source. Install PowerContext's `tracing-otlp` extra and configure its launch environment:

```dotenv
POWERCONTEXT_SERVER_TRACING_ENABLED=true
OTEL_TRACES_SAMPLER=parentbased_always_off
OTEL_SERVICE_NAME=powercontext-server
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://vision.example/api/public/otel/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic%20BASE64_OF_AGENT_UUID_COLON_SPACE_KEY
```

Replace the example URL and encode `AgentUUID:SpaceKey` as base64 locally. Keep the result in the Server's private environment, not in a repository or chat. `%20` encodes the space in the OTel header environment format. Restart the Server with this environment. Installing the pet does not alter an independently managed Server's exporter configuration. This endpoint accepts traces; do not send logs or metrics to it. Prometheus `/metrics` and operational logs need their own collection setup.

- **Private PowerContext:** recall HTTP calls carry the current pet span's parent. Accepted dialogue Sources retain only a local causal reference for later background delivery; the trace reference is not included in the Source content.
- **DSH shared PowerContext:** install a `powercontext-dsh` build supporting the optional `traceContext` field of `powercontext.companion-memory.v1`. It reuses the existing authenticated client and forwards the parent to `prepare_context`. Old plugins may ignore the field, so recall can still work while the Server trace is separate. Workspace-binding requests are not joined by this extension. Shared mode remains read-only and does not capture pet dialogue into the project.
- **Native memory:** no PowerContext Server trace is expected. The existing provider behavior remains in place.

Managed memory reads observation settings at startup: pause and resume memory after saving. By default, sampled parent requests retain their Server and SQL spans, while unparented health checks, memory management and background jobs create no standalone traces. Enable **Include background and maintenance traces** and restart memory to inspect those operations. Keep server tracing enabled to retain SQL instrumentation. Configure the sampler above yourself for an external Server.

## Demonstrate with real interactions

Keep the actual DSH conversation and pet visible alongside AI Vision. Send one message to the pet, then open **Recent interactions → View interaction**. The chat trace includes its recall and model attempts; automatic reply/whisper synthesis joins the originating interaction while its recent host identity remains available. Manual voice requests and robot command execution have separate traces. No robot action is triggered by observation.

For private memory, **memory.capture** retains the originating chat Trace ID and parent span after the reply completes. Submission does not block the reply. The trace time range may extend through delivery; the chat span still measures reply latency. Older pending records without a trace reference do not create background roots by default. Confirm Source acceptance separately from later extraction and recall. Use **Open Memory Observability** for the existing native memory views. There is no fabricated memory count, completion percentage or token-saving percentage.

The panel retains the latest 30 root interactions in process memory and displays ten. Random conversation identities group turns for the same pet and DSH session during the process lifetime; they reset on restart or configuration changes. Raw local partition keys, workspace paths and session names are not exported. The panel is a recent-activity aid, not a durable audit history.

## Interpret the evidence

| Observation                    | Meaning and limit                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat and model attempts        | Measured operation duration and success/failure; recovered model attempts remain separate.                                                                                                                                                                                             |
| Token usage                    | Provider-reported counts only. DSH uncached input and cache read/write buckets are combined once for GenAI input. Missing counts remain unknown; counts are not a bill. The adapter preserves existing request parameters, so providers that omit streamed usage have no token counts. |
| Recall ready/empty/unavailable | The actual pet boundary outcome. Search hit evidence comes from PowerContext's reported search stage, not from guessing from response length.                                                                                                                                          |
| Capture accepted               | Source submission succeeded, not memory extraction or publication. Background consolidation is outside AI Vision's initial native-memory adapter.                                                                                                                                      |
| Voice                          | Synthesis/recognition result, not proof that a person heard playback.                                                                                                                                                                                                                  |
| Robot                          | The SDK worker returned a result, not proof of physical movement or completion.                                                                                                                                                                                                        |
| Ingest accepted                | The endpoint acknowledged export; storage and UI readback require separate verification.                                                                                                                                                                                               |

AI Vision is off by default. For new configurations, **Send current input and reply to AI Vision** is preselected; uncheck it before enabling or turn it off later. Once enabled and saved, it exports current user text and final replies as `gen_ai.input.messages` / `gen_ai.output.messages`. Each message is limited to 4,000 characters; truncation sets `dsh_pet.content.truncated`. This supports preview and message steps for future calls, without backfilling historical traces. Disabling capture does not delete already exported content. These messages may contain private information. Saved choices survive upgrades and disabling/re-enabling observation. Legacy configurations without this field keep capture off.

Full system prompts, assembled history, retrieved memory, audio, images, connection credentials and raw exceptions remain excluded. Direct pet chat does not invent tool interactions. Comparison prepare and strategy answer traces retain experiment, strategy and round attributes. Missing extraction, embedding or generation usage stays unknown; chat token subtotals are not total cost.

The exporter uses a private OTel provider, a queue of at most 256 spans, batches of at most 64 and bounded export deadlines. It does not register a global provider or replace `observ-dsh`; that plugin continues to own DSH task/session observation. The npm package includes JavaScript exporter dependencies and an optional Python server entrypoint, but no AI Vision, SigNoz, Python interpreter or PowerContext installation. The pet does not automatically start a second Server.

For side-by-side answers and measured usage, see [Token comparison in DSH](token-comparison.md).

[Deploy and verify the real seekdb SQL chain](seekdb-tracing.md).
