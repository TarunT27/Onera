"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface ApiData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Re-fetch. Keeps showing the previous data while loading. */
  reload: () => Promise<void>;
  setData: (next: T | null) => void;
}

/** GET a JSON endpoint on mount (and whenever `path` changes). Pass null to skip. */
export function useApiData<T>(path: string | null): ApiData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await api.get<T>(path);
      if (ticket === latest.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
