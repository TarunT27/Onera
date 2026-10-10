/** Short-lived, session-scoped display snapshots. Never used to authorize a write. */
const DISPLAY_PATHS = new Set([
  "/api/accounts", "/api/portfolio", "/api/connections", "/api/institutions",
  "/api/transactions", "/api/insights", "/api/agents/insights", "/api/research",
]);

export function createDisplayCache(now = Date.now) {
  const entries = new Map<string, { data: unknown; at: number }>();
  const pending = new Map<string, Promise<unknown>>();
  const listeners = new Set<(clearVisible: boolean) => void>();
  let scope: string | null = null;
  let generation = 0;
  const eligible = (path: string) => scope !== null && DISPLAY_PATHS.has(path.split("?")[0]);
  const invalidate = (notify = true, clearVisible = false) => {
    generation++;
    entries.clear();
    pending.clear();
    if (notify) listeners.forEach((listener) => listener(clearVisible));
  };
  const save = <T>(path: string, data: T) => {
    if (!eligible(path)) return;
    entries.delete(path);
    entries.set(path, { data, at: now() });
    while (entries.size > 64) entries.delete(entries.keys().next().value!);
  };
  return {
    generation: () => generation,
    peek<T>(path: string): T | null {
      const entry = entries.get(path);
      if (!eligible(path) || !entry) return null;
      if (now() - entry.at >= 30_000) { entries.delete(path); return null; }
      return entry.data as T;
    },
    save,
    load<T>(path: string, read: () => Promise<T>): Promise<T> {
      const existing = pending.get(path);
      if (existing) return existing as Promise<T>;
      const started = generation;
      const promise = Promise.resolve().then(read).then((data) => {
        if (started === generation) save(path, data);
        return data;
      }).finally(() => {
        if (pending.get(path) === promise) pending.delete(path);
      });
      pending.set(path, promise);
      return promise;
    },
    invalidate,
    setSession(serverUserId: string) {
      const changed = scope !== null && scope !== serverUserId;
      scope = serverUserId;
      if (changed) invalidate(true, true);
    },
    subscribe(listener: (clearVisible: boolean) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// Memory only: reload/logout/user switching never persist private snapshots.
export const displayCache = createDisplayCache();
