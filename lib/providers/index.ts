/**
 * Public surface of the providers (bank connector) module. Other modules and
 * routes import only from "@/lib/providers". Signatures are a shared contract —
 * change them only with the systems owner.
 *
 * Every connector is SIMULATED: deterministic synthetic data, no affiliation
 * with the named institutions, no real connection and no credentials.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import * as service from "./service";
import type { Connection, Institution, SyncSummary } from "./types";

export type * from "./types";
export type { SimulatedScenario } from "./service";
export {
  capabilitiesFor,
  getConnection,
  getInstitution,
  LinkInstitutionSchema,
  listConnectionAccounts,
  matchInternalTransfers,
  SimulateScenarioSchema,
} from "./service";

export function listInstitutions(): Institution[] {
  return service.listInstitutions();
}

export function listConnections(db: DB, userId: UserId): Connection[] {
  return service.listConnections(db, userId);
}

/** Links (or re-links a disconnected) institution and runs the initial 90-day sync. Actor: the user. */
export function linkInstitution(db: DB, userId: UserId, institutionId: string, now?: Date): Connection {
  return service.link(db, userId, institutionId, { now, actor: `user:${userId}` }).connection;
}

/** Cursor sync on behalf of the system (background jobs). Routes use syncConnectionAs with the user actor. */
export function syncConnection(db: DB, userId: UserId, connectionId: string, now?: Date): SyncSummary {
  return service.sync(db, userId, connectionId, { now, actor: "system" });
}

export function disconnectConnection(db: DB, userId: UserId, connectionId: string): Connection {
  return service.disconnect(db, userId, connectionId, { actor: `user:${userId}` });
}

// ---------------------------------------------------------------------------
// Additional exports (not part of the frozen contract)
// ---------------------------------------------------------------------------

/** Link and also return the initial sync summary (used by POST /api/connections). */
export function linkInstitutionWithSummary(
  db: DB,
  userId: UserId,
  institutionId: string,
  now?: Date,
): { connection: Connection; sync: SyncSummary } {
  return service.link(db, userId, institutionId, { now, actor: `user:${userId}` });
}

/** Sync with an explicit audit actor ("user:<id>" for user-initiated syncs). */
export function syncConnectionAs(db: DB, userId: UserId, connectionId: string, actor: string, now?: Date): SyncSummary {
  return service.sync(db, userId, connectionId, { now, actor });
}

/** Simulated re-authentication: login_required / error → healthy. */
export function reconnectConnection(db: DB, userId: UserId, connectionId: string, now?: Date): Connection {
  return service.reconnect(db, userId, connectionId, { now, actor: `user:${userId}` });
}

/** Demo-only: force a connection into login_required or error. */
export function simulateConnectionIssue(
  db: DB,
  userId: UserId,
  connectionId: string,
  scenario: service.SimulatedScenario,
  now?: Date,
): Connection {
  return service.simulateIssue(db, userId, connectionId, scenario, { now, actor: `user:${userId}` });
}
