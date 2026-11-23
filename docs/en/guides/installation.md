# Install dsh-pet-powercontext

English · [简体中文](../../zh/guides/installation.md) · [Documentation](../README.md)

These commands install **v0.2.0** explicitly. Release archives are also available from [GitHub Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0). See the [README](../../../README.md) for MiniMax subscription and Bailian model settings.

## Add the plugin to DSH

Use this option if you already have DeepSeek Harness. The plugin has been tested with DSH **0.2.2-rc.1**; its CLI needs Node.js **24.9+**.

If you have the upstream `dsh-pet` plugin enabled, disable it first. Both packages use the same routes, commands and `$DSH_HOME/dsh-pet/` data directory. Keep that directory to retain configuration and memories.

Run the command for **your DSH profile**:

```sh
# DSH browser profile
dsh plugin --profile web add dsh-pet-powercontext@0.2.0
```

For the DSH desktop app, use this command instead:

```sh
dsh plugin --profile desktop add dsh-pet-powercontext@0.2.0
```

Restart DSH, open **Settings → Pet Config**, then select **Pet chat** in the right sidebar. Chat uses your configured DSH model.

## Windows desktop downloads

Use the standalone command below in PowerShell, or check the [v0.2.0 Release assets](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0) for a desktop package for your platform. When a ZIP is available, extract the entire archive before launching the app. Do not use an older release ZIP to try v0.2.0 features.

## Start standalone with one command

Install Node.js **22.12+** if needed, then run the following command from any folder:

```sh
npx --yes dsh-pet-powercontext@0.2.0 --setup
```

The first launch downloads the package and, for graphical pets, may download Electron. In the setup page that opens, choose a provider, enter your API key, select a model and check the connection. Keep the terminal running while using the pet; press **Ctrl+C** to stop it. Run the same command next time.

If no browser opens, read `settingsUrl` from `$DSH_HOME/dsh-pet/standalone-runtime.json` on the host machine (`DSH_HOME` defaults to `~/.dsh`). Open that URL locally; it contains a private access token and should not be shared.

Graphical pets need a desktop session. Headless machines can use the standalone web settings and chat pages.

## Enable memory when you need it

Chat works without PowerContext. In DSH, open **Settings → Pet Config → Local long-term memory**; in standalone mode, enable memory in the setup page. The setup automatically prepares Python, PowerContext 1.5.2 and a single seekdb database in your user directory. The Windows ZIP does not include an installed PowerContext service.

Windows x64 uses native installation. Linux has real-service validation; Windows x64 and macOS still require full real-host validation. Windows ARM64 local seekdb is unsupported. Follow [Your first pet](../tutorials/first-pet.md) for the illustrated walkthrough or [memory setup](memory.md) for configuration and verification.

## Update and remove

- **DSH:** run the same `add` command for your profile, then restart DSH.
- **Standalone command:** stop the process and replace `@0.2.0` with the desired release version and run the `npx` command again.
- **Windows ZIP:** exit the app, download the desired version from [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases), and extract it to a new folder. Keep the complete folder together.

Stop a standalone process before having DSH manage the same memory directory. To remove the DSH plugin, run:

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

Use `--profile desktop` if that is where you installed it. Removing the plugin and deleting your data are separate actions. Keep the user data directory unless you intend to remove configuration and memories. See [memory controls](memory.md#deletion-and-disabling).

To change the code, see the [development guide](../reference/development.md).

## Download mirrors

The standard package downloads the pinned uv `0.9.26` platform wheel directly from the Tsinghua PyPI mirror by default, without environment configuration or a preliminary GitHub request. The wheel contains a standalone uv executable, which Node extracts without requiring Python, pip or tar. Download failures do not automatically fall back to GitHub.

Managed Python and Python dependencies retain their existing upstream defaults and can be configured separately below. Changing the dependency index does not change the uv bootstrap URL.

| Environment variable           | Meaning                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DSH_PET_UV_DOWNLOAD_BASE_URL` | uv release root, with `/0.9.26/<platform-archive>` appended. An explicit value overrides the default Tsinghua wheel with a Release archive from this root. |
| `UV_PYTHON_INSTALL_MIRROR`     | CPython mirror root preserving the date/file layout under upstream `python-build-standalone/releases/download`.                                            |
| `UV_DEFAULT_INDEX`             | Full Python simple-index URL, e.g. `https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple`.                                                                 |
| `UV_INDEX_URL`                 | Legacy uv index variable; `UV_DEFAULT_INDEX` takes precedence when both are set.                                                                           |

URLs must use HTTPS without credentials, query parameters or fragments. uv artifacts require a pinned SHA256 digest before extraction: default wheel digests come from the official PyPI release metadata, while custom Release archives retain their existing digests. Downloads use a 30-second connection timeout, a 300-second per-attempt limit and at most two transient-error retries, subject to the existing 10-minute command deadline and cancellation. Python and dependency downloads retain uv's own retry behavior.

PowerShell (accelerates Python dependencies only):

```powershell
$env:UV_DEFAULT_INDEX = 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple'
```

macOS/Linux:

```sh
export UV_DEFAULT_INDEX='https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple'
```

Fully quit DSH/the standalone app, launch a version containing this feature from the same terminal, and retry setup. A desktop shortcut does not inherit another terminal's temporary variables. Alternatively, configure OS user environment variables and sign in again before launching.

uv already uses the Tsinghua mirror by default, so `DSH_PET_UV_DOWNLOAD_BASE_URL` is optional. To override it with a trusted Release mirror or configure a Python mirror, set these variables. Replace `mirror.example` with an accessible mirror containing the required files; these are placeholders, not working public services:

```powershell
$env:DSH_PET_UV_DOWNLOAD_BASE_URL = 'https://mirror.example/astral-sh/uv/releases/download'
$env:UV_PYTHON_INSTALL_MIRROR = 'https://mirror.example/astral-sh/python-build-standalone/releases/download'
```

Only installation subprocesses receive these source settings. The memory server does not inherit them. Global `uv.toml`, extra indexes, TLS verification bypasses and arbitrary `UV_*` variables remain excluded. Compatible local Python and cached packages are still reused; ready environments and offline bundles do not need mirrors.

For workshops, prepare a platform-specific offline plugin and verify memory creation and recall on the demonstration machine beforehand. Mirror availability and performance depend on the local network; cloud model calls still need connectivity.

Source map: `dsh-pet/src/standalone/env.ts` parses download sources; `dsh-pet/src/standalone/memory-install.ts` handles downloads, verification and cache reuse; `dsh-pet/src/standalone/memory-uv.ts` pins wheel artifacts and extracts them with Node.
