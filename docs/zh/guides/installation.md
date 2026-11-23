# 安装 dsh-pet-powercontext

[English](../../en/guides/installation.md) · 简体中文 · [文档首页](../README.md)

以下命令明确安装 **v0.2.0**，也可以从 [GitHub Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0) 下载发布包。MiniMax 套餐与百炼模型配置见 [README](../../../README.zh.md)。

## 把插件装进 DSH

适合已经安装 DeepSeek Harness 的用户。本插件已在 **DSH 0.2.2-rc.1** 中验证，其 CLI 需要 **Node.js 24.9+**。

如果已启用上游 `dsh-pet` 插件，先将其停用。两者共用路由、命令和 `$DSH_HOME/dsh-pet/` 数据目录；保留该目录即可保留配置和记忆。

按你使用的 **DSH 版本类型**选择命令：

```sh
# DSH 浏览器版
dsh plugin --profile web add dsh-pet-powercontext@0.2.0
```

如果使用 DSH 桌面应用，改用：

```sh
dsh plugin --profile desktop add dsh-pet-powercontext@0.2.0
```

重启 DSH，打开「设置 → 桌宠配置」，再在右侧栏选择「Pet chat（桌宠对话）」。聊天沿用已配置的 DSH 模型。

## Windows 桌面下载

可在 PowerShell 执行下方独立模式命令，或在 [v0.2.0 Release 附件](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0)中查看对应平台的桌面包。若提供 ZIP，完整解压后再启动应用。不要用旧版 ZIP 验证 0.2.0 功能。

## 一条命令启动独立模式

先安装 **Node.js 22.12+**，然后在任意目录执行：

```sh
npx --yes dsh-pet-powercontext@0.2.0 --setup
```

首次运行会下载安装包，图形桌宠还可能下载 Electron。在自动打开的设置页中选择服务商、填写 API Key、选择模型，再检查连接。使用期间保持终端运行，按 **Ctrl+C** 退出；下次仍执行同一条命令。

没有自动打开浏览器时，在宿主机器的 `$DSH_HOME/dsh-pet/standalone-runtime.json` 中读取 `settingsUrl`；未设置 `DSH_HOME` 时默认使用 `~/.dsh`。这个地址含有私有访问凭据，仅在本机打开，不要分享。

图形桌宠需要桌面环境，无桌面机器可使用独立模式的浏览器设置与聊天页面。

## 按需开启记忆

普通聊天不需要 PowerContext。DSH 用户进入「设置 → 桌宠配置 → 本机长期记忆」；独立模式用户在设置页开启记忆。程序会在用户目录自动准备 Python、PowerContext 1.5.2 和单个 seekdb 数据库，Windows ZIP 本身不含已安装的 PowerContext 服务。

Windows x64 走原生安装。Linux 已完成真实服务验证；Windows x64 与 macOS 的完整安装仍待实机验证。Windows ARM64 暂不支持本机 seekdb。图文上手步骤见[养好第一只桌宠](../tutorials/first-pet.md)，详细配置与验证见[记忆指南](memory.md)。

## 更新与卸载

- **DSH：**按原来的 profile 再执行一次 `add` 命令，然后重启 DSH。
- **独立模式命令：**先退出进程，将 `@0.2.0` 换成目标发布版本，再执行 `npx` 命令。
- **Windows ZIP：**先退出应用，到 [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases) 下载需要的版本，完整解压到新文件夹。

让 DSH 管理记忆目录前，先退出使用同一目录的独立进程。卸载 DSH 插件时执行：

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

如果安装在桌面版，将 `--profile web` 换成 `--profile desktop`。卸载插件和删除数据是两件事，不打算删除配置和记忆时，请保留用户目录。详见[记忆管理](memory.md#删除与停用)。

需要修改源码时，请阅读[开发指南](../reference/development.md)。

## 中国网络与自定义下载源

普通包的记忆安装器支持分别配置 uv、Python 和 Python 依赖的下载源。未配置时使用原有上游地址，不自动切换第三方服务。仅修改 PyPI 源不能解决 uv 或 Python 的 GitHub 下载超时。

| 环境变量                       | 作用与地址格式                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `DSH_PET_UV_DOWNLOAD_BASE_URL` | uv Release 根地址；安装器追加 `/0.9.26/<平台压缩包名>`。默认 `https://github.com/astral-sh/uv/releases/download` |
| `UV_PYTHON_INSTALL_MIRROR`     | CPython 构建镜像根地址；保留上游 `python-build-standalone/releases/download` 下的日期与文件名布局                |
| `UV_DEFAULT_INDEX`             | Python 包的完整 simple 索引地址，例如 `https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple`                     |
| `UV_INDEX_URL`                 | 兼容 uv 的旧索引变量；与 `UV_DEFAULT_INDEX` 同时设置时，后者优先                                                 |

地址必须使用 HTTPS，且不能包含用户名、密码、查询参数或片段。uv 仍使用固定版本及 SHA256 校验；镜像须提供原始压缩包，校验失败不会解压执行。下载连接超时为 30 秒，单次传输上限 300 秒，瞬时错误最多重试两次，整个命令仍受 10 分钟上限及用户取消控制。Python 和依赖沿用 uv 自身的网络重试机制。

Windows PowerShell 示例（仅加速 Python 依赖）：

```powershell
$env:UV_DEFAULT_INDEX = 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple'
```

macOS/Linux shell：

```sh
export UV_DEFAULT_INDEX='https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple'
```

设置后，完全退出原有 DSH/独立应用，再从同一个终端启动安装了此功能版本的应用，点击「重试本次设置」。桌面快捷方式不会继承另一个终端的临时变量；也可以在操作系统用户环境变量中配置，再重新登录并启动应用。

如已准备可信的 uv 和 Python 镜像，可在 PowerShell 中额外设置以下变量。`mirror.example` 是地址格式占位符，必须换成实际可访问、包含对应文件的镜像，不能原样运行：

```powershell
$env:DSH_PET_UV_DOWNLOAD_BASE_URL = 'https://mirror.example/astral-sh/uv/releases/download'
$env:UV_PYTHON_INSTALL_MIRROR = 'https://mirror.example/astral-sh/python-build-standalone/releases/download'
```

这些变量仅传给安装子进程；记忆服务不继承包源设置。安装器继续忽略全局 `uv.toml`，不导入额外索引、证书校验绕过或其它任意 `UV_*` 设置。兼容本机 Python 与已有依赖缓存仍优先复用，已就绪环境和离线包无需配置镜像。

Workshop 建议提前准备[平台专用离线包](offline-installation.md)，并在演示电脑完成启用记忆与召回验证；镜像可达性和速度取决于现场网络，云模型仍需联网。

安装源解析位于 `dsh-pet/src/standalone/env.ts`，下载、校验和缓存复用位于 `dsh-pet/src/standalone/memory-install.ts`。
