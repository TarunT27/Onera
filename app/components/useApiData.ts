"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { displayCache } from "./readCache";

export interface ApiData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Re-fetch. Keeps showing the previous data while loading. */
  reload: () => Promise<void>;
  setData: (next: T | null) => void;
}

/** Show a recent display snapshot, then always GET fresh data. Pass null to skip. */
export function useApiData<T>(path: string | null, keepPreviousData = false): ApiData<T> {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: unknown; loading: boolean }>(() => ({
    path, data: path ? displayCache.peek<T>(path) : null, error: null, loading: path !== null,
  }));
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    const generation = displayCache.generation();
    setState((previous) => ({ path, data: previous.path === path || keepPreviousData ? previous.data : displayCache.peek<T>(path), error: null, loading: true }));
    try {
      const res = await displayCache.load(path, () => api.get<T>(path));
      if (ticket === latest.current && generation === displayCache.generation()) {
        setState({ path, data: res, error: null, loading: false });
      }
    } catch (err) {
      if (ticket === latest.current && generation === displayCache.generation()) {
        setState((previous) => ({ ...previous, error: err, loading: false }));
      }
    }
  }, [path, keepPreviousData]);

  useEffect(() => {
    const unsubscribe = displayCache.subscribe((clearVisible) => {
      if (clearVisible) setState({ path, data: null, error: null, loading: path !== null });
      void load();
    });
    void load();
    return () => { ++latest.current; unsubscribe(); };
  }, [load]);

  const setData = useCallback((next: T | null) => {
    ++latest.current;
    if (path && next !== null) displayCache.save(path, next);
    setState({ path, data: next, error: null, loading: false });
  }, [path]);
  const current = state.path === path ? state : { data: keepPreviousData ? state.data : path ? displayCache.peek<T>(path) : null, error: null, loading: path !== null };
  return { ...current, reload: load, setData };
}
