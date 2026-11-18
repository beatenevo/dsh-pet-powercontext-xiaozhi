---
description: 桌宠插件包，支持可选的 PowerContext 长期记忆。
kind: package-reference
---

# dsh-pet-powercontext

[English](README.md) · 简体中文 · [项目完整说明](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.zh.md)

<a id="overview"></a>

## 概述

面向 DeepSeek Harness 和独立运行的动画桌宠：聊天、人设、语音、动画、提醒，以及PowerContext + seekdb 长期记忆。本包在上游桌宠的基础上加入可选的 PowerContext 记忆。

<a id="use"></a>

## 使用本包

以下命令明确安装 **v0.2.0**，也可以从 [GitHub Releases](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0) 下载发布包。

### 已经在用 DSH

安装 DSH 与 **Node.js 24.9+** 后，在终端执行：

```sh
dsh plugin --profile web add dsh-pet-powercontext@0.2.0
```

DSH 桌面版将 `--profile web` 换为 `--profile desktop`。重启 DSH，在「设置 → 桌宠配置」调整桌宠，在右侧栏「桌宠对话」中聊天。若已启用上游 `dsh-pet`，先停用它并保留数据目录。

### 独立运行（Windows、macOS、Linux）

安装 **Node.js 22.12+** 后，在 PowerShell 或终端执行：

```sh
npx --yes dsh-pet-powercontext@0.2.0 --setup
```

在打开的设置页选择聊天模型、填写密钥并检查连接。使用期间保持终端运行；图形桌宠需要桌面环境，首次启动可能下载 Electron。独立运行不需要先安装 DSH。

Windows x64 使用原生安装路径；长期记忆会自动准备 Python 和 seekdb。Windows ARM64 的本机 seekdb 暂不支持。Linux 已完成真实服务验证，Windows x64 和 macOS 的完整安装流程仍待实机验证。桌面安装包请以 [Release 附件](https://github.com/ob-labs/dsh-pet-powercontext/releases/tag/v0.2.0)实际提供的文件为准。

### 配置模型并开启长期记忆

1. **先配置聊天模型。** DSH 桌宠沿用宿主聊天模型；在 DSH 模型设置中使用下表的 MiniMax 地址、模型与订阅 Key。独立模式在自己的设置页填写。
2. **打开本机长期记忆。** DSH 进入「设置 → 桌宠配置 → 本机长期记忆」，选择 MiniMax 中国端与通义千问·北京，填写各自密钥。聊天模型与记忆整理模型的配置分别保存。
3. **点击「检查并启用记忆」。** 程序检查模型连接，自动安装 PowerContext 1.5.2 和 seekdb，并启动服务。首次安装需要联网，记忆功能按需开启。
4. **验证记忆。** 告诉桌宠一条独特偏好，等待「记得的事」出现对应事实；清空近期聊天后再追问，检查是否召回。仅显示「已同步」不代表整理已完成。

| 配置项                     | 值                                                  |
| -------------------------- | --------------------------------------------------- |
| 聊天 / 记忆整理服务        | MiniMax 中国端套餐订阅                              |
| 生成接口地址               | `https://api.minimax.cn/v1`                         |
| 生成模型                   | `MiniMax-M3.1-Flash`                                |
| 生成密钥                   | 自己的 `sk-cp-` 订阅 Key；按量 Key 不共用套餐额度   |
| 向量服务                   | 百炼：通义千问·北京                                 |
| Embedding 接口地址         | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Embedding 模型             | `text-embedding-v4`                                 |
| Embedding 密钥             | 自己的百炼 API Key                                  |
| 向量维度 / dimensions 参数 | `1024` / 勾选发送                                   |

新配置使用一个本机 seekdb 记忆库；已有 SQLite 配置继续沿用，不自动转换。已有库的向量模型、地址与维度不能直接切换。模型检查、聊天、记忆整理和检索都可能产生用量。

### 按需接入 AI Vision 与 Token 对照

AI Vision 是可选的外部可观测平台。在可观测性设置中填写已有平台地址与认证信息，保存并检查连接；暂停再恢复记忆，使新配置应用到本机记忆服务。插件不会自动部署 AI Vision 平台。

Token 对照是辅助实验功能，用于比较不同上下文策略的回答与用量。请把记忆整理与向量化开销计入比较；短对话不保证节省 Token。

[安装详情](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/installation.md) · [记忆指南](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/memory.md) · [AI Vision](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/observability.md) · [Token 对照](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/docs/zh/guides/token-comparison.md)

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
