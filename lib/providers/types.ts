/** Public types for bank/brokerage connectors. Owned by the providers module. */
import type { AccountType, CurrencyCode, UserId } from "@/lib/types";

export type InstitutionKind = "bank" | "brokerage" | "international";

export interface Institution {
  id: string;
  /** Display name, always marked simulated, e.g. "TD Bank (simulated)". */
  name: string;
  /** Real-world institution this simulated profile imitates. No affiliation or connection. */
  brand: string;
  country: string;
  currency: CurrencyCode;
  kind: InstitutionKind;
  products: AccountType[];
  /** Whether linked accounts may be used as transfer endpoints in the simulator. */
  supportsTransfers: boolean;
  simulated: true;
  disclaimer: string;
}

export type ConnectionStatus = "healthy" | "login_required" | "error" | "disconnected";

export interface Connection {
  id: string;
  userId: UserId;
  institutionId: string;
  institutionName: string;
  status: ConnectionStatus;
  consentScopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  accountIds: string[];
  createdAt: string;
  simulated: true;
}

export interface SyncSummary {
  connectionId: string;
  status: ConnectionStatus;
  added: number;
  modified: number;
  removed: number;
  /** Posted transactions that are new in this sync (for downstream monitoring). */
  newTransactionIds: string[];
  syncedAt: string;
}
