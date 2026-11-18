# Astra Pro 2.0 over MCP

This branch connects through MCP Streamable HTTP. Client-side Python and the Astra SDK are no longer required.

1. Build and start this branch, then open the Astra robot panel.
2. Enable the connection, enter `http://<server>:8182/hz-dual-robot-product/mcp`, and save.
3. Enable Direct execution mode and save (this also enables chat actions), then ask the pet to wave the robot. Programs are discovered automatically without manual mappings or a connection check. The robot must already provide the requested teach program.
4. Enable pet speech forwarding if you want the robot to speak.

Leave advanced mappings and timeout settings at their defaults. Mappings are optional for custom names, pet animations or manual control; program IDs remain strings. Turning direct execution off restores configured actions with per-action confirmation. Connection checks remain available for diagnostics and do not establish physical readiness.

The default request timeout is 60 seconds (configurable from 3 to 3600). Commands are not retried. A timeout or cancelled wait may leave the robot running. There is no MCP stop tool: use on-site controls as needed. Success cannot distinguish normal program completion from a server-side stop signal.

Legacy Python/gRPC configuration is disabled on upgrade. Configure the MCP endpoint and select targets again; old action IDs cannot be converted into program IDs. Existing receipts are retained.

For gateway authentication, set `DSH_PET_ROBOT_MCP_HEADERS` to a JSON headers object in the host environment, for example `{"Authorization":"Bearer <token>"}`. Headers are not stored in panel configuration or logged. Restart after changing the environment.

The official MCP SDK handles initialization and sessions. The adapter discovers paginated tools, validates arguments against runtime schemas, re-queries targets before execution and releases sessions. Commands are serialized within one host; coordinate other hosts and controllers on site.

| Source                         | Responsibility                            |
| ------------------------------ | ----------------------------------------- |
| `src/host/robot/mcp.ts`        | MCP sessions, discovery and calls         |
| `src/host/robot/config.ts`     | Endpoint and action validation            |
| `src/host/robot/service.ts`    | Authorization, serialization and receipts |
| `src/client/robot/settings.ts` | Catalog selection and configuration       |

Run `npm run test:robot` for local protocol and controller regression tests. Mock-server checks do not establish physical robot behavior.

## Speak replies and propose actions from chat

In the robot panel, open Robot connection → Chat interaction and enable robot actions from chat. By default, each suggested action requires confirmation.

To skip per-action clicks, enable Direct execution mode and save. This also enables chat actions and takes effect without restarting. The model may select discovered teach programs or configured actions for an explicit current user request. The host checks connectivity and serializes dispatch, waiting for active speech to finish. The panel identifies the mode; generated replies describe an attempted action without asking for another confirmation or claiming physical completion.

The mode defaults to off, including for older configurations. Disabling chat actions also disables direct execution; saving with direct execution off restores confirmation. Pending actions are transient, expire after two minutes and are invalidated by a newer conversation, cancellation or configuration change. They are never replayed after restart, and failures or timeouts are not retried. Keep an operator present: cancelling a local wait does not stop the device.

The host no longer initializes MCP every five seconds to query catalogs. Connections happen on demand for checks or operations. Speech receipts remain in the control panel and are not spoken again.

Before chat generation, the host discovers MCP tools and queries teach programs and areas on demand. Recent valid results are reused. The model receives actual discovery results and configured action mappings, including explicit unavailable states. Empty action mappings no longer hide robot capabilities from chat. With direct execution off, a program requires a configured mapping and per-action confirmation; a pet animation cannot substitute for a physical robot action.

In direct execution mode, runtime-discovered teach programs are available to the current chat without manual mappings. The robot must already expose the program and `startTeachProgram`. The host revalidates the exact string ID before dispatch and does not persist these transient actions. Configured mappings retain custom names and pet animations. With direct execution off, only configured actions are proposed for confirmation. Areas are not added automatically.
