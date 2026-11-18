---
description: 桌宠插件包，支持可选的 PowerContext 长期记忆。
kind: package-reference
---

# dsh-pet-powercontext

[English](README.md) · 简体中文 · [项目完整说明](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.zh.md)

<a id="overview"></a>

## 概述

面向 DeepSeek Harness 和独立运行的动画桌宠：聊天、人设、语音、动画、提醒，以及每只宠物独立的 PowerContext 1.5.0 长期记忆。本包在上游桌宠的基础上加入可选的 PowerContext 记忆。

<a id="use"></a>

## 使用本包

已发布的 **beta** 通道当前提供 `0.1.0-beta.1`。下面任选一种方式，无需下载源码或编译。

**DSH 插件**：已安装 DSH 和 Node.js 24.9+ 时，执行：

```sh
dsh plugin --profile web add dsh-pet-powercontext@beta
```

DSH 桌面版把 `--profile web` 换成 `--profile desktop`。重启 DSH，打开「设置 → 桌宠配置」，通过「Pet chat（桌宠对话）」使用 DSH 模型聊天。若已启用上游 `dsh-pet` 插件，先将其停用；保留共用的数据目录，以继续使用原配置和记忆。

**Windows 应用**：[下载 Windows x64 ZIP](https://github.com/ob-labs/dsh-pet-powercontext/releases/download/v0.1.0-beta.1/dsh-pet-win-x64.zip)，完整解压后双击 **dsh-pet.exe**，无需安装 Node.js。在桌宠菜单选择「打开 AI 设置」配置模型。

**独立模式命令**：已安装 Node.js 22.12+ 时，执行：

```sh
npx --yes dsh-pet-powercontext@beta --setup
```

在设置页中选择服务商、填写 API Key 并检查连接，使用期间保持终端运行。详见[安装与更新指南](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/installation.md)。

长期记忆按需开启。DSH 用户进入「设置 → 桌宠配置 → 本机长期记忆」；独立模式用户在设置页开启。聊天、记忆整理和向量服务可分别选择服务商，预设支持 DeepSeek、OpenAI、通义千问、硅基流动、火山方舟、智谱、Kimi、Ollama 和可选 LiteLLM 网关。详见[模型配置](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/models.md)。

<a id="implementation"></a>

## 理解实现

| 源码                                  | 职责                                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| `src/host/index.ts`                   | Cordis 宿主插件装配，导出 `name`、`inject`、`apply`。           |
| `src/client/index.ts`                 | 浏览器插件与界面注册，通过 `dsh-pet-powercontext/client` 导出。 |
| `src/host/plugin/chat-memory.ts`      | 本机聊天存档、采集队列与提示词装配。                            |
| `src/host/powercontext.ts`            | 有预算限制的 PowerContext 采集和召回客户端。                    |
| `src/host/powercontext-library.ts`    | 记忆列表、来源、更正和遗忘。                                    |
| `src/standalone/managed-memory.ts`    | 本机运行时、健康检查和稳定的服务身份。                          |
| `src/host/plugin/managed-memory.ts`   | DSH 内的本机记忆生命周期。                                      |
| `src/client/settings/memory-setup.ts` | DSH 记忆设置和服务控制界面。                                    |

包导出宿主入口、`./client`、`./src/*`、`./cordis.patch.yml`、`./package.json`。可执行命令 `dsh-pet-powercontext` 启动独立模式。

<a id="explore"></a>

## 进一步探索

[功能](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/FEATURES.md) · [配置](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/CONFIG.md) · [PowerContext](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md) · [HTTP 契约](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/openapi.yaml) · [制作宠物](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/MAKE-YOUR-OWN-PET.md)

<a id="models"></a>

## 模型体验

近期对话和召回记忆分别设限。问答异步采集后，由后台模型整理成可召回的事实。打开「记得的事」可以查看和更正。配置和生命周期边界见 [PowerContext 接入指南](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md)。

<a id="limits"></a>

## 已知限制

聊天需要模型凭据，宿主能力需要对应的 DSH 服务。记忆只采集桌宠对话，尚未接入 DSH 编程 Agent 会话。记忆抽取并非即时，也不保证每次成功；遗忘不会物理删除来源或本机聊天。生成与 Embedding 会把所需文本发送给模型服务商。形象素材受非商业授权约束，代码采用 MIT，详见[完整许可与致谢](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.zh.md#致谢与许可)。

<a id="development"></a>

## 开发备注

交付前执行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:cycles`、`pnpm check:runtime`、`pnpm check:openapi`、`pnpm test`、`pnpm test:ui`、`pnpm build`。

发布设置与操作见[发布说明](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/releases.md)。素材许可与署名随包附在 [ASSET-LICENSE.md](ASSET-LICENSE.md)。

## 本机接口访问设置

**DSH 插件：**打开「设置 → 桌宠配置」，在「接口访问 Token」卡片填写 43 位字母、数字、下划线或短横线并保存。外部程序通过 `X-DSH-Pet-Token` 调用桌宠接口，新值立即生效，旧值失效。Token 私有保存在 `dsh-pet/interface-access-token.json`，重启后保留，不在设置页回显。只有已登录的 DSH 会话能修改 Token；它不改变 DSH 的登录凭据。桌宠内部仍走宿主 IPC，保存后无需重启桌宠。

同页选择桌宠，在「接口 Pet ID」输入对外别名，再点击该宠物的「保存」。此入口支持默认角色及扩展角色；留空恢复内部 ID，原聊天记录与记忆保留。

独立桌面应用中打开「设置 → 接口访问 Token」，填入 43 位字母、数字、下划线或短横线组成的随机凭证，点击「保存并立即生效」。保存成功后服务端、桌面请求和当前设置页同步切换，旧凭证失效，无需重启。外部程序须更新 `X-DSH-Pet-Token` 请求头；其它已打开的设置页请从桌宠菜单重新打开。固定值保存在本机私有 `dsh-pet/access-token.json` 中，重启后继续使用；尚未设置时仍按启动随机生成。不会在页面回显已保存的值。

「设置 → 配置 → 接口 Pet ID」用于指定外部调用的 `?pet=` 参数，例如 `demo-fish`。它是稳定内部实例的对外别名：修改后聊天记录、素材和 PowerContext 记忆空间继续沿用，内部 ID 仍可供桌面端使用，返回的状态键也保持内部 ID。留空恢复内部 ID；别名不得与任何其它实例的 ID 或别名冲突。此操作不搬移、不删除历史数据。

| 源码                                 | 职责                                          |
| ------------------------------------ | --------------------------------------------- |
| `src/standalone/access-token.ts`     | 认证后保存、轮换凭证并刷新当前设置页 Cookie。 |
| `src/standalone/request-security.ts` | 私有凭证加载、校验与即时切换。                |
| `src/host/config/api-id.ts`          | 外部 Pet ID 解析及跨条目冲突检查。            |
