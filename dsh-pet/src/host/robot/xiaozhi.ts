/**
 * Adapt the XiaoZhi ESP32 Go server's device OpenAPI to the desk pet controller.
 * Read the trusted API URL and token from the host environment.
 * Resolve device tools before dispatch and preserve uncertain outcomes after a POST.
 */
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { RobotCatalog, RobotResult } from '../../shared/robot.ts';
import type { RobotRunner } from './worker.ts';

const validator = new AjvJsonSchemaValidator();
const object = z.record(z.string(), z.unknown());
const toolList = z.object({
  data: z.object({
    tools: z.array(z.object({ name: z.string().min(1).max(128), input_schema: object.optional() })).max(1000),
  }),
});
const deviceList = z.object({
  data: z.array(z.object({ id: z.union([z.string(), z.int()]), device_name: z.string().min(1) })),
});
const speechResponse = z.object({ success: z.literal(true) });
const toolResponse = z.object({ data: z.object({ result: z.string() }) });
const deviceToolName = /^[a-zA-Z0-9_.-]+$/;

function readConnection() {
  const token = process.env.DSH_PET_XIAOZHI_API_TOKEN?.trim();
  const address = process.env.DSH_PET_XIAOZHI_OPENAPI_URL?.trim();
  if (!token || !address) throw new Error('xiaozhi_setup_required');
  let base: URL;
  try {
    base = new URL(address.endsWith('/') ? address : address + '/');
  } catch {
    throw new Error('xiaozhi_invalid_url');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !base.pathname.endsWith('/api/open/v1/') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('xiaozhi_invalid_url');
  return { base, token };
}

function createApi(base: URL, token: string, signal: AbortSignal) {
  return async (path: string, body?: object): Promise<unknown> => {
    const response = await fetch(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: { 'X-API-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(
        response.status === 401 || response.status === 403 ? 'xiaozhi_auth_failed' : 'xiaozhi_api_failed',
      );
    }
    return response.json();
  };
}

function catalogFrom(tools: z.infer<typeof toolList>['data']['tools']): RobotCatalog {
  return {
    programs: [],
    areas: [],
    tools: tools.map(({ name }) => name),
    xiaozhiTools: tools.flatMap(({ name, input_schema: schema }) => {
      if (!deviceToolName.test(name) || schema?.type !== 'object') return [];
      const properties = object.safeParse(schema.properties ?? {});
      const required = z.array(z.string()).safeParse(schema.required ?? []);
      return properties.success && required.success
        ? [{ name, arguments: Object.keys(properties.data), required: required.data }]
        : [];
    }),
  };
}

function failed(reason: string, sent: boolean): RobotResult {
  const messages: Record<string, string> = {
    xiaozhi_setup_required: 'Set DSH_PET_XIAOZHI_OPENAPI_URL and DSH_PET_XIAOZHI_API_TOKEN in the host environment.',
    xiaozhi_invalid_url: 'The XiaoZhi OpenAPI URL must be HTTP(S) and end in /api/open/v1.',
    xiaozhi_auth_failed: 'The XiaoZhi server refused the API token.',
    xiaozhi_device_unavailable:
      'The XiaoZhi device or its MCP tool list is unavailable. Check that the device is online.',
    unsupported_tool: 'The configured tool is unavailable in the XiaoZhi device catalog.',
    invalid_target: 'The configured arguments do not match the XiaoZhi device tool schema.',
  };
  return {
    ok: false,
    code: sent
      ? 'execution_unknown'
      : Object.prototype.hasOwnProperty.call(messages, reason) || reason === 'timeout' || reason === 'cancelled'
        ? reason
        : 'rejected',
    message: sent
      ? 'XiaoZhi delivery could not be confirmed. Check the device before sending again.'
      : (messages[reason] ?? 'XiaoZhi OpenAPI request failed before dispatch.'),
  };
}

/** Execute one request through the configured XiaoZhi backend. */
export const runXiaozhi: RobotRunner = async (config, call, signal) => {
  if (call.operation === 'stop')
    return { ok: false, code: 'stop_unsupported', message: 'Local wait cancelled. Check the XiaoZhi device on site.' };
  const deadline = AbortSignal.timeout(config.timeoutSeconds * 1000);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let sent = false;
  try {
    abort.throwIfAborted();
    const { base, token } = readConnection();
    const api = createApi(base, token, abort);
    const deviceId = config.xiaozhi!.deviceId;
    const devicePath = 'devices/' + encodeURIComponent(deviceId);
    const send = (path: string, body: object) => {
      abort.throwIfAborted();
      sent = true;
      return api(path, body);
    };
    if (call.operation === 'speak') {
      const devices = deviceList.parse(await api('devices')).data;
      const device = devices.find(({ id }) => String(id) === deviceId);
      if (!device) throw new Error('xiaozhi_device_unavailable');
      speechResponse.parse(
        await send('devices/inject-message', {
          device_id: device.device_name,
          message: call.text,
          mode: 'notify',
          skip_llm: true,
          auto_listen: false,
        }),
      );
    } else {
      const tools = toolList.parse(await api(devicePath + '/mcp-tools')).data.tools;
      if (!tools.length) throw new Error('xiaozhi_device_unavailable');
      const catalog = catalogFrom(tools);
      if (call.operation === 'status')
        return { ok: true, code: 'connected', message: 'XiaoZhi device tools discovered.', catalog };
      const matches = tools.filter(({ name }) => name === call.target);
      if (
        call.tool !== 'xiaozhiMcp' ||
        matches.length !== 1 ||
        !catalog.xiaozhiTools?.some(({ name }) => name === call.target)
      )
        throw new Error('unsupported_tool');
      const tool = matches[0];
      const args = call.arguments ?? {};
      if (!validator.getValidator(tool.input_schema!)(args).valid) throw new Error('invalid_target');
      const response = toolResponse.parse(
        await send(devicePath + '/mcp-call', { tool_name: tool.name, arguments: args }),
      );
      // The manager nests the device's serialized MCP result inside the OpenAPI envelope.
      if (CallToolResultSchema.parse(JSON.parse(response.data.result)).isError) throw new Error('xiaozhi_tool_error');
    }
    return {
      ok: true,
      code: 'reported_success',
      message: 'XiaoZhi accepted the request. Verify the result on the device.',
    };
  } catch (cause) {
    const reason = signal?.aborted
      ? 'cancelled'
      : deadline.aborted
        ? 'timeout'
        : cause instanceof Error
          ? cause.message
          : '';
    return failed(reason, sent);
  }
};
