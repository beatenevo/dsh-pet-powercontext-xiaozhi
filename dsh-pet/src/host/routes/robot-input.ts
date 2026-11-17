/** Robot-origin speech ingress. Recognition reuses the configured ASR service; physical actions remain gated. */
import { z } from 'zod';
import { animationNames } from '../anim.ts';
import { readAllConfig } from '../config.ts';
import type { RouteHandler } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Exactly one finalized utterance; direct presentation options cannot silently affect generated replies. */
const requestSchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    audio: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    mode: z.enum(['chat', 'say']).default('chat'),
    animation: z.string().trim().min(1).optional(),
    speak: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.text !== undefined) !== (v.audio !== undefined))
  .refine((v) => v.provider === undefined || v.audio !== undefined)
  .refine((v) => v.mode === 'say' || (v.animation === undefined && v.speak === undefined));

/** Accept text or a complete WAV recording and dispatch one dialogue or mirrored utterance. */
export const handleRobotInputRoutes: RouteHandler = async (deps, { rest, method, body, url, signal }) => {
  if (rest !== 'robot/input') return;
  if (method !== 'POST') return methodNotAllowed();
  let raw: unknown;
  try {
    raw = JSON.parse(body ?? 'null');
  } catch {
    return invalidJson();
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return failResult('bad-request', 'robot_input_invalid_request');
  const request = parsed.data;
  const surface = url.searchParams.get('surface');
  if (surface !== 'desktop' && surface !== 'web') return failResult('bad-request', 'surface must be desktop or web');
  const session = url.searchParams.get('session') || undefined;
  if (session && session.length > 256) return failResult('bad-request', 'Invalid DSH session ID');
  try {
    const lookup = () => deps.requirePet(url.searchParams, () => readAllConfig(deps.configPaths), { surface: true });
    let who = lookup();
    if (!who.ok) return who.res;
    let blocked = deps.lockBlocked(who.petId, url.searchParams) ?? deps.sleepBlocked(who.petId, url.searchParams);
    if (blocked) return blocked;
    if (signal?.aborted) return failResult('generate-error', 'robot_input_cancelled');
    let text = request.text ?? '';
    if (request.audio !== undefined) {
      const heard = await deps.speech.hear({ audio: request.audio, provider: request.provider }, signal);
      if (!heard.ok) return failResult(heard.reason, heard.message);
      text = heard.text.trim();
    }
    // Recognition yields control: configuration, occupancy and connection may have changed meanwhile.
    if (signal?.aborted) return failResult('generate-error', 'robot_input_cancelled');
    who = lookup();
    if (!who.ok) return who.res;
    blocked = deps.lockBlocked(who.petId, url.searchParams) ?? deps.sleepBlocked(who.petId, url.searchParams);
    if (blocked) return blocked;
    if (!text) return okResult({ ok: true, inputText: '', skipped: true });
    if (text.length > 2000) return failResult('bad-request', '消息过长（限 2000 字）');
    if (request.mode === 'chat') {
      const reply = await deps.chatWithPet(who.petId, text, undefined, session);
      return okResult({ ...reply, inputText: text });
    }
    if (request.animation && !animationNames(who.conf.animations).includes(request.animation)) {
      return failResult('unknown-animation', '没有这个动画：' + request.animation);
    }
    const record = request.animation ? deps.playback.create(who.petId, request.animation) : undefined;
    if (record) deps.state.writePet(who.petId, 'anim', { name: request.animation, playbackId: record.playbackId });
    deps.state.writePet(who.petId, 'say', {
      text,
      duration: 10000,
      anim: !record,
      source: 'robot-input',
      ...(request.speak !== false ? { voiceTo: surface } : {}),
    });
    return okResult({ ok: true, inputText: text, text, ...(record ? { playbackId: record.playbackId } : {}) });
  } catch {
    return failResult('generate-error', 'robot_input_failed');
  }
};
