# Install dsh-pet-powercontext

English · [简体中文](../../zh/guides/installation.md) · [Documentation](../README.md)

These instructions install the **v0.2.0 GitHub Release archive**. As of 2026-11-19, npm `latest` still points to `0.1.0`. See the [README](../../../README.md) for MiniMax subscription and Bailian model settings.

## Add the plugin to DSH

Use this option if you already have DeepSeek Harness. The plugin has been tested with DSH **0.2.2-rc.1**; its CLI needs Node.js **24.9+**.

If you have the upstream `dsh-pet` plugin enabled, disable it first. Both packages use the same routes, commands and `$DSH_HOME/dsh-pet/` data directory. Keep that directory to retain configuration and memories.

Run the command for **your DSH profile**:

```sh
# DSH browser profile
dsh plugin --profile web add https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz
```

For the DSH desktop app, use this command instead:

```sh
dsh plugin --profile desktop add https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz
```

Restart DSH, open **Settings → Pet Config**, then select **Pet chat** in the right sidebar. Chat uses your configured DSH model.

## Windows desktop downloads

Use the standalone command below in PowerShell, or check the [v0.2.0 Release assets](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0) for a desktop package for your platform. When a ZIP is available, extract the entire archive before launching the app. Do not use an older release ZIP to try v0.2.0 features.

## Start standalone with one command

Install Node.js **22.12+** if needed, then run the following command from any folder:

```sh
npx --yes --package=https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz dsh-pet-powercontext --setup
```

The first launch downloads the package and, for graphical pets, may download Electron. In the setup page that opens, choose a provider, enter your API key, select a model and check the connection. Keep the terminal running while using the pet; press **Ctrl+C** to stop it. Run the same command next time.

If no browser opens, read `settingsUrl` from `$DSH_HOME/dsh-pet/standalone-runtime.json` on the host machine (`DSH_HOME` defaults to `~/.dsh`). Open that URL locally; it contains a private access token and should not be shared.

Graphical pets need a desktop session. Headless machines can use the standalone web settings and chat pages.

## Enable memory when you need it

Chat works without PowerContext. In DSH, open **Settings → Pet Config → Local long-term memory**; in standalone mode, enable memory in the setup page. The setup automatically prepares Python, PowerContext 1.5.2 and a single seekdb database in your user directory. The Windows ZIP does not include an installed PowerContext service.

Windows x64 uses native installation. Linux has real-service validation; Windows x64 and macOS still require full real-host validation. Windows ARM64 local seekdb is unsupported. Follow [Your first pet](../tutorials/first-pet.md) for the illustrated walkthrough or [memory setup](memory.md) for configuration and verification.

## Update and remove

- **DSH:** run the same `add` command for your profile, then restart DSH.
- **Standalone command:** stop the process and replace the archive URL with the desired release version and run the `npx` command again.
- **Windows ZIP:** exit the app, download the desired version from [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases), and extract it to a new folder. Keep the complete folder together.

Stop a standalone process before having DSH manage the same memory directory. To remove the DSH plugin, run:

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

Use `--profile desktop` if that is where you installed it. Removing the plugin and deleting your data are separate actions. Keep the user data directory unless you intend to remove configuration and memories. See [memory controls](memory.md#deletion-and-disabling).

To change the code, see the [development guide](../reference/development.md).
