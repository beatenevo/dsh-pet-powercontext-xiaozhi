---
description: Animated pet package with optional PowerContext memory.
kind: package-reference
---

# dsh-pet-powercontext

English · [简体中文](README.zh.md) · [Full project guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md)

<a id="overview"></a>

## Overview

An animated desktop companion for DeepSeek Harness and standalone use: chat, configurable personality, voice, animation, reminders and optional PowerContext + seekdb long-term memory. This package adds optional PowerContext memory to the upstream desktop pet.

<a id="use"></a>

## Use this package

These instructions install **v0.2.0** explicitly. Release archives are also available from [GitHub Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0).

### Already using DSH

With DSH and **Node.js 24.9+** installed, run:

```sh
dsh plugin --profile web add dsh-pet-powercontext@0.2.0
```

For DSH desktop, replace `--profile web` with `--profile desktop`. Restart DSH, open **Settings → Pet Config**, and use **Pet chat** in the sidebar. Disable the upstream `dsh-pet` plugin first if enabled; retain its data directory.

Existing DSH installations can use the [platform-specific offline plugin package](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/offline-installation.md) to enable memory without downloading Python or its dependencies.

### Standalone on Windows, macOS or Linux

With **Node.js 22.12+**, run in PowerShell or a terminal:

```sh
npx --yes dsh-pet-powercontext@0.2.0 --setup
```

Select a chat model, enter its key and check the connection in the setup page. Keep the terminal running. The animated pet needs a desktop environment and may download Electron on first launch. Standalone mode does not require DSH.

Windows x64 uses native installation; enabling memory automatically prepares Python and seekdb. Local seekdb on Windows ARM64 is not supported. Real-service validation has completed on Linux; the full Windows x64 and macOS installation flows still require real-host validation. Check the actual [Release assets](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0) for desktop downloads.

### Configure models and enable memory

1. **Configure chat first.** The DSH pet uses the host chat model: enter the MiniMax endpoint, model and subscription key below in DSH model settings. Standalone users enter them in the app's settings.
2. **Open local long-term memory.** In DSH, open **Settings → Pet Config → Local long-term memory**, select MiniMax China and Qwen Beijing, and enter each service's key. Chat and memory extraction settings are saved separately.
3. **Click Check and enable memory.** The app checks model connections, installs PowerContext 1.5.2 and seekdb, and starts the service. The standard npm package downloads its runtime on first use; offline packages use the bundled runtime. Cloud model calls still require network access. Memory is optional.
4. **Verify recall.** Tell the pet a distinctive preference and wait for it to appear in **Remembered facts**. Clear recent chat, then ask about it again. A synced status alone does not mean extraction has completed.

| Setting                      | Value                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Chat / extraction provider   | MiniMax China subscription                                                         |
| Generation endpoint          | `https://api.minimax.cn/v1`                                                        |
| Generation model             | `MiniMax-M3.1-Flash`                                                               |
| Generation key               | Your `sk-cp-` subscription key; pay-as-you-go keys do not share subscription quota |
| Embedding provider           | Bailian: Qwen Beijing                                                              |
| Embedding endpoint           | `https://dashscope.aliyuncs.com/compatible-mode/v1`                                |
| Embedding model              | `text-embedding-v4`                                                                |
| Embedding key                | Your Bailian API key                                                               |
| Dimensions / send dimensions | `1024` / enabled                                                                   |

New setups use one local seekdb store. Existing SQLite configurations remain in place without automatic conversion. An existing store's embedding model, endpoint and dimensions cannot be switched in place. Model checks, chat, extraction and recall can incur usage charges.

### Optional AI Vision and Token comparison

AI Vision is a separate observability platform. Enter an existing platform's endpoint and credentials in observability settings, save and check the connection, then pause and resume memory to apply the configuration to the managed service. The plugin does not deploy AI Vision.

Token comparison is an auxiliary experiment for comparing answers and usage across context strategies. Include extraction and embedding overhead; short conversations do not necessarily save tokens.

[Installation](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/installation.md) · [Memory guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/memory.md) · [AI Vision](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/observability.md) · [Token comparison](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/token-comparison.md)

<a id="implementation"></a>

## Understand the implementation

| Source                                   | Responsibility                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/host/index.ts`                      | Cordis host plugin assembly: `name`, `inject`, `apply`.                             |
| `src/client/index.ts`                    | Browser plugin and UI registration, exported through `dsh-pet-powercontext/client`. |
| `src/host/plugin/chat-memory.ts`         | Local chat journal, delivery queue and prompt assembly.                             |
| `src/host/powercontext.ts`               | Bounded PowerContext capture and recall client.                                     |
| `src/host/powercontext-library.ts`       | Memory list, provenance, correction and forgetting.                                 |
| `src/standalone/memory-observability.ts` | Private managed seekdb OTLP configuration at process startup.                       |
| `src/standalone/memory-runtime.ts`       | Isolated SQLite/seekdb runtime locations and packaged server entry.                 |
| `src/standalone/managed-memory.ts`       | Local runtime, health checks and persistent service identity.                       |
| `src/host/plugin/managed-memory.ts`      | Managed memory lifecycle within DSH.                                                |
| `src/client/settings/memory-setup.ts`    | DSH memory setup and service controls.                                              |

Package exports include the host entry, `./client`, `./src/*`, `./cordis.patch.yml` and `./package.json`. The executable `dsh-pet-powercontext` starts standalone mode.

<a id="explore"></a>

## Explore further

[Features](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/FEATURES.md) · [Configuration](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/CONFIG.md) · [PowerContext](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md) · [HTTP contract](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/openapi.yaml) · [Custom pets](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/MAKE-YOUR-OWN-PET.md)

<a id="models"></a>

## Model behavior

Recent chat and retrieved memories have separate limits. Source capture is asynchronous; background model extraction produces recallable facts. Inspect and edit them in **Remembered facts**. See the [memory configuration and lifecycle guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md).

<a id="limits"></a>

## Known limits

Chat needs model credentials. Host-specific features require their DSH services. Memory captures pet dialogue, not DSH coding-agent sessions. Memory extraction is not immediate or guaranteed, and forgetting does not physically erase sources or local chat. Model providers receive the text needed for generation and embeddings. Character assets have non-commercial licensing restrictions; code is MIT. See the [full licensing and credits](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md#credits-and-licensing).

<a id="development"></a>

## Development notes

Use `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:cycles`, `pnpm check:runtime`, `pnpm check:openapi`, `pnpm test`, `pnpm test:ui` and `pnpm build` before delivery.

See the [release instructions](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/en/guides/releases.md) for workflow setup. Artwork terms and credits ship in [ASSET-LICENSE.md](ASSET-LICENSE.md).

## Local API access settings

**DSH plugin:** open **Settings → Pet Config → API access token**, enter a 43-character token using letters, digits, underscores or hyphens, and save. External clients send it in `X-DSH-Pet-Token`. The new token takes effect immediately and invalidates the old token. It is stored privately in `dsh-pet/interface-access-token.json`, survives restarts, and is not echoed by settings. Only an authenticated DSH session can change it; DSH login credentials and internal IPC are unaffected.

Select a pet on the same page and save an **API Pet ID** alias. Default and custom characters are supported. Leave it empty to use the internal ID; chat history and memory remain in place.

**Standalone:** open **Settings → API access token**, enter a random token with the same format, and save. The server, desktop requests and current settings page switch immediately. Update external clients and reopen other settings pages from the pet menu. The token is stored privately in `dsh-pet/access-token.json`; without a saved value, each launch generates a new token. Saved values are not echoed.

**Settings → Configuration → API Pet ID** sets the external `?pet=` alias, such as `demo-fish`. Changing it preserves history, assets and the PowerContext scope. Desktop requests may continue using the internal ID, and response status keys retain that ID. Aliases must not conflict with another instance's ID or alias. Clearing an alias restores the internal ID without moving or deleting data.

| Source                               | Responsibility                                                    |
| ------------------------------------ | ----------------------------------------------------------------- |
| `src/standalone/access-token.ts`     | Authenticated token rotation and current settings cookie refresh. |
| `src/standalone/request-security.ts` | Private token loading, validation and immediate switching.        |
| `src/host/config/api-id.ts`          | External Pet ID resolution and cross-instance conflict checks.    |
