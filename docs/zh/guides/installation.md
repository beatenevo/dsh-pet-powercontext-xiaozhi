# 安装 dsh-pet-powercontext

[English](../../en/guides/installation.md) · 简体中文 · [文档首页](../README.md)

以下流程安装 **v0.2.0 GitHub Release 发布包**。截至 2026-11-19，npm 的 `latest` 仍为 `0.1.0`。MiniMax 套餐与百炼模型配置见 [README](../../../README.zh.md)。

## 把插件装进 DSH

适合已经安装 DeepSeek Harness 的用户。本插件已在 **DSH 0.2.2-rc.1** 中验证，其 CLI 需要 **Node.js 24.9+**。

如果已启用上游 `dsh-pet` 插件，先将其停用。两者共用路由、命令和 `$DSH_HOME/dsh-pet/` 数据目录；保留该目录即可保留配置和记忆。

按你使用的 **DSH 版本类型**选择命令：

```sh
# DSH 浏览器版
dsh plugin --profile web add https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz
```

如果使用 DSH 桌面应用，改用：

```sh
dsh plugin --profile desktop add https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz
```

重启 DSH，打开「设置 → 桌宠配置」，再在右侧栏选择「Pet chat（桌宠对话）」。聊天沿用已配置的 DSH 模型。

## Windows 桌面下载

可在 PowerShell 执行下方独立模式命令，或在 [v0.2.0 Release 附件](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0)中查看对应平台的桌面包。若提供 ZIP，完整解压后再启动应用。不要用旧版 ZIP 验证 0.2.0 功能。

## 一条命令启动独立模式

先安装 **Node.js 22.12+**，然后在任意目录执行：

```sh
npx --yes --package=https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.2.0/dsh-pet-powercontext-0.2.0.tgz dsh-pet-powercontext --setup
```

首次运行会下载安装包，图形桌宠还可能下载 Electron。在自动打开的设置页中选择服务商、填写 API Key、选择模型，再检查连接。使用期间保持终端运行，按 **Ctrl+C** 退出；下次仍执行同一条命令。

没有自动打开浏览器时，在宿主机器的 `$DSH_HOME/dsh-pet/standalone-runtime.json` 中读取 `settingsUrl`；未设置 `DSH_HOME` 时默认使用 `~/.dsh`。这个地址含有私有访问凭据，仅在本机打开，不要分享。

图形桌宠需要桌面环境，无桌面机器可使用独立模式的浏览器设置与聊天页面。

## 按需开启记忆

普通聊天不需要 PowerContext。DSH 用户进入「设置 → 桌宠配置 → 本机长期记忆」；独立模式用户在设置页开启记忆。程序会在用户目录自动准备 Python、PowerContext 1.5.2 和单个 seekdb 数据库，Windows ZIP 本身不含已安装的 PowerContext 服务。

Windows x64 走原生安装。Linux 已完成真实服务验证；Windows x64 与 macOS 的完整安装仍待实机验证。Windows ARM64 暂不支持本机 seekdb。图文上手步骤见[养好第一只桌宠](../tutorials/first-pet.md)，详细配置与验证见[记忆指南](memory.md)。

## 更新与卸载

- **DSH：**按原来的 profile 再执行一次 `add` 命令，然后重启 DSH。
- **独立模式命令：**先退出进程，将安装包地址换成目标发布版本，再执行 `npx` 命令。
- **Windows ZIP：**先退出应用，到 [Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases) 下载需要的版本，完整解压到新文件夹。

让 DSH 管理记忆目录前，先退出使用同一目录的独立进程。卸载 DSH 插件时执行：

```sh
dsh plugin --profile web remove dsh-pet-powercontext
```

如果安装在桌面版，将 `--profile web` 换成 `--profile desktop`。卸载插件和删除数据是两件事，不打算删除配置和记忆时，请保留用户目录。详见[记忆管理](memory.md#删除与停用)。

需要修改源码时，请阅读[开发指南](../reference/development.md)。
