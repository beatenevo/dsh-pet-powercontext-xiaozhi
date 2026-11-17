/** Click-to-record lifecycle. Recognition only follows an explicit stop; stale results never edit a new chat. */
import {
  canRecord,
  hearAudio,
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  SILENCE_PEAK,
  startRecording,
  toBase64,
} from '../../shared/hear.ts';
import type { HearOutcome, HearRecorder } from '../../shared/hear.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';

/** Phases shown in the composer; ready means transcription is awaiting user review. */
export type RecordingPhase = 'idle' | 'permission' | 'recording' | 'recognizing' | 'ready';

/** Injectable browser boundaries for lifecycle tests without accessing a microphone. */
export interface RecordingPorts {
  available(): boolean;
  start(): Promise<HearRecorder>;
  hear(audio: string, signal: AbortSignal): Promise<HearOutcome>;
  phase(value: RecordingPhase): void;
  error(message: 'unsupported' | 'permission' | 'failed' | 'silent' | 'limit', detail?: string): void;
  append(text: string): void;
}

/** Own one microphone and one recognition request; cancel is safe even during the permission prompt. */
export function createRecording(ports: RecordingPorts) {
  let phase: RecordingPhase = 'idle';
  let generation = 0;
  let recorder: HearRecorder | undefined;
  let abort: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: RecordingPhase): void => {
    phase = next;
    ports.phase(next);
  };
  const cancel = (notify = true): void => {
    generation++;
    clearTimeout(timer);
    recorder?.cancel();
    recorder = undefined;
    abort?.abort();
    abort = undefined;
    phase = 'idle';
    if (notify) ports.phase('idle');
  };
  return {
    cancel,
    active: () => phase === 'permission' || phase === 'recording' || phase === 'recognizing',
    async toggle(): Promise<void> {
      if (phase === 'permission' || phase === 'recognizing') return;
      if (phase !== 'recording') {
        if (!ports.available()) {
          ports.error('unsupported');
          return;
        }
        const own = ++generation;
        update('permission');
        try {
          const opened = await ports.start();
          if (own !== generation) {
            opened.cancel();
            return;
          }
          recorder = opened;
          update('recording');
          timer = setTimeout(() => {
            cancel();
            ports.error('limit');
          }, MAX_RECORD_MS);
        } catch {
          if (own !== generation) return;
          update('idle');
          ports.error('permission');
        }
        return;
      }
      const own = generation;
      const current = recorder!;
      clearTimeout(timer);
      update('recognizing');
      abort = new AbortController();
      try {
        const duration = current.elapsedMs();
        const clip = await current.stop();
        if (own !== generation) return;
        recorder = undefined;
        if (duration < MIN_RECORD_MS || !clip || clip.peak < SILENCE_PEAK) {
          update('idle');
          ports.error('silent');
          return;
        }
        const result = await ports.hear(toBase64(clip.wave), abort.signal);
        if (own !== generation) return;
        if (!result.ok) {
          update('idle');
          ports.error('failed', result.message);
          return;
        }
        const text = result.text.trim();
        if (!text) {
          update('idle');
          ports.error('silent');
          return;
        }
        ports.append(text);
        update('ready');
      } catch {
        if (own === generation) {
          update('idle');
          ports.error('failed');
        }
      } finally {
        current.cancel();
        if (own === generation) {
          recorder = undefined;
          abort = undefined;
        }
      }
    },
  };
}

/** Browser implementation shares the existing authenticated same-origin speech endpoint. */
export const recordingBrowser = {
  available: canRecord,
  start: startRecording,
  hear: (audio: string, signal: AbortSignal) => hearAudio(ROUTE_PATH + '/voice/hear', audio, signal),
};
