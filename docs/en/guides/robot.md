# Astra Pro 2.0 over MCP

This branch connects through MCP Streamable HTTP. Client-side Python and the Astra SDK are no longer required.

1. Build and start this branch, then open the Astra robot panel.
2. Enable the connection, enter `http://<server>:8182/hz-dual-robot-product/mcp`, and save.
3. Check the connection to discover teach programs and movement areas. Connectivity does not establish physical readiness.
4. Add an action, choose a program or area from the catalog, name it, and save. Program IDs remain strings throughout.
5. Check the connection again, verify posture and surrounding space on site, authorize one action, then execute it. Chat proposals also require individual confirmation.
6. Speech uses `textToSpeech`; the pet speech option forwards new utterances.

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
