/**
 * Side effects of the panel: first installation, bottom scrolling, input box automatically growing taller, refreshing
 * with desktop pet's voice.
 *
 * The four things are tied to DOM / external data source and lifecycle, and are separated from state reduction; data
 * is passed in from ./state, and no state is maintained here.
 * @module dsh-pet/src/client/chat/effects
 */
import { fetchState } from '../../shared/state.ts';
import { runStatePoll } from '../pet/state-poll.ts';
import { STATE_FALLBACK_MS, STATE_WAIT_MS } from '../pet/timings.ts';
import { fetchChatConfig, fetchOrphans } from './api.ts';
import { INPUT_MAX_HEIGHT } from './metrics.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { PanelData } from './types.ts';

/** Side effect requires state and handle. */
export interface ChatEffectsInput {
  readonly data: PanelData;
  readonly patch: (next: Partial<PanelData>) => void;
  readonly fail: (error: unknown) => void;
  readonly reload: (petId: string) => Promise<void>;
  readonly listRef: { current: HTMLDivElement | null };
  readonly draftRef: { current: HTMLTextAreaElement | null };
  /** The message `ts` that has been posted to the bottom: it will automatically scroll to the bottom only when it changes. */
  readonly newestTs: { current: number };
}

/**
 * Create side effect hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives status and handle of hook; no return value.
 */
export function createChatEffects(rt: ChatPanelRuntime): (input: ChatEffectsInput) => void {
  const { useEffect } = rt;

  return function useChatEffects(input: ChatEffectsInput): void {
    const { data, fail, listRef, draftRef, newestTs, patch, reload } = input;

    // First Assembly: Pet List + Orphan Tips + First Pet History. It only runs once, so the dependencies are left blank.
    useEffect(() => {
      void (async () => {
        try {
          // The orphan history is pulled together with the configuration: the configuration also carries the memory round number of each entry (used for memory boundary lines)
          const [config, orphans] = await Promise.all([fetchChatConfig(), fetchOrphans().catch(() => [])]);
          const first = config.pets[0]?.id ?? '';
          patch({
            pets: config.pets,
            roundsByEntry: config.roundsByEntry,
            personas: config.personaByPet,
            petId: first,
            orphans,
          });
          await reload(first);
        } catch (error) {
          fail(error);
        } finally {
          patch({ loading: false });
        }
      })();
      // reload/fail/patch are recreated during rendering; depending on them would repeatedly run this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once on mount, as described above.
    }, []);

    // Stick to the bottom only if "there is an updated one": forward loading of earlier rounds should not drag the view away
    useEffect(() => {
      const el = listRef.current;
      if (el === null) return;
      const newest = data.messages[data.messages.length - 1]?.ts ?? 0;
      if (newest === newestTs.current) return;
      newestTs.current = newest;
      el.scrollTop = el.scrollHeight;
      // Track only the message list; all other handles are stable references.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Dependencies are explained above.
    }, [data.messages]);

    // The input box grows taller with the content: first reset it to zero and then return it to scrollHeight, otherwise the height will not shrink when you delete words.
    useEffect(() => {
      const el = draftRef.current;
      if (el === null) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Handles are stable references.
    }, [data.draft]);

    // Chat windows also run without a mounted pet renderer (and its page-local state subscription).
    useEffect(() => {
      const petId = data.petId;
      if (petId === '') return;
      const controller = new AbortController();
      let last: string | undefined;
      let refreshing = false;
      let dirty = false;
      const refresh = async (): Promise<void> => {
        dirty = true;
        if (refreshing) return;
        refreshing = true;
        try {
          while (dirty && !controller.signal.aborted) {
            dirty = false;
            await reload(petId);
          }
        } finally {
          refreshing = false;
        }
      };
      void runStatePoll({
        fetch: (wait) => fetchState(undefined, wait, controller.signal),
        waitMs: STATE_WAIT_MS,
        fallbackMs: STATE_FALLBACK_MS,
        isAlive: () => !controller.signal.aborted,
        onState: (snapshot) => {
          const pet = snapshot.pets[petId];
          const revision = JSON.stringify([pet?.say?.counter ?? 0, pet?.anim?.counter ?? 0]);
          if (revision === last) return;
          last = revision;
          // Refresh the first snapshot too: a reply may arrive between history loading and subscription.
          void refresh();
        },
      });
      return () => controller.abort();
      // Resubscribe only when the pet changes; reload is recreated each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Dependencies are explained above.
    }, [data.petId]);
  };
}
