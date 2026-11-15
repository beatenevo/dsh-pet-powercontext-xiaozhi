# Media sources / 图文来源

Only final documentation assets live here. Raw PDF extraction, capture scripts, test homes and logs stay outside the repository. 本目录只放最终文档素材，PDF 提取、截图脚本、测试目录和日志均保存在仓库外。

## Live comparison and traces / 对照与调用链实拍

Captured on **2026-11-15** in Linux x86_64 Chromium at **1600 × 1000**, using **DSH 0.2.2-rc.1**, the pet preview built from **`2e080f1`**, **PowerContext `1.5.2.dev148+gfa80ab6b2`** with SQLite, and local **AI Vision `7941fb6c2cf8a4d7e9dd692c4f97efed1066c1fe`** with its Collector, SigNoz and OceanBase. The pet preview was installed as a package in a separate DSH web profile. The published npm `0.1.0-beta.1` does not contain the comparison or AI Vision features.

以上截图于 2026-11-15 在 Linux x86_64 Chromium 中采集，原始视口为 1600 × 1000。使用 DSH 0.2.2-rc.1、`2e080f1` 构建的桌宠预览包、采用 SQLite 的 PowerContext `1.5.2.dev148+gfa80ab6b2`，以及本机 AI Vision `7941fb6c2cf8a4d7e9dd692c4f97efed1066c1fe` 和对应的 Collector、SigNoz、OceanBase。预览包安装在独立 DSH web profile 中；npm 已发布的 `0.1.0-beta.1` 不含对照和 AI Vision 功能。

| Asset | Content / 内容 |
| --- | --- |
| `screenshots/dsh-live-memory.zh.png` | Complete DSH workspace, pet and two generated facts from ordinary pet dialogue / 完整 DSH 工作区、桌宠与普通桌宠对话生成的两条事实 |
| `screenshots/dsh-token-comparison.zh.png` | Completed 13-question comparison with answers and measured input totals / 13 题完成后的回答对照与实测输入汇总 |
| `screenshots/dsh-token-first-batch.zh.png` | First six questions, where memory overhead increased observed input / 首批六题，记忆开销导致已报告输入增加 |
| `screenshots/dsh-token-details.zh.png` | Answer usage, preparation and cumulative memory overhead / 回答用量、一次性准备及累计记忆开销 |
| `screenshots/ai-vision-pet-trace.zh.png` | A separate ordinary pet-chat trace with actual PowerContext Server spans / 单独的普通桌宠聊天轨迹，包含真实 PowerContext Server 节点 |

All five PNGs are byte-for-byte copies of the original browser captures, checked against the capture manifest's SHA-256 digests. No UI, answer, status or usage value was edited. Both READMEs use the same Chinese UI captures. The AI Vision side-panel backdrop is blurred by the application itself, not by image editing. No credentials are visible. Capture scripts, raw recordings, exports, test datasets and runtime files remain outside the repository.

五张 PNG 均逐字节复制自原始浏览器截图，并与采集清单中的 SHA-256 核对一致。未修改界面、回答、状态或用量值。中英文 README 共用原始中文界面。AI Vision 侧面板背后的模糊效果来自应用本身，不是后期修图。截图中没有可见凭据；采集脚本、原始录屏、导出文件、测试数据集和运行数据均留在仓库外。

The **雨燕 (Swift)** project, budget and other facts are fictional demonstration inputs. Generation and embeddings used real `qwen3.7-plus` and `qwen3.7-text-embedding` endpoints through a local forwarding proxy, without mocked responses. The ordinary-chat screenshots show two generated memories and a separate recall trace. They are not measurements from the comparison's isolated Scope.

“雨燕”项目、预算及其他事实是虚构演示输入。生成与向量化通过本地转发代理调用真实 `qwen3.7-plus` 和 `qwen3.7-text-embedding` 服务，未替换响应。普通聊天截图展示两条已生成的记忆及单独的召回轨迹，不属于对照实验独立 Scope 的测量。

The comparison used a fixed **21,599-byte** background, a **512-byte** recent-history budget and **six generated memories**. Six initial questions plus seven follow-ups produced 39 completed answers across three strategies. Full-background and memory answers met the stated requirements for all 13 questions; the short-history control met only the deliberately unanswerable question. Six facts were each asked in two phrasings, so this is not a general accuracy benchmark. It also does not measure DSH task-agent execution or its default compaction policy.

对照使用固定的 21,599 字节背景、512 字节近期窗口预算与六条已生成的记忆。首批六题加七道后续问题，三种策略共完成 39 个回答。完整背景和记忆策略的 13 个回答均符合题目要求；短历史控制组只在刻意设置的无答案题上符合要求。六个事实各用两种说法提问，不能据此推导普遍准确率，也没有测量 DSH 任务 Agent 执行或其默认压缩策略。

Including memory overhead, reported input **increased 65.4%** after the first six questions (28,322 → 46,851). After 13 questions, answer input was **61,387 vs. 11,944** (80.5% less). Memory generation added **40,632 input** and cumulative embeddings added **1,065 input**, making **53,641**, or **12.6% less reported input** overall. Preparation is counted once; its 674 embedding-input tokens are already included in the cumulative 1,065.

计入记忆开销后，首批六题的已报告输入增加 65.4%（28,322 → 46,851）。累计 13 题的回答输入为 61,387 对 11,944，减少 80.5%；加上记忆生成输入 40,632 和累计向量化输入 1,065，总计 53,641，已报告输入减少 12.6%。准备只计一次，其中向量化输入 674 已包含在累计 1,065 中。

Known output increased from **312** to **7,002** tokens including memory generation. Embedding output was unreported, so this does not establish complete input-plus-output savings or lower billing. The full-background model reported **41,472 cache-read input tokens** in its raw usage; the comparison screenshot displays cache usage as unknown. Cache and model prices further prevent deriving a bill from these input percentages. The AI Vision screenshot is a separate 10-span chat trace with two retrieved memories; its known subtotal of 1,265 tokens is not the comparison total.

计入记忆生成后，已知输出从 312 增加到 7,002 Token。向量化输出未报告，因此不能据此证明完整输入加输出减少或金额节省。完整背景模型的原始用量报告包含 41,472 个缓存读取输入 Token，对照截图中的缓存值显示未知；缓存与不同模型的单价也使输入比例不能直接换算为账单。AI Vision 截图是单独的十节点聊天轨迹，检索返回两条记忆；其已知小计 1,265 Token 不是对照实验总量。

See the [English comparison guide](../en/guides/token-comparison.md) / [中文对照指南](../zh/guides/token-comparison.md) and [AI Vision setup](../en/guides/observability.md) / [AI Vision 接入](../zh/guides/observability.md). These captures establish the local Linux browser demonstration, not native-installer, other-platform or production acceptance.

操作步骤见以上双语指南。截图展示的是本机 Linux 浏览器链路，不代表原生安装器、其他平台或生产部署已通过验证。

## Live DSH recordings / DSH 实录

Captured on **2026-11-11** in Linux Chromium, using the `codex/bilingual-docs-refresh` working tree at capture time (based on `c62030d`), `dsh-pet-powercontext@0.1.0-beta.1`, **DSH 0.2.2-rc.1** and **PowerContext 1.5.0**. The installed plugin's built files were checked against that working tree. All product views below are from the full DSH web application, with its workspace, agent session and pet plugin.

以上素材于 2026-11-11 从完整 DSH 浏览器界面采集，使用当时基于 `c62030d` 的 `codex/bilingual-docs-refresh` 工作区，保留工作区、Agent 会话和桌宠插件。安装到演示宿主的构建文件已与采集时的工作区核对一致。

| Asset | Content / 内容 |
| --- | --- |
| `demos/dsh-chat.gif` | Send a message, receive a real reply and see the pet animate inside DSH / 在 DSH 中发送消息、接收真实回复和观看桌宠动作 |
| `demos/dsh-memory-recall.gif` | Ask again with zero recent rounds, then open the extracted memory list / 近期聊天为零轮时再次提问，并展开抽取后的记忆列表 |
| `screenshots/dsh-chat.en.png` | Full-size chat view / 原尺寸聊天截图 |
| `screenshots/dsh-facts.en.png` | Recalled answer and extracted facts / 召回回答与抽取后的事实 |
| `screenshots/dsh-sources.en.png` | Original dialogue behind a memory / 记忆关联的原始对话 |
| `screenshots/dsh-settings.en.png` | Pet settings in the same DSH session / 同一 DSH 会话中的桌宠配置 |
| `screenshots/dsh-memory.en.png` | Managed memory service ready / 已就绪的托管记忆服务 |

The project name **Moonleaf** and preference for **jasmine tea without sugar** are fictional demo inputs. DSH chat, pet chat, extraction and embeddings used the configured real provider (`qwen3.7-plus` and `qwen3.7-text-embedding`). A local forwarding proxy routed requests to that provider and allowed private request inspection; it forwarded actual provider responses, without fixtures or mocked model output. Credentials are not visible in the published captures.

Moonleaf 和“无糖茉莉花茶”是虚构演示信息。DSH 聊天、桌宠聊天、记忆抽取及 Embedding 均调用实际配置的模型服务；本地转发代理用于连接该服务并核对请求，未替换模型回复；公开素材中没有可见凭据。

After background extraction produced the project and preference memories, **Chat history rounds was set to 0** through the settings UI. The recall request contained the persona, PowerContext's prepared memories and the new question, with no earlier chat turns. The pet answered both facts correctly, and the memory list linked back to the original exchange. This demonstrates one working capture → extraction → recall flow, not a recall-quality benchmark or a restart test.

后台生成项目名与偏好记忆后，通过设置页将近期聊天设为 0 轮。实际召回请求只包含人设、PowerContext 准备的记忆和新问题，没有早先的问答；两项均回答正确，来源指向原始对话。本次展示的是一条实际跑通的采集、抽取、召回流程，不是准确率基准或重启验证。

GIFs are sampled captures of the actual browser, encoded at 1200 px width with original elapsed timing and a final-frame pause. PNGs retain the original viewport. No UI text, model answers or memory status was replaced; currently mixed-language controls are preserved. The first clip and the later recall clip are separate recordings; background processing and intervening conversation are not shown in full. Credentials, raw requests, scripts, recordings and test data remain outside this repository. Only the final documentation media is included here.

GIF 来自真实浏览器画面采样，宽度压缩为 1200 像素，保留实际时间间隔并在末帧停留；PNG 保留原始视口。未替换界面文字、模型回答或记忆状态，保留原有中英文控件。聊天和后续召回分别录制，中间的后台处理与聊天未完整展示。凭据、原始请求、脚本、原始录屏和测试数据都留在仓库外，这里只收录最终文档素材。

## Astra tutorial screenshots / Astra 教程截图

Captured on **2026-11-13** in Linux Chromium with **DSH 0.2.2-rc.1** and the Linux x64 slim package built from commit **`faa9197`**. The package was installed into a fresh DSH web profile using `dsh plugin --profile web add` with the local `.tgz`. The complete DSH interface is shown in Chinese, with a selected workspace, the pet and its chat panel.

以上截图于 2026-11-13 在 Linux Chromium 中实拍，使用 DSH 0.2.2-rc.1 和 `faa9197` 构建的 Linux x64 精简包。通过 DSH CLI 将本地包安装到全新 web profile 后采集，保留完整 DSH、工作区、桌宠与聊天面板。

| Asset | Content / 内容 |
| --- | --- |
| `screenshots/dsh-astra-panel.zh.png` | Robot controls expanded, with monitoring disabled / 展开机器人操作区，连接监测未启用 |
| `screenshots/dsh-astra-settings.zh.png` | Connection fields and bundled-runtime selection / 连接配置与内置运行环境选项 |

No model credentials, robot address or action IDs were configured. No physical robot was connected and no robot commands were sent. Interface text and state were not replaced. Only these final PNGs are committed; the temporary host, browser profile, capture commands and logs remain outside the repository.

未配置模型凭据、机器人地址或动作 ID，未连接实体机器人，也未发送机器人指令。界面文字与状态未替换。仓库只保存两张最终 PNG；临时宿主、浏览器数据、截图命令与日志均保存在仓库外。

## Supplied report / 用户提供的报告

Source: **教你如何多快好省来养大肥鱼.pdf**, 18 pages, supplied for this documentation task. SHA-256: `94d999e2c1e3d2aa321ba4242e2156a7ee18e93dc6027f5e21e84bd1961d70ef`. The PDF itself is not copied into the repository.

来源为本次任务提供的 18 页 PDF；原件不复制到仓库。以下素材直接提取，保留原图：

| Asset                                | PDF page | Meaning / 含义                                                                              |
| ------------------------------------ | -------: | ------------------------------------------------------------------------------------------- |
| `benchmarks/scale-accuracy.zh.png`   |       15 | Hits, misses and failures for 30 planned questions / 30 个计划问题的答中、未答中与失败      |
| `benchmarks/scale-usage.zh.png`      |       16 | Known generation usage including preparation and maintenance / 含整理与维护的已知生成用量   |
| `benchmarks/reuse-cost.zh.png`       |       17 | Fixed-history reuse cost curves / 固定历史的复用费用曲线                                    |

The report's setup instructions refer to an older integration commit (`ce18f9347528e47950e0c39d0097c1e180168e57`). Its screenshots are not presented as captures of the current setup wizard. Current installation commands are maintained in the bilingual installation guide.

PDF 安装部分引用旧集成提交；其中的历史界面不冒充当前设置页。当前安装命令以双语安装指南为准。

`benchmarks/reuse-summary.en.svg` is a new English plot of the PDF's stated 100-question totals: approximate known input 1.14M vs 10.26M tokens, and estimated known cost CNY 4.73 vs 6.99. It does not digitize or infer intermediate curve points. 图中的英文摘要只使用 PDF 明示的终点数值，没有推测中间点。

Read [the full English evidence](../en/explanation/memory-and-cost.md) or [中文实验说明](../zh/explanation/memory-and-cost.md) with the figures. These are historical reported experiments, not a new run, a billing receipt, or a guarantee of savings.

## Character assets / 角色素材

Character artwork and animations shown in the recordings retain the [upstream credits and terms](../../dsh-pet/ASSET-LICENSE.md). 录屏中的动画和角色素材继续遵循上游署名及授权，不因用于文档而变更许可。
