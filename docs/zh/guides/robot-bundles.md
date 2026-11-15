# 机器人控制精简安装包

[机器人指南](robot.md) · [English](../../en/guides/robot-bundles.md)

GitHub Actions 的 **Robot slim bundles** 流水线分别生成 Windows x64、Linux x64、Linux ARM64、macOS Intel 和 macOS Apple Silicon 的预览包，同时生成普通版和机器人精简版的 Windows 桌面 ZIP。本流水线不发布 npm，也不创建 GitHub Release；已发布的 `0.1.0-beta.1` 保持不变。

## 下载和安装

按**运行 DSH 或桌宠的电脑**选择系统和架构。下载名称使用 `windows`、`linux`、`macos`；`x64` 表示 Intel/AMD 64 位，`arm64` 包含 Apple Silicon。`<version>` 是包版本，例如 `0.1.0-beta.1`。

| 你的需求                                            | 选择的文件                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 普通插件；如需机器人环境则另行准备                  | `dsh-pet-powercontext-plugin-standard-all-platforms` 分组中的 `dsh-pet-powercontext-<version>.tgz` |
| DSH 插件，内置 Python、Astra Pro 2.0 SDK 和控制依赖 | `dsh-pet-powercontext-<version>-plugin-<platform>-astra-pro-2.0-bundled.tgz`                       |
| Windows 应用，内置机器人环境                        | `dsh-pet-powercontext-<version>-desktop-windows-x64-astra-pro-2.0-bundled.zip`                     |
| Windows 应用，不内置机器人环境                      | `dsh-pet-powercontext-<version>-desktop-windows-x64-standard.zip`                                  |
| 单独检查机器人环境；不含桌宠应用                    | `dsh-pet-powercontext-astra-pro-2.0-runtime-only-<platform>-python-sdk.tar.gz`                     |

`astra-pro-2.0-bundled` 内置精简的**控制**环境：Python、SDK、gRPC 和 protobuf，不含 OpenCV、NumPy。`standard` 不内置机器人环境。普通 npm 包保留标准归档名和包名。上述归档均不内置 DSH、`powercontext-dsh`、PowerContext Server 或模型权重；这些集成仍按需单独配置。

每次成功构建生成八个桌宠安装包和五个独立环境包。GitHub 将它们放在六个安装包下载分组中：一个普通插件分组和五个平台分组。Windows 平台分组除了插件、独立环境包，还包含两个桌面 ZIP。所有归档文件名和下载分组名均包含 `powercontext`。下载内容只有安装包和环境包；体积、验证报告及文件用途显示在各平台任务的流水线摘要中。

打开[流水线页面](https://github.com/ob-labs/dsh-pet-powercontext/actions/workflows/robot-bundles.yml)，选择成功的构建，在 **Artifacts** 下载对应的 `dsh-pet-powercontext-astra-pro-2.0-bundles-<platform>`。下载需要登录 GitHub，产物保留七天。先解压下载的 artifact ZIP。

- **Windows 桌面版：**解压 `dsh-pet-powercontext-<version>-desktop-windows-x64-astra-pro-2.0-bundled.zip`，保留完整的 `win-unpacked` 目录，运行 `dsh-pet.exe`。其中已经包含 Python、SDK、Electron/Node 和应用依赖。预览版未签名，Windows 可能显示信誉提示。
- **DSH 插件：**选择与**运行 DSH 的电脑**匹配的 `dsh-pet-powercontext-<version>-plugin-<platform>-astra-pro-2.0-bundled.tgz`，执行 `dsh plugin --profile web add "/安装包的绝对路径.tgz"`。DSH 桌面应用改用 `--profile desktop`，先启动一次以初始化 profile，再完全退出后安装。重启 DSH 即可；DSH 自身依赖可能需要联网。[完整图文步骤](../tutorials/astra-first-interaction.md)。
- **Node 独立版：**在空目录执行 `npm install --offline --legacy-peer-deps "/安装包的绝对路径.tgz"`，再运行 `npx --no-install dsh-pet-powercontext --setup`。需要 Node 22.12+；显示桌面角色时可能另外下载 Electron。安装包不含 DSH 本身。
- **仅运行环境：**`dsh-pet-powercontext-astra-pro-2.0-runtime-only-<platform>-python-sdk.tar.gz` 便于检查部署内容，精简插件包和桌面包已经包含它，无需重复安装。

在机器人面板选择 **内置环境（推荐）**，无需另装 Python。不要只复制 Python 可执行文件或 `bridge.py`，必须保留整个运行环境目录。升级前保存的自定义 Python 路径会保留；需要手动切换到内置环境。

## 包含哪些依赖

独立环境固定使用 CPython 3.11.18（python-build-standalone `20261110`）、Astra SDK 2.0.0、gRPC 和编译工具 1.78.0、protobuf 6.31.1，以及 pip、setuptools、typing extensions，明确不包含 OpenCV 和 NumPy。版本和校验值放在 `dsh-pet/runtime/astra/`；生成的环境放在仓库外。精简 npm 安装包还包含桌宠的 Node 运行依赖，并标记为 private，防止误把单平台产物发布为通用 npm 包。

适配脚本直接使用 SDK 生成的协议模块，保留预设动作、动作序列、控制器状态查询、播报请求和三路停止接口。精简包不支持摄像头预览、图像及深度图处理。厂家 SDK 的顶层 `astra_grpc_clients` 封装会立即导入视觉库，因此不能在此环境中使用；原始 SDK wheel 和元数据均保持不变。

应用使用独立 Python 的绝对路径和隔离模式，不激活虚拟环境、不修改 PATH、不向系统 Python 安装依赖。内置文件缺失时会报错，不会悄悄切到系统 Python。Electron 中的原生文件位于 `resources/astra-runtime`，在 `app.asar` 外；插件中位于 `runtime/astra-native`。只有主动选择 **自定义 Python 环境** 才会使用指定的外部解释器。

Linux 包面向 glibc，不支持 Alpine/musl；不再需要 OpenCV 使用的 `libGL.so.1` 和 GLib。流水线在对应架构的 Ubuntu 24.04、Windows Server 2022、macOS 15 Intel 和 macOS 26 Apple Silicon 上验证，其他系统版本需要另行验证。容器部署需要在容器内安装包。macOS 产物不是经过公证的桌面安装器。

厂家 wheel 元数据声明 MIT，但未提供独立的许可证及版权声明文件。每份运行环境保留其原始元数据和来源说明，Python 及其他依赖自带的许可证文件也会保留；后续公开分发时如能取得厂家完整声明，应一并补入。

## 构建、体积和验证

工作流合入默认分支后，可点击 **Run workflow** 并选择要构建的分支。当前开发分支 push 也会触发构建。流水线不使用 npm 凭据，也没有发布权限。

每个平台在原生 runner 上校验 Python 压缩包和 wheel 哈希，在安装 SDK 前检查依赖完整性。安装 SDK 后，只允许原始元数据中两条被主动省略的 OpenCV 依赖，其余依赖错误均导致失败。因此直接运行 `pip check` 会报告这两条预期缺失；重新自动解析安装 SDK 会把视觉依赖装回来。验证还会确认 `cv2` 和 NumPy 不可用，真实导入 SDK 协议模块；移动环境目录后，带着干扰性的 Python 环境变量测试隔离；通过本地模拟 gRPC 服务验证状态、单动作、动作序列、语音和三路停止。压缩包解压后会再运行测试，精简 npm 包必须能在空缓存、离线模式下安装，安装后的 HTTP 宿主还必须能自动选择内置 Python 并读取本地模拟控制器状态。

打开流水线 **Summary** 查看各平台的安装包体积，展开详情可查看 SHA256、依赖版本、组件占用和验证结果。单位为 MiB（1,048,576 字节），不计文件系统分配空间和安装临时空间。每个平台任务都要求生成本平台报告后才能上传安装包。报告、测试 JSON 和截图仅留在 runner 临时目录，不上传为 artifact，也不混入下载分组。

Windows 桌面 ZIP 会解压并启动真实 Electron 应用，检查窗口加载和 ASAR 内宿主调用内置 SDK 的能力，并保存截图。展会电脑仍需现场验收，并用展会真机联调。本地模拟服务不能证明固件兼容、实际动作、播报效果或停止距离。

本机构建时，先执行 `npm pack --pack-destination /data/codex-tmp/astra-base` 生成普通包，再从 `dsh-pet` 目录运行：

```bash
TMPDIR=/data/codex-tmp PYTHONDONTWRITEBYTECODE=1 python3 scripts/astra/build.py \
  --output /data/codex-tmp/astra-slim-build \
  --base-package /data/codex-tmp/astra-base/dsh-pet-powercontext-0.1.0-beta.1.tgz
```

每次构建使用新的输出目录。生成的安装包、缓存、临时环境和体积报告均不提交到仓库。
