# 小智机器人与桌宠对话

从 DeepSeek Harness 右侧的「桌宠对话 → 小智机器人」启用联动。桌宠发言可由小智设备播报，聊天也可选择已映射的设备动作。独立版桌宠使用同一面板。

桌宠未单独指定聊天模型时，使用 Harness 选中的默认模型及其登录账号或 API Key。小智的 API Token 只用于设备 OpenAPI 鉴权。播报使用小智后端配置的 TTS，直接朗读桌宠原文，不经过小智的聊天模型。

## 连接小智自建服务

1. 将小智设备接入自建服务，并配置服务端 TTS。在管理台创建 API Token，记下设备列表里的数字 `id`。适配器使用 Go 后端的设备工具发现、工具调用和语音推送接口。[参考后端版本](https://github.com/hackers365/xiaozhi-esp32-server-golang/tree/d2eafd5eaf9454d5f7d40d30f8cf5ca4d3e2ee65)
2. 启动 DeepSeek Harness 或独立版桌宠之前，在宿主进程环境设置 `DSH_PET_XIAOZHI_OPENAPI_URL`（例如 `https://xiaozhi.example.com/api/open/v1`）和 `DSH_PET_XIAOZHI_API_TOKEN`。使用自建服务签发的 API Token。修改后重启宿主。
3. 在机器人连接设置中选择「小智机器人」，填写设备 ID，启用并保存。点击「检查连接」读取设备当前可用的 MCP 工具。
4. 在「手动控制」中输入一句话测试播报。开启「机器人播报桌宠发言」后，新产生的桌宠回复、碎碎念和梦话会排队送到该设备进行单向播报。

## 映射设备动作

在「高级设置」中添加动作。从设备工具列表选择目标，再填写聊天中使用的动作名和固定 JSON 参数。无参数的工具填写 `{}`。保存后打开「允许对话触发机器人动作」。例如，具备抬手工具的设备可将该工具映射为「抬手」，随后在桌宠对话说「抬手」，并确认本轮动作。也可显式启用直接执行模式，串行下发明确匹配的动作。

Bread Compact Wi-Fi 的默认 2.5.3 固件注册了 GPIO 灯工具，可以先用对应工具验证动作链路。抬手需要实际执行机构以及固件提供对应 MCP 工具。[板级固件](https://github.com/78/xiaozhi-esp32/blob/d7a1c05308fb/main/boards/bread-compact-wifi/compact_wifi_board.cc)

## 官方云接入点

`wss://api.xiaozhi.me/mcp/` 用于向小智智能体提供外部工具。该连接由小智发起工具调用。要从桌宠主动发送指令和播报，当前适配器使用自建服务的设备 OpenAPI。[小智 MCP 快速开始](https://docs.xiaozhi.me/zh/mcp/quickstart.html)

| 源码 | 职责 |
| --- | --- |
| `src/host/robot/xiaozhi.ts` | 设备工具发现和校验、精确设备路由、单向语音推送 |
| `src/host/robot/service.ts` | 对话动作确认、串行执行、播报队列和回执 |
| `src/client/robot/settings.ts` | 机器人类型、设备 ID 和对话联动设置 |
