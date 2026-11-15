# Cordis services

English · [简体中文](../../zh/reference/cordis.md) · [Documentation](../README.md)

`ctx.get('petApi7340')` resolves a service in the current container. The browser service and host service have the same name but different members; they are not visible across containers. Use the [HTTP API](http-api.md) to control speech bubbles, animations, movement and configuration.

## Browser service

| Method              | Return value and behavior                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `pose(petId)`       | `{ x, y, facing }` or `null` if absent from this page; center coordinates are normalized to the viewport |
| `progress(petId)`   | `{ playbackId, anim, currentTime, duration, paused, buffering }` or `null`; times are seconds            |
| `getState()`        | Latest `PollState` snapshot, or `null` before the first poll                                             |
| `menuEvents(owner)` | `{ ok: true, events }`, or `{ ok: false, reason: 'unknown-owner' }`                                      |

A native automatic animation has a null `playbackId`; a requested animation can be followed through its receipt. `duration` is zero before metadata is available. `paused` also becomes true after playback ends; buffering means insufficient ready data or a seek in progress.

`getState()` returns a read-only snapshot reference. Each poll replaces the snapshot; do not mutate it. State leaves use `{ counter, data }`, and a changed counter signals an update. This is page-local memory and makes no network request itself.

`menuEvents()` consumes clicks: every visible label maps to the last clicked pet ID or null, then its flags are cleared. Consecutive clicks on the same label retain only the most recent. Owners with no visible items on this page return `unknown-owner`.

```js
const api = ctx.get("petApi7340");
const pose = api.pose("main");
const state = api.getState();
if (state) console.log(state.counter, state.pets.main?.say?.data);
```

## Host service

The host service exposes `balance`, `voice`, `speech` and `memory`. Each group offers `register(definition)` and `list()`. Balance and memory lists contain `{ builtin, external }` IDs; voice and speech return provider catalogs. Registration returns a disposer; collect it with the plugin lifecycle:

```js
export const inject = ["petApi7340"];

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.get("petApi7340").balance.register({
        id: "my-gateway",
        async fetch({ provider }) {
          const response = await fetch("http://127.0.0.1:8080/v1/credits", {
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error("Credit request failed");
          const credit = await response.json();
          return {
            ok: true,
            provider,
            shape: "points",
            data: {
              unit: "credits",
              total: String(credit.remaining),
              full: String(credit.limit),
            },
          };
        },
      }),
    "my-gateway.balance",
  );
}
```

## Balance providers

`balance.register({ id, fetch })` requires a nonempty unique ID and function. Built-in IDs and IDs owned by another external registration cannot be replaced. `fetch` receives `{ provider }`; credential resolution remains the integration's responsibility. It returns a successful result or throws; host diagnostics normalize thrown failures. The host does not add a timeout or retries around your fetch, so bound your own request.

| `shape`   | `data`                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------- |
| `windows` | `monthly`, optional `rolling` / `weekly`, capacities/reset times and optional rolling label        |
| `money`   | `wallets` with currency, total, granted, topped-up and optional full-balance fields; optional tier |
| `points`  | `unit`, `total`, optional `full`                                                                   |
| `custom`  | `views: CustomNode[]`, or `rows` plus optional `detailRows`; optional used `percent`               |

Custom `views` take precedence and support at most four pages. `rows`/`detailRows` form one or two pages. Click a multi-page bubble to cycle. `percent` drives usage-band animations, clamped to 0–100; missing/non-finite values do not trigger a band.

Custom nodes accept `div`, `span`, `i`, `b`, `strong`, `em` or `img`, with `text`, `children`, allowlisted camelCase `style` and HTTP(S) `src` for images. Limits are depth 6, 200 total nodes, 24 children per node, 120 characters per text fragment, 64 characters per style value and 512 characters per image URL. Oversized text is truncated; invalid styles are dropped. An invalid page invalidates the custom result rather than partially rendering it.

See the [probe plugin](../../../tools/cordis-probe/README.md) for built-in-shape and custom-page examples.

## Speech synthesis

`voice.register({ id, name, voices, synthesize, format?, timeoutMs? })` registers a unique provider. Multiple providers coexist; duplicate IDs are rejected. Each voice declares `{ id, name, tag? }` within its provider. Registration returns a disposer that removes only its own registration.

`voice.list()` returns `{ providers: [{ id, name, voices }] }`, with each voice ID qualified as `provider/voice`. Select one through `main.voiceName` or the HTTP request's `voice`. Unknown selections return `bad-request`; there is no implicit fallback.

`synthesize({ text, voice, rate, signal })` receives the provider-local voice ID and numeric rate, and returns audio bytes as `Uint8Array`. `format` is `mp3` by default or `wav`; the response Content-Type matches it. The default timeout is 15 seconds, overridable by a validated `timeoutMs`. Empty bytes, exceptions and timeouts fail. Honor the abort signal. `voiceEnabled` controls playback, not provider registration.

## Speech recognition

`speech.register({ id, name, transcribe, timeoutMs? })` also registers a unique provider without replacing others. `speech.list()` returns `{ providers: [{ id, name }] }`. Select an ID through `main.speechProvider` or the request's `provider`; unknown selections fail explicitly.

`transcribe({ audio, signal })` receives raw PCM16 mono 16 kHz WAV bytes and returns text. Empty text is a successful no-speech result. The default timeout is 30 seconds, overridable by the provider. Recognition honors client cancellation, has no cache and does not switch providers after a failure. Built-in registrations include DSH and DeepSeek; missing host capability or credentials returns `unsupported`.

## Memory providers

`memory.register({ id, recall?, capture? })` requires at least one hook and reserves the ID `native`. It is a single active slot with ownership-aware disposal.

- `recall({ petId, system, history, userText })` may return replacements for `system`, `history` or `userText`; omitted fields remain unchanged. History entries contain `role`, `content` and `ts`. Undefined, failure or timeout leaves the original content available for the reply.
- `capture({ petId, userText, replyText, action?, image?, ts })` runs after local persistence. It receives names/references, not image bodies. The reply does not wait for it; failures are logged.

When a pet explicitly selects independent or DSH-shared PowerContext, the built-in PowerContext path owns recall/capture and bypasses this external slot. Switching to native mode permits registered hooks again. See the source [provider contract](../../../dsh-pet/src/host/chat-memory-provider.ts) for types.
