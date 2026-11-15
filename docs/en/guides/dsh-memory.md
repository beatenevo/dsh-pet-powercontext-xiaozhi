# Share memory with the PowerContext DSH plugin

English · [简体中文](../../zh/guides/dsh-memory.md) · [Documentation](../README.md)

The pet works without PowerContext. Keep **Native recent history** selected to use ordinary pet chat, voice, animations and robot controls with your existing model configuration.

## Choose a memory mode

| Mode                            | Connection and Scope                                                | What the pet writes                                   |
| ------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Native recent history (default) | No PowerContext connection required                                 | Local pet conversation                                |
| PowerContext                    | Pet-managed or separately configured server; private Scope per pet  | Local conversation and completed exchanges as Sources |
| Use the DSH PowerContext plugin | Running DSH plugin connection; active DSH session workspace binding | Local conversation only; project memory is read-only  |

Shared mode requires both this pet build and a `powercontext-dsh` build exposing the versioned `powercontextCompanionMemory` service (`powercontext.companion-memory.v1`). An older plugin remains usable by DSH but cannot supply this feature; the pet shows a recovery message and continues ordinary chat. Enabling the option does not install or enable the host plugin automatically.

## Enable project recall

1. Install and enable PowerContext's DSH plugin, and check its connection in the PowerContext sidebar or `/pc doctor`.
2. Open a DSH session for your project. The host reads that session's actual working directory; the browser sends only its session ID.
3. Associate the workspace with an existing PowerContext Scope as described below. For a single project, the DSH plugin's explicit `POWERCONTEXT_DSH_SCOPE_ID` setting also works. An explicit override applies to every workspace in that host: remove it when you want independent workspace bindings.
4. Open **Settings → Pet Config → AI Model and Dialogue Context → Long-term memory**, select **Use the DSH PowerContext plugin**, and save.
5. Open **Pet chat**. The memory indicator shows the project name, resolved Scope and last recall result. Ask about a fact already stored as a Memory in that Scope. The current question drives bounded recall; the result enters the pet reply as historical evidence.

No second URL or token is needed. Credentials, transport policy and Scope resolution remain inside the running DSH plugin. Shared mode does not start another PowerContext process. The separate local-memory setup controls are disabled while it is selected. If a pet-managed service was already running, it remains running until paused or the host exits; its database is preserved.

### Bind a workspace

Use PowerContext's `set_scope_binding` API/tool with an existing Scope. The key is `integration: dsh`, `kind: workspace`, and `external_id` is SHA-256 of the host's absolute session working directory. In a terminal **on the DSH host**, change into that directory and obtain the key:

```sh
node --input-type=module -e 'import {createHash} from "node:crypto"; import {resolve} from "node:path"; console.log(createHash("sha256").update(resolve(process.cwd())).digest("hex"))'
```

The `PUT /v1/scope-bindings` request body is:

```json
{
  "key": {
    "integration": "dsh",
    "kind": "workspace",
    "external_id": "<hash from the command>"
  },
  "scope_id": "<existing project Scope ID>"
}
```

Use the Server's normal authentication. Do not put credentials in pet configuration. The pet does not create a Scope or choose the Server default on your behalf. Bind different projects to different Scopes when you need isolated long-term memory. If you deliberately bind them to one Scope, they share that Scope's memory.

## What is shared

The DSH plugin owns its existing conversation capture and extraction pipeline. The pet reads the active project's **Memory** family. It does not collect DSH conversations again, upload pet chat into the coding project's Scope, merge private pet memory, or automatically search parent/user/other-project Scopes. Profiles and additional memory families are outside this first integration.

Recent pet history is partitioned by connection identity, workspace and Scope. Switching projects selects the matching local history; switching to native/private mode restores that mode's history. Existing records and private pending delivery queues are retained. Deleting all pet history still clears every local partition; it does not delete remote project memory. Project memory management remains in PowerContext, so **Remembered facts** is hidden in shared mode.

## Unavailable memory never disables the pet

| Indicator                      | Action                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Plugin missing/incompatible    | Install or update the DSH PowerContext plugin, enable it, and reload the host |
| Open a project session         | Open one project in DSH's main view                                           |
| Scope unavailable              | Check the workspace binding or explicit Scope override                        |
| Connection unavailable/timeout | Repair the DSH plugin connection; the next question retries recall            |
| No relevant memory             | Connection worked, but this question found no Memory                          |

When the project cannot be resolved, the pet answers with its normal persona and current message, without previous project history. Fallback exchanges are saved locally. The selected chat model is still required, as in native mode. Standalone mode has no DSH host service and falls back the same way; select native or independent PowerContext there.

This integration is independent of Astra Pro 2.0 connectivity. It grants no additional robot permissions or automatic physical actions.

DSH pet HTTP reads and writes require the host login token/cookie. Open the normal authenticated DSH URL; unauthenticated requests receive 401. Standalone keeps its own authentication, and the desktop helper keeps its IPC connection.
