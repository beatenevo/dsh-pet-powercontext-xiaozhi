# 用 AI Vision 观测桌宠与 PowerContext

[English](../../en/guides/observability.md)

本文描述当前源码构建；正文采集、后台过滤与同 Trace 记忆写入需使用包含这些改动的版本。观测为可选功能；关闭观测、未配置密钥或采集端不可用，都不应阻止聊天、记忆降级、语音或已有机器人控制。

## 连接平台

1. 部署 [AI Vision](https://github.com/ob-labs/ai-vision-ob)，使用 SigNoz 数据源。PowerContext 原生记忆视图需要配套 SigNoz 的 `/api/v1/ai-vision/memory/operations` 能力，并保留 instrumentation scope。可以使用兼容 Langfuse SDK 的接入端点，但 Langfuse 存储数据源不支持这项原生扫描。
2. 在 AI Vision 空间内创建 Agent，配置其 SigNoz 数据源，从平台获取 **Agent UUID**、**Space UUID** 和 **SpaceKey**。这些不是模型 API 凭据。
3. DSH 模式：打开桌宠设置，找到 **AI Vision 可观测性**。独立模式：打开本机设置窗口，选择 **AI Vision**。
4. 填写平台基础地址、Agent UUID、Space UUID 和 SpaceKey，启用观测，点击 **保存观测配置**。默认使用 HTTPS，允许本机回环 HTTP。可信内网使用 HTTP 时需显式勾选对应选项。地址不能包含凭据、查询参数或片段。
5. 点击 **测试链路导出**。接受成功表示带身份认证的接入端接受了 OTLP 请求。打开生成的交互，确认平台实际存储且能够查询；仅上传成功不能证明这一点。

密钥仅写入，保存在桌宠私有数据目录中的 `observability.json`，不在 npm 安装目录里。GET `/config` 和观测状态都不回传密钥。同一地址、Agent 和空间下，密钥留空表示保留；修改其中任意一项后需重新填写密钥。删除时先关闭观测，勾选 **删除已保存的密钥**，再保存。查看链接使用 AI Vision 正常登录，不携带凭据。

## 纳入 PowerContext Server 操作

桌宠产生自己的操作 span，并向 PowerContext 传递 W3C `traceparent`。要看到 Server 的原生准备与搜索阶段，Server 也必须向同一 AI Vision Agent／数据源导出链路。为 PowerContext 安装 `tracing-otlp` 扩展，在启动环境中配置：

```dotenv
POWERCONTEXT_SERVER_TRACING_ENABLED=true
OTEL_TRACES_SAMPLER=parentbased_always_off
OTEL_SERVICE_NAME=powercontext-server
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://vision.example/api/public/otel/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic%20BASE64_OF_AGENT_UUID_COLON_SPACE_KEY
```

替换示例地址，在本机把 `AgentUUID:SpaceKey` 编码为 base64。结果只存入 Server 私有环境，不要写入仓库或发送到聊天中。`%20` 是 OTel 请求头环境变量格式中的空格编码。使用这组环境重启 Server。安装桌宠不会修改独立管理的 Server 导出配置。这个端点接收链路，不接收日志或指标；Prometheus `/metrics` 和运行日志需要单独配置采集。

- **独立连接 PowerContext：** 召回 HTTP 请求携带当前桌宠 span 的父级身份。对话 Source 仅在本地附带用于后续后台投递的因果引用；追踪引用不进入 Source 正文。
- **共享 DSH PowerContext：** 安装支持 `powercontext.companion-memory.v1` 可选 `traceContext` 字段的 `powercontext-dsh` 构建。它复用已有认证客户端，将父级传递给 `prepare_context`。旧插件可能忽略该字段，召回仍可用，但 Server 链路可能分离。本次扩展不关联工作区绑定请求。共享模式仍然只读，不把桌宠对话采集到项目中。
- **原生记忆：** 不会产生 PowerContext Server 链路，保留已有提供者行为。

本机自动安装的服务会在启动时读取观测配置，保存后暂停再恢复记忆即可应用。默认保留有父链路的问答、对照请求及其中的 SQL 节点；无父链路的健康检查、记忆列表/来源/纠错/遗忘和后台任务不创建独立 Trace。需要排查这些操作时，开启 **采集后台与管理操作** 并重启记忆服务。不要通过关闭 `POWERCONTEXT_SERVER_TRACING_ENABLED` 过滤健康检查，否则 SQL 观测也会关闭。独立部署的服务需自行配置上面的 sampler。

## 用真实交互演示

将真实 DSH 对话与桌宠窗口放在 AI Vision 旁边。向桌宠发送一条消息，然后打开 **最近交互 → 查看本次交互**。聊天链路包含召回和各次模型调用；在本机保留对应近期身份期间，回复／碎碎念的自动语音合成会关联到原交互。手动语音请求和机器人命令执行各有独立链路。观测不会触发任何机器人动作。

独立记忆模式下，**memory.capture** 沿用原聊天的 Trace ID，以原聊天 span 为父级；后台提交不阻塞回复。Trace 的总时间范围可能延伸到后台提交完成，聊天 span 的耗时仍表示回复耗时。更早版本保存但没有追踪引用的待发送记录，默认不会新建后台 Trace。分别确认 Source 接受、后续提炼和召回。点击 **打开记忆观测** 使用已有原生记忆视图。界面不会编造记忆数量、完成百分比或 Token 节省比例。

面板在进程内存中保留最近 30 次根交互，显示其中十次。随机生成的会话身份在进程运行期间按桌宠和 DSH 会话归组，重启或修改配置后重置。不会导出原始本地分区键、工作区路径或会话名称。面板用于查看近期活动，不是持久化审计历史。

## 理解观测证据

| 观测项                         | 含义与边界                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 聊天与模型尝试                 | 实测操作耗时和成功／失败；降级前失败的模型尝试单独保留。                                                                                                                                 |
| Token 用量                     | 只使用提供商返回的计数。DSH 的未缓存输入与缓存读取／写入合并一次得到 GenAI 输入。缺失计数保持未知；计数不等于账单。适配器保持原有请求参数；服务商未在流中返回用量时，不显示 Token 计数。 |
| 召回 ready／empty／unavailable | 桌宠边界上的实际结果。搜索命中证据来自 PowerContext 报告的搜索阶段，不按响应长度猜测。                                                                                                   |
| 采集 accepted                  | Source 提交成功，不代表记忆已提炼或发布。后台合成不在 AI Vision 首版原生记忆适配器范围内。                                                                                               |
| 语音                           | 合成／识别结果，不证明用户听到了播放。                                                                                                                                                   |
| 机器人                         | SDK 工作进程返回结果，不证明实体已经移动或完成动作。                                                                                                                                     |
| 接入端已接受                   | 端点确认接收；存储和页面回读需另行验证。                                                                                                                                                 |

AI Vision 默认关闭。全新配置中，**向 AI Vision 发送当轮输入与回复** 默认勾选，可在启用前取消，也可随时关闭；启用并保存后，当前用户文本和最终回复通过 `gen_ai.input.messages` / `gen_ai.output.messages` 导出，每条最多 4000 字符，截断会标记 `dsh_pet.content.truncated`。平台可据此展示预览与消息步骤。只影响之后的调用，不会补齐历史 Trace；关闭后停止后续采集，不删除已经导出的内容。输入和回复本身可能含私人信息。已保存的正文开关在升级、关闭再启用后保持不变；旧配置若没有该字段，仍不采集正文，不会因升级自动开启。

不导出完整系统提示词、拼接的历史与召回记忆、音频、图片、连接凭据或原始异常。桌宠直接问答没有执行工具时，不会编造工具步骤。对照实验保留 prepare 和各策略 answer 链路，通过实验身份、策略与轮次区分；缺失的提炼、向量化或模型用量仍为未知，不用问答 Token 小计冒充总成本。

导出器使用私有 OTel provider，队列最多 256 个 span，单批最多 64 个，并限制导出等待时间。它不注册全局 provider，也不替换 `observ-dsh`；后者继续负责 DSH 任务／会话观测。npm 包包含 JavaScript 导出依赖和可选的 Python 服务入口；不捆绑 AI Vision、SigNoz、Python 解释器或 PowerContext，桌宠不会自动启动第二个 Server。

双栏回答与实际用量展示见 [DSH Token 对照](token-comparison.md)。

[seekdb 真实 SQL 链路部署与验证](seekdb-tracing.md)。
