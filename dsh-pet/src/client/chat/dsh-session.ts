/** Discover the visible DSH session without requiring DSH in standalone mode. */
export function activeDshSession(getService: (name: string) => unknown): string | undefined {
  try {
    const sessions = getService('sessions') as
      | {
          list?: { getSnapshot?(): { byId?: Record<string, { id?: string; retainedBy?: { mainView?: number } }> } };
        }
      | undefined;
    const active = Object.values(sessions?.list?.getSnapshot?.().byId ?? {}).filter(
      (session) => (session.retainedBy?.mainView ?? 0) > 0,
    );
    // Ambiguous views require an explicit host selection; never guess the first workspace.
    return active.length === 1 && typeof active[0].id === 'string' ? active[0].id : undefined;
  } catch {
    return undefined;
  }
}
