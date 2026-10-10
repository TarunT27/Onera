"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { displayCache } from "./readCache";
import { paths, type SessionResponse } from "./api";
import { useApiData, type ApiData } from "./useApiData";

// One server-owned identity snapshot survives client-side page navigation.
const SessionContext = createContext<ApiData<SessionResponse> | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useApiData<SessionResponse>(paths.session);
  useEffect(() => {
    // Another tab can switch the server cookie. Clear private views on return.
    const refresh = () => displayCache.invalidate(true, true);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession requires SessionProvider");
  return session;
}
