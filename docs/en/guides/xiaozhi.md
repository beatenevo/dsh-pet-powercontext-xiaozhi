# XiaoZhi robot and pet chat

Open **Pet chat → XiaoZhi robot** in DeepSeek Harness. The same panel is available in the standalone app. A bound device can speak new pet utterances and run mapped device actions from chat.

Unless a chat model is set for the pet, replies use the default model in Harness with its configured sign-in or API key. The XiaoZhi API token authorizes device OpenAPI requests. The backend's TTS reads the pet's reply directly without running it through the XiaoZhi chat model.

## Connect a self-hosted XiaoZhi service

1. Connect the device to the self-hosted service and configure server-side TTS. Create an API token in its management console and copy the numeric device record `id` from its device list. The plugin uses the Go backend's device tool discovery, tool call, and speech push endpoints. [Reference backend revision](https://github.com/hackers365/xiaozhi-esp32-server-golang/tree/d2eafd5eaf9454d5f7d40d30f8cf5ca4d3e2ee65)
2. Set `DSH_PET_XIAOZHI_OPENAPI_URL` (such as `https://xiaozhi.example.com/api/open/v1`) and `DSH_PET_XIAOZHI_API_TOKEN` in the host process environment. Restart the host after changing them.
3. Select **XiaoZhi robot** in **Robot connection**, enter the device ID, enable the connection, and save. Select **Check connection** to discover the device's MCP tools.
4. Enter a sentence in **Manual controls** to test speech. Turn on **Speak all pet messages through the robot** to queue new replies, whispers and sleep talk for one-way playback on the device.

## Map a device action

Add an action in **Advanced**. Select a discovered device tool and set a name and fixed JSON arguments. Use `{}` for a tool with zero arguments. Save and enable **Allow robot actions from chat**. A device with a raise-arm tool can map it to an action named “raise your arm”. Ask the pet to raise its arm and confirm the proposal. Optional direct execution dispatches explicit matches in order.

The standard Bread Compact Wi-Fi 2.5.3 firmware registers a GPIO lamp tool. Raising an arm requires an actuator and a corresponding tool in the firmware. [Board firmware](https://github.com/78/xiaozhi-esp32/blob/d7a1c05308fb/main/boards/bread-compact-wifi/compact_wifi_board.cc)

## Official cloud endpoint

The `wss://api.xiaozhi.me/mcp/` endpoint connects external tools for the XiaoZhi agent to call. The desk pet adapter uses a self-hosted device OpenAPI for unsolicited actions and speech. [XiaoZhi MCP quickstart](https://docs.xiaozhi.me/en/mcp/quickstart.html)

| Source | Responsibility |
| --- | --- |
| `src/host/robot/xiaozhi.ts` | Device tool discovery and validation, device routing, and one-way speech |
| `src/host/robot/service.ts` | Action confirmation, serialization, speech queue, and receipts |
| `src/client/robot/settings.ts` | Robot type, device ID, and chat settings |
