# Astra 2.0 → 桌宠：语音、文字与动作对接说明书

适用对象：Astra 2.0 机器人端开发和联调工程师。适用代码：`codex/astra-mcp` 分支新增的 `POST /dsh-pet-7340/robot/input`，安装旧版本没有此入口。

## 1. 对接流程与职责

机器人采集一句话，把**最终识别文本**或**完整录音**通过 HTTP JSON 发给桌宠。桌宠可生成回答并显示气泡、播报、展示动画，也可直接播报机器人已生成的内容。

- `mode: "chat"`：输入是用户问题。录音先 ASR，再调用桌宠现有对话与记忆服务；回答使用桌宠配置的音色和自动动作。
- `mode: "say"`：输入是需要桌宠复述的内容。录音先 ASR，再用桌宠音色重新合成；不是原始录音播放，也不调用聊天模型。可指定桌宠动画。
- 机器人端负责麦克风采集、断句和发送；桌宠不通过 MCP 拉取麦克风。现有机器人 MCP 提供 TTS、导航、示教程序等输出控制，不提供语音上行接口。
- 这里的 `animation` 是屏幕桌宠动作。实体机器人动作沿用现有 MCP 配置和逐次人工确认，不会因收到语音直接执行。

原来已有 `/voice/hear`、`/chat`、`/broadcast`、`/anim` 等独立能力；新增入口把识别与桌宠呈现串在一起。直接复述会标记来源，避免开启机器人语音同步后再次发送到机器人扬声器。聊天生成的新回答仍可按机器人配置同步。

## 2. 桌宠端准备

1. 启动包含本功能的桌宠版本，保持目标桌宠渲染窗口运行。
2. 在设置中选定宠物及显示位置，获取实例 ID（不是角色名称）。可通过已认证的 `GET /dsh-pet-7340/config` 检查宠物配置；动画名称来自该角色的 `animations` 配置，不能自行编造。
3. 聊天模式沿用现有输出位置选择：宠物同时显示在两端时优先在桌面播报，surface 不覆盖这个选择。配置可用的聊天模型；开启 `main.voiceEnabled`，选择可用音色，开启角色的 `chatAnimationEnabled` 才会自动展示模型选择的动作。
4. 音频输入配置 `main.speechProvider` 和识别服务凭据。通过 `GET /dsh-pet-7340/voice/hear-providers` 查询实现 ID；内置 DeepSeek 识别所用密钥独立于聊天模型密钥。目录存在不代表凭据和网络已经可用。
5. 通过 `GET /dsh-pet-7340/voice/voices` 检查音色目录。网页端先进行用户交互以允许音频播放；电脑输出设备需可用。

### 地址与认证

Standalone 监听本机回环地址。运行信息在 `$DSH_HOME/dsh-pet/standalone-runtime.json`（实际 DSH 数据目录）中，包含本次进程的 `port` 和 `token`。受保护请求使用 `X-DSH-Pet-Token` 请求头。该文件和 token 是凭据，请勿放入代码、文档、截图或日志；重启后重新读取。

机器人与桌宠不在同一电脑时，可在机器人侧建立 SSH 本地转发：

```bash
ssh -N -L 13080:127.0.0.1:<桌宠实际端口> <用户>@<桌宠电脑>
```

以下示例在机器人侧运行，`PET_BASE=http://127.0.0.1:13080/dsh-pet-7340`。同机可直接使用实际端口。通过双方认可的安全方式提供 token；不要通过关闭认证或放开所有 Origin 来接入。

DSH 插件模式使用 DSH 实际地址和 `/dsh-pet-7340` 前缀，按部署的 DSH 认证方式连接，不能用 standalone token 替代宿主认证。

## 3. 请求契约

`POST <PET_BASE>/robot/input?pet=<实例ID>&surface=desktop&session=astra-demo`

`Content-Type: application/json`。`pet` 必填；`surface` 必须是 `desktop` 或 `web`，并与该宠物显示配置匹配。`session` 可选，最长 256 字符，用于已有会话记忆绑定。

| 字段        | 类型    | 约束                                                     |
| ----------- | ------- | -------------------------------------------------------- |
| `text`      | string  | 与 audio 二选一；去首尾空白后 1–2000 个 UTF-16 单元      |
| `audio`     | string  | 完整 WAV 的标准 Base64，无 data URI 前缀；与 text 二选一 |
| `provider`  | string  | 可选，仅音频输入；识别实现 ID，省略使用配置值            |
| `mode`      | string  | chat（默认）或 say                                       |
| `animation` | string  | 可选，仅 say；必须是目标角色已注册动画名称               |
| `speak`     | boolean | 可选，仅 say；默认 true；false 仅显示气泡和动画          |

音频要求：**16 kHz、单声道、16-bit PCM WAV**，包含 WAV 文件头，解码后不超过 **7 MiB**。HTTP 请求体上限 **10 MiB**。不接受流式音频帧、裸 PCM、MP3 或仅改扩展名的文件。推荐一次提交一句短录音；转写后仍受 2000 字符限制。

## 4. 可运行示例

先设置环境变量（token 由安全渠道注入，不写死）：

```bash
export PET_BASE='http://127.0.0.1:13080/dsh-pet-7340'
export PET_ID='实际宠物实例ID'
# PET_TOKEN 由运行环境安全注入
```

发送文字，让桌宠回答：

```bash
PET_QUERY=$(python3 -c 'import os; from urllib.parse import urlencode; print(urlencode({"pet":os.environ["PET_ID"],"surface":"desktop","session":"astra-demo"}))')
curl --fail-with-body "$PET_BASE/robot/input?$PET_QUERY" --request POST \
  -H "X-DSH-Pet-Token: $PET_TOKEN" -H 'Content-Type: application/json' \
  --data-raw '{"mode":"chat","text":"你好，请介绍一下你自己"}'
```

建议工程集成使用下面的 Python 标准库客户端，可统一处理文字、录音和动画；避免在命令行拼接大段 Base64：

```python
import base64
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

base = os.environ["PET_BASE"].rstrip("/")
query = urlencode({"pet": os.environ["PET_ID"], "surface": "desktop", "session": "astra-demo"})

def send(payload):
    request = Request(
        base + "/robot/input?" + query,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-DSH-Pet-Token": os.environ["PET_TOKEN"]},
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        result = json.load(response)
    if not result.get("ok"):
        raise RuntimeError((result.get("reason"), result.get("message")))
    return result

# 选择一种调用；不要把同一句话同时按文字和录音重复发送。
print(send({"mode": "chat", "text": "你好"}))
# print(send({"mode": "chat", "audio": base64.b64encode(Path("utterance.wav").read_bytes()).decode("ascii")}))
# print(send({"mode": "say", "text": "欢迎来到展厅", "animation": "替换为已注册动画名称", "speak": True}))
```

### 返回值与完成判断

聊天成功示例：`{"ok":true,"inputText":"你好","text":"你好，很高兴见到你"}`。

指定动画的复述成功示例：`{"ok":true,"inputText":"欢迎","text":"欢迎","playbackId":"实际回执ID"}`。

无识别文字（静音）：`{"ok":true,"inputText":"","skipped":true}`，不生成回答、不播报、不播放动画。

`ok:true` 表示已处理或下发，不保证扬声器已发声。指定动画返回的 `playbackId` 可用已认证的 `GET <PET_BASE>/playback/<playbackId>` 查询，检查 `status`；无渲染窗口时可能停在 `accepted`，不能视为完成。本入口没有 TTS 播放完成回执；音画按现有渲染机制触发，不保证口型、音频与动画帧精确同步。

## 5. 错误处理与联调验收

业务失败一般是 HTTP 200 + `ok:false`，必须检查 JSON，不可只检查 HTTP 状态。常见原因包括 `bad-request`（字段或长度错误）、`unknown-pet`、`pet-not-displayed`、`unknown-animation`、锁占用、睡眠阻止、`unsupported`（无识别服务）、`provider-missing`（无聊天服务）和 `generate-error`。无效 JSON 返回 400；认证失败、请求过大分别可能返回 401/403、413。

每次只发最终识别结果，不发逐字中间结果。一个客户端串行发送，一次等待一句完成；入口不提供请求去重、持久队列或幂等键。超时、断线后不要自动重发，否则可能重复说话或重复生成回答。ASR 期间取消会阻止后续分发；已开始的聊天、TTS 或动画不保证随 HTTP 断开撤销。机器人侧应在播报时暂停拾音或进行回声消除，避免扬声器声音再次成为输入。

双方按以下顺序联调并记录结果：

1. 认证通过，桌宠实例和显示位置正确。
2. 文字 chat：桌宠返回回答、气泡显示、电脑实际可听到声音；开启自动动作后观察动画。
3. WAV chat：说一句短话，检查 inputText 与实际语音一致，再确认回答和播报。
4. say + 已注册 animation：屏幕动画播放，回执变化；开启机器人语音同步时，直接复述不应重新发送至机器人 TTS。
5. speak=false：显示文字与动作，不播放本地 TTS。
6. 空音频识别、错误格式、双输入、未知动画、错误 pet/surface、缺少凭据、请求中途取消均有可解释结果。
7. 实测机器人麦克风、电脑扬声器、网络延迟与回声控制；协议单测不替代这些现场验收。

本仓库的自动测试覆盖路由分发及异常路径；实际 ASR/TTS 服务、机器人麦克风和实体设备仍需双方现场验证。
