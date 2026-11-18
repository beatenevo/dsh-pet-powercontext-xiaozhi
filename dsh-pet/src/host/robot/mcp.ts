/**
 * Astra MCP 适配器：每次操作独占一个初始化后的 Streamable HTTP 会话。
 * SDK 管理协议与会话；宿主负责动作串行化和现场授权。
 * 不重试物理动作，取消等待不代表设备停止。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { z } from 'zod';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RobotRunner } from './worker.ts';

const programsSchema = z.array(z.object({ id: z.string().regex(/^[1-9]\d*$/), name: z.string() })).max(10000);
const areasSchema = z.array(z.object({ areaName: z.string(), parameter: z.string().min(1) })).max(10000);
const validator = new AjvJsonSchemaValidator();

/** 用 MCP 发现目录、执行示教或移动、播放文本。 */
export const runRobotWorker: RobotRunner = async (config, call, signal) => {
  if (call.operation === 'stop')
    return {
      ok: false,
      code: 'stop_unsupported',
      message: '已取消本地等待；MCP 未提供停止工具，机器人可能仍在运行，请现场确认或使用实体急停。',
    };
  const deadline = AbortSignal.timeout(config.timeoutSeconds * 1000);
  const abort = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
  const cleanup = new AbortController();
  const client = new Client({ name: 'dsh-pet-astra', version: '2.0.0' });
  let sent = false;
  let transport: StreamableHTTPClientTransport | undefined;
  try {
    abort.throwIfAborted();
    const headers = z.record(z.string(), z.string()).parse(JSON.parse(process.env.DSH_PET_ROBOT_MCP_HEADERS || '{}'));
    transport = new StreamableHTTPClientTransport(new URL(config.address), {
      requestInit: { headers, redirect: 'error' },
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([abort, cleanup.signal, ...(init?.signal ? [init.signal] : [])]),
        }),
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    const request = { signal: abort, timeout: config.timeoutSeconds * 1000 };
    await client.connect(transport, request);
    const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, request);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('invalid_catalog');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const invoke = async (name: string, args: Record<string, string>, physical = false) => {
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new Error('unsupported_tool');
      if (!validator.getValidator(tool.inputSchema)(args).valid) throw new Error('invalid_target');
      abort.throwIfAborted();
      if (physical) sent = true;
      const result = CallToolResultSchema.parse(
        await client.callTool({ name, arguments: args }, CallToolResultSchema, request),
      );
      if (result.isError) throw new Error('tool_error');
      return result;
    };
    const list = async (name: string): Promise<unknown> => {
      const result = await invoke(name, {});
      // Spring MCP 可在 structuredContent.result 包装业务值，也可返回 JSON text。
      if (result.structuredContent) return result.structuredContent.result ?? result.structuredContent;
      const text = result.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n');
      return JSON.parse(text);
    };
    if (call.operation === 'status') {
      const programs = programsSchema.parse(await list('getTeachProgramList'));
      const areas = areasSchema.parse(await list('getAreaInfo'));
      return {
        ok: true,
        code: 'connected',
        message: 'MCP 已连接；设备姿态与停止状态需现场确认。',
        catalog: { programs, areas, tools: tools.map((tool) => tool.name) },
      };
    }
    if (call.operation === 'speak') await invoke('textToSpeech', { text: call.text ?? '' }, true);
    else if (call.tool === 'startTeachProgram') {
      const programs = programsSchema.parse(await list('getTeachProgramList'));
      if (!programs.some((item) => item.id === call.target)) throw new Error('invalid_target');
      await invoke(call.tool, { teachProgramId: call.target! }, true);
    } else if (call.tool === 'RobotAgvMove') {
      const areas = areasSchema.parse(await list('getAreaInfo'));
      if (!areas.some((item) => item.parameter === call.target)) throw new Error('invalid_target');
      await invoke(call.tool, { station: call.target! }, true);
    } else throw new Error('unsupported_tool');
    return { ok: true, code: 'reported_success', message: 'MCP 工具返回成功；实际执行或播放结果请现场确认。' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    const code = abort.aborted
      ? signal?.aborted
        ? 'cancelled'
        : 'timeout'
      : sent
        ? 'execution_unknown'
        : ['unsupported_tool', 'invalid_target'].includes(reason)
          ? reason
          : 'rejected';
    return {
      ok: false,
      code,
      message: sent
        ? '请求结果未确认，机器人可能仍在运行；请现场检查，勿自动重试。'
        : 'MCP 连接、工具定义或目录查询失败；未下发动作。',
    };
  } finally {
    // 请求结束后释放服务端会话；取消时只关闭本地流。
    const cleanupTimer = setTimeout(() => cleanup.abort(), 1000);
    try {
      if (!abort.aborted) await transport?.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
};
