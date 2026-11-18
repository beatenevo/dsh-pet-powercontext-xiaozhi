# dsh-pet-powercontext

**一只会陪你聊天、跟着工作状态动起来，也能记住你偏好的桌宠。**

[English](README.md) · 简体中文 · [文档](docs/zh/README.md) · [安装](docs/zh/guides/installation.md) · [下载版本](https://github.com/ob-labs/dsh-pet-powercontext/releases)

把她拖到工作区旁边，写一段人设，随时聊两句。桌宠既能作为 **DeepSeek Harness（DSH）插件**，也能 **独立运行**。可选的 **PowerContext + seekdb** 长期记忆，让事实与偏好在退出近期聊天窗口后仍有机会被找回。

本项目基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。

可选功能：[Astra Pro 2.0 MCP 接入](docs/zh/guides/robot.md)支持目录发现、示教程序、区域移动和语音播报，无需客户端 Python/SDK。

可选功能：[AI Vision 可观测性](docs/zh/guides/observability.md)提供可选、不含正文的链路采集，以及平台已有记忆视图的查看入口。[Token 对照](docs/zh/guides/token-comparison.md)可以比较三种上下文策略的回答与实测用量。这些功能已包含在 v0.2.0 发布包中。

## 看看用起来的样子

### DSH、桌宠与记忆在同一个工作区

![完整 DSH 工作区中的桌宠，以及 PowerContext 已生成的两条记忆](docs/assets/screenshots/dsh-live-memory.zh.png)

_DSH Agent 会话和桌宠面板同时保留在工作区。PowerContext 已从桌宠对话生成两条记忆：设备预算与离线备用资料的位置。展开列表可以查看事实及其来源入口；仅有「已同步」状态不能证明抽取或召回成功。_

### 并排看回答，也看 Token 开销

![DSH 内真实运行的 Token 对照：完整背景与 PowerContext 回答并排展示](docs/assets/screenshots/dsh-token-comparison.zh.png)

_同一个合成场景、真实模型调用：13 个问题复用 6 条已生成的记忆。相对每次携带完整背景，回答输入减少 **80.5%**（61,387 → 11,944 Token）；计入记忆生成与向量化输入后，减少 **12.6%**（61,387 → 53,641）。这是实测输入量，不是费用节省，也不是对 DSH 默认任务 Agent 策略的测量。_

[首批 6 个问题](docs/assets/screenshots/dsh-token-first-batch.zh.png)计入记忆开销后，输入反而**增加了 65.4%**。已知输出也增加了，向量化输出未报告。解读节省比例时，请一起看 [Token 明细](docs/assets/screenshots/dsh-token-details.zh.png)和[对照操作指南](docs/zh/guides/token-comparison.md)。

### 在 AI Vision 中追踪一次桌宠回复

![AI Vision 中的真实桌宠调用链，包含 PowerContext 召回和回答模型调用](docs/assets/screenshots/ai-vision-pet-trace.zh.png)

_这是一条单独的普通桌宠聊天轨迹：从记忆召回进入 PowerContext，再调用回答模型，共 10 个节点，检索返回 2 条记忆。提示词和回答正文按设计不采集；AI Vision 展示已知 Token 小计，缺失用量时完整总量保持未知。此图不是对照实验的汇总。_

以上 **1600 × 1000** 原始截图于 **2026-11-15** 在 Linux Chromium 中采集，使用 **DSH 0.2.2-rc.1**、桌宠预览构建 **`2e080f1`**、PowerContext **`1.5.2.dev148+gfa80ab6b2`** 与本机部署的 AI Vision。演示事实为虚构资料，生成与向量化均调用真实服务。中英文 README 共用原始中文界面，未替换界面文字。[采集说明与验证范围](docs/assets/README.md#live-comparison-and-traces--对照与调用链实拍)。

<details>
<summary>展开观看聊天与记忆召回实录 GIF</summary>

![在完整 DeepSeek Harness 界面中与桌宠真实聊天](docs/assets/demos/dsh-chat.gif)

_同一界面保留 DSH 工作区、Agent 会话和桌宠聊天面板，实际发送消息，观看桌宠回复和动作。两边的回复都来自真实模型调用；项目名和饮品偏好是虚构的演示输入。_

![在 DeepSeek Harness 中召回长期记忆并查看已记住的事实](docs/assets/demos/dsh-memory-recall.gif)

_后台抽取后，桌宠再次答出项目名 Moonleaf 和“无糖茉莉花茶”。本次演示将近期聊天设为 **0 轮**：实际模型请求携带召回记忆和新问题，没有携带历史问答。展开「Remembered facts」可以查看抽取后的事实。_

以上 GIF 于 **2026-11-11** 在 Linux Chromium 中实录，使用 **DSH 0.2.2-rc.1** 与 **PowerContext + seekdb**，保留当时界面原有的中英文控件。[查看原尺寸聊天截图](docs/assets/screenshots/dsh-chat.en.png) · [召回与记忆列表](docs/assets/screenshots/dsh-facts.en.png) · [图文来源](docs/assets/README.md)。

</details>

## 先养好一只

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

[安装详情](docs/zh/guides/installation.md) · [记忆指南](docs/zh/guides/memory.md) · [AI Vision](docs/zh/guides/observability.md) · [Token 对照](docs/zh/guides/token-comparison.md)

## 桌宠与记忆分别做什么

| 桌宠提供                             | PowerContext 提供                  |
| ------------------------------------ | ---------------------------------- |
| 点击、拖拽、抛掷，播放 100+ 动画素材 | 跨越近期窗口和重启，按问题召回事实 |
| 独立人设、聊天与可配置语音           | 不同宠物各自的记忆 Scope           |
| 待办、提醒、睡觉和可选碎碎念         | 查看来源、更正事实、申请遗忘       |
| 跟随 DSH 会话工作状态                | 分别限制近期正文与召回正文         |
| 安装自己的角色和动画包               | 暂停记忆后继续使用近期聊天         |

会话联动、语音识别、服务商余额等能力取决于运行方式和宿主服务。聊天中记住一句承诺，不会自动创建提醒或执行动作。

模型预设包括 MiniMax、DeepSeek、OpenAI、通义千问、硅基流动、火山方舟、智谱、Kimi、Ollama 和可选 LiteLLM 网关。聊天、记忆整理与 Embedding 可以使用不同服务商。[功能说明](docs/zh/reference/features.md) · [动画预览](docs/zh/reference/gallery.md)

## 为什么接记忆，token 又省在哪里

小窗口控制当轮输入。PowerContext 将成功的文本问答交给后台整理，再按新问题召回相关证据，让应用不必每次把完整聊天都带给模型，也能接上较早的经历。

![PDF 原图：固定千轮初始历史后，复用次数增加时的费用变化](docs/assets/benchmarks/reuse-cost.zh.png)

所提供的《教你如何多快好省来养大肥鱼》使用合成对话和真实模型调用，几个结果回答的是不同问题：

| 实验                                  | 观察结果                                  | 适用条件                                                         |
| ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| 140 回合回放：原生近期 10 轮改为 4 轮 | 聊天输入减少 **35.8%**                    | 小窗口答中旧事实 0/25；加入记忆达到 25/25，也增加了开销          |
| 固定 1000 轮初始历史，复用 100 次     | 已知生成输入减少 **88.9%**                | 对照是每次携带全历史，不是默认原生 10 轮                         |
| 同一复用实验，计入整理与维护          | 已知费用估算 **¥4.73 对 ¥6.99，低 32.3%** | 历史价格估算；回答结果不同，对照还有七次未计价调用，不是实际账单 |

长期记忆不会自动更便宜，短对话和大批历史的初次导入可能更贵。请连同[完整实验、原图与限制](docs/zh/explanation/memory-and-cost.md)一起看，再按[用量控制指南](docs/zh/guides/token-budget.md)调整自己的桌宠。

## 数据与控制权

记忆默认关闭，按需开启。本机记忆首次设置采用近期 4 轮、近期正文 6000 字节和召回正文 4096 字节。字节不是 token，后台抽取、输出、重试和其他功能还有各自的费用。

- **已同步**只表示对话送达 PowerContext，不代表抽取完成或一定能召回。
- **暂停**保留数据；**遗忘**将原子记忆移出召回，来源和历史版本仍保留。删除本机聊天不会删除远端证据。
- 本机记忆在宿主的 `$DSH_HOME/dsh-pet/powercontext/` 下运行，远程模型仍会收到生成和 Embedding 所需文本。
- 只采集桌宠对话，尚未给 DSH 编程 Agent 会话接入记忆，也不会自动导入旧聊天。

[启用、验证与管理记忆](docs/zh/guides/memory.md)

## 文档与开发

| 下一步       | English                                                                                  | 简体中文                                                                      |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 跟着教程使用 | [First pet](docs/en/tutorials/first-pet.md)                                              | [养好第一只桌宠](docs/zh/tutorials/first-pet.md)                              |
| 配置与排障   | [Guides](docs/en/README.md#do)                                                           | [操作指南](docs/zh/README.md#解决具体问题)                                    |
| 接入其他应用 | [HTTP](docs/en/reference/http-api.md) · [Cordis](docs/en/reference/cordis.md)            | [HTTP](docs/zh/reference/http-api.md) · [Cordis](docs/zh/reference/cordis.md) |
| 开发与发布   | [Development](docs/en/reference/development.md) · [Releases](docs/en/guides/releases.md) | [开发](docs/zh/reference/development.md) · [发布](docs/zh/guides/releases.md) |

源码位于内层 `dsh-pet/` 包目录：

| 目录                  | 职责                                   |
| --------------------- | -------------------------------------- |
| `src/host/`           | 配置、HTTP 路由、聊天、队列与 DSH 接入 |
| `src/client/`         | 角色渲染、设置和聊天界面               |
| `src/shared/`         | 共享类型、动画与交互规则               |
| `src/standalone/`     | 独立应用、模型设置与本机记忆生命周期   |
| `runtime/`、`assets/` | Electron 外壳与角色素材                |

## 致谢与许可

代码采用 [MIT 许可](LICENSE)。角色形象、动画、提示词与源视频遵循[单独的许可和署名要求](dsh-pet/ASSET-LICENSE.md)，包括上游注明的 CC BY-NC-SA 4.0，不适用代码许可。

鲸鱼娘是社区二创形象，并非 DeepSeek 官方角色。原型“溟月”：[上善无形](https://space.bilibili.com/4456176)；女仆鲸鱼娘设计：[ZipZipPipe](https://space.bilibili.com/4168597)；原版桌宠：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；长期记忆：[PowerContext](https://github.com/oceanbase/powercontext)。
