"use client";

import { createContext, useContext, type ReactNode } from "react";
import { paths, type SessionResponse } from "./api";
import { useApiData, type ApiData } from "./useApiData";

// One server-owned identity snapshot survives client-side page navigation.
const SessionContext = createContext<ApiData<SessionResponse> | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useApiData<SessionResponse>(paths.session);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession requires SessionProvider");
  return session;
}
