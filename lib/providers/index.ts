/**
 * Public surface of the providers (bank connector) module. Other modules and
 * routes import only from "@/lib/providers". Signatures are a shared contract —
 * change them only with the systems owner.
 *
 * PLACEHOLDER: implementations are filled in by the providers workstream.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import type { Connection, Institution, SyncSummary } from "./types";

export type * from "./types";

export function listInstitutions(): Institution[] {
  return [];
}

export function listConnections(_db: DB, _userId: UserId): Connection[] {
  return [];
}

export function linkInstitution(_db: DB, _userId: UserId, _institutionId: string, _now?: Date): Connection {
  throw new Error("providers.linkInstitution not implemented yet");
}

export function syncConnection(_db: DB, _userId: UserId, _connectionId: string, _now?: Date): SyncSummary {
  throw new Error("providers.syncConnection not implemented yet");
}

export function disconnectConnection(_db: DB, _userId: UserId, _connectionId: string): Connection {
  throw new Error("providers.disconnectConnection not implemented yet");
}
