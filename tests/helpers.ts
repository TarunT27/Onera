import { openDb, type DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";

/** Fresh in-memory database seeded with the synthetic demo data. */
export function freshDb(): DB {
  return openDb(":memory:", new Date());
}

/** Runs fn and returns the ServiceError code it throws. */
export function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ServiceError) return err.code;
    throw err;
  }
  throw new Error("Expected a ServiceError but nothing was thrown");
}

export function balance(db: DB, accountId: string): number {
  return (db.prepare("SELECT balance_cents AS b FROM accounts WHERE id = ?").get(accountId) as { b: number }).b;
}
