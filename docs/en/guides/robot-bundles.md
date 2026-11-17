# Slim robot control packages

> This branch now uses MCP. The Python/SDK bundle instructions below apply to older versions only. Follow the [MCP setup guide](../guides/robot.md).
[Robot guide](robot.md) · [简体中文](../../zh/guides/robot-bundles.md)

The **Robot slim bundles** GitHub Actions workflow creates preview artifacts for Windows x64, Linux x64, Linux ARM64, macOS Intel and macOS Apple Silicon. It also produces ordinary and slim Windows desktop ZIPs. These builds do not publish to npm or create a GitHub Release. The published `0.1.0-beta.1` remains unchanged.

## Download and install

Choose the OS and architecture of the **computer running DSH or the pet**. Download names use `windows`, `linux`, and `macos`; `x64` means Intel/AMD 64-bit and `arm64` includes Apple Silicon. `<version>` is the package version, such as `0.1.0-beta.1`.

| What you need                                                      | File to choose                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Standard plugin; prepare any robot environment separately          | `dsh-pet-powercontext-<version>.tgz` in `dsh-pet-powercontext-plugin-standard-all-platforms` |
| DSH plugin with Python, Astra Pro 2.0 SDK and control dependencies | `dsh-pet-powercontext-<version>-plugin-<platform>-astra-pro-2.0-bundled.tgz`                 |
| Windows application with the robot environment included            | `dsh-pet-powercontext-<version>-desktop-windows-x64-astra-pro-2.0-bundled.zip`               |
| Windows application without the robot environment                  | `dsh-pet-powercontext-<version>-desktop-windows-x64-standard.zip`                            |
| Inspect the robot environment by itself; no pet application        | `dsh-pet-powercontext-astra-pro-2.0-runtime-only-<platform>-python-sdk.tar.gz`               |

`astra-pro-2.0-bundled` includes the slim **control** environment: Python, SDK, gRPC and protobuf, without OpenCV or NumPy. `standard` has no bundled robot environment. The npm package keeps its standard npm filename and package name. None of these archives bundles DSH, `powercontext-dsh`, PowerContext Server or model weights; those integrations remain optional and separately configured.

Each successful run produces eight pet packages and five runtime-only archives. GitHub groups them into six package artifacts: one standard-plugin group and five platform groups. The Windows platform group contains both desktop ZIPs as well as the plugin and runtime-only archive. Every archive filename and artifact group includes `powercontext`. Downloads contain packages only; size and validation reports appear in each platform job's workflow summary, together with filenames and their purpose.

Open [the workflow](https://github.com/ob-labs/dsh-pet-powercontext/actions/workflows/robot-bundles.yml), select a successful run and download `dsh-pet-powercontext-astra-pro-2.0-bundles-<platform>` from **Artifacts**. Artifact downloads require a GitHub login and are retained for seven days. Extract the artifact ZIP first.

- **Windows desktop:** extract `dsh-pet-powercontext-<version>-desktop-windows-x64-astra-pro-2.0-bundled.zip`, keep the complete `win-unpacked` directory, and run `dsh-pet.exe`. Python, the SDK, Electron/Node and application dependencies are included. The unsigned preview may trigger Windows reputation prompts.
- **DSH plugin:** use the `dsh-pet-powercontext-<version>-plugin-<platform>-astra-pro-2.0-bundled.tgz` matching the **host computer**, then run `dsh plugin --profile web add "/absolute/path/to/the-slim.tgz"`. For DSH Desktop, use `--profile desktop`; launch the app once to initialize its profile, then fully quit before installation. Restart DSH afterwards. Its own dependencies may require network access. Follow the [illustrated tutorial](../tutorials/astra-first-interaction.md).
- **Node standalone:** in an empty directory, run `npm install --offline --legacy-peer-deps "/absolute/path/to/the-slim.tgz"`, then `npx --no-install dsh-pet-powercontext --setup`. Node 22.12+ is required, and displaying the desktop character may download Electron separately. DSH itself is not included.
- **Runtime only:** `dsh-pet-powercontext-astra-pro-2.0-runtime-only-<platform>-python-sdk.tar.gz` is provided for deployment inspection. The slim plugin and desktop archives already contain it.

In the robot panel, select **Bundled environment (recommended)**. There is no Python installation step. Copying only the executable or `bridge.py` is insufficient: preserve the complete runtime directory. Configuration saved with a custom Python path remains custom; switch to bundled explicitly when upgrading that installation.

## What is included

The private runtime pins CPython 3.11.18 (python-build-standalone release `20261110`), Astra SDK 2.0.0, gRPC and compiler 1.78.0, protobuf 6.31.1, pip, setuptools and typing extensions. OpenCV and NumPy are intentionally excluded. Build inputs and hashes live in `dsh-pet/runtime/astra/`; compiled environments are created outside the repository. The slim npm archive additionally bundles the plugin's Node runtime dependency closure and is marked private to prevent accidentally publishing a platform-specific archive under the universal package name.

The adapter imports the SDK's generated protocol modules directly. Taught actions, action sequences, controller status, speech requests and three subsystem stops remain supported. Camera preview and image/depth processing are excluded. The vendor's top-level `astra_grpc_clients` wrapper eagerly imports the omitted vision libraries, so it cannot be used in this profile; the original SDK wheel and metadata remain unchanged.

The runtime uses an absolute executable path and Python isolated mode. It does not activate a virtual environment, edit PATH, install into system Python, or fall back to system Python when files are missing. In Electron, native files live in `resources/astra-runtime`, outside `app.asar`; in the plugin, they live in `runtime/astra-native`. Choosing **Custom Python environment** is an explicit advanced override and uses the interpreter you provide.

Linux packages target glibc (not Alpine/musl); they no longer require OpenCV's `libGL.so.1` or GLib. CI tests Ubuntu 24.04, Windows Server 2022, macOS 15 Intel and macOS 26 Apple Silicon. Other OS versions require separate validation. Container deployments must install the archive inside the container. macOS packages are not notarized application installers.

The supplied SDK metadata declares MIT but contains no separate vendor license/copyright notice. The unmodified metadata and provenance notice are preserved in every runtime. Python and dependency license files remain included; request the vendor's complete notice for future public redistribution if available.

## Build, sizes and verification

The workflow runs when a `v*` tag is pushed or when you select **Run workflow** and choose a branch or tag. Pull requests and ordinary branch pushes do not trigger packaging. There are no npm credentials or publishing permissions in this workflow.

Each native runner verifies the Python archive and wheel hashes and checks the dependency closure before installing the SDK. Afterwards it permits exactly the two missing OpenCV requirements declared by the unmodified SDK metadata and rejects all other dependency errors. A plain `pip check` therefore reports those intentional omissions; reinstalling the SDK with automatic dependency resolution would restore the vision stack. Validation confirms `cv2` and NumPy are unavailable and imports the actual SDK protocol modules. It tests the relocated interpreter with hostile Python environment variables; exercises status, single/group actions, speech and all three stops against a loopback gRPC server; and repeats smoke tests after extracting the compressed archives. The slim npm archive must install with an empty npm cache in offline mode; the installed HTTP host must then select its bundled interpreter and read the loopback controller state.

Open the workflow **Summary** to read each platform's package sizes. Expand its details to inspect SHA256 checksums, dependency versions, component sizes and validation results. Values use MiB (1,048,576 bytes); filesystem allocation and installation scratch space are not included. Each native job requires its own report before uploading packages. Reports, test JSON and screenshots stay in runner temporary storage and are not uploaded as artifacts or included alongside the downloads.

The Windows desktop ZIP is extracted and launched with real Electron. CI verifies a window loads and the ASAR host reaches the bundled SDK, then saves a screenshot. Exhibition hardware still requires on-site acceptance and physical robot validation. Loopback RPCs do not validate robot firmware, movement, playback or stopping distance.

For a local native build, first produce the ordinary package with `npm pack --pack-destination /data/codex-tmp/astra-base`, then run from `dsh-pet`:

```bash
TMPDIR=/data/codex-tmp PYTHONDONTWRITEBYTECODE=1 python3 scripts/astra/build.py \
  --output /data/codex-tmp/astra-slim-build \
  --base-package /data/codex-tmp/astra-base/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

Use a new output directory on each run. Generated archives, caches, temporary environments and reports are never committed.
