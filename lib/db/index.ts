/**
 * SQLite connection. One file-backed database for the local demo server and
 * fresh in-memory databases for tests.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DROP_SQL, SCHEMA_SQL } from "./schema";
import { seedDatabase } from "./seed";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __clearfiDb?: DB };

/** Opens a database, applies the schema and seeds it when empty. */
export function openDb(file: string, asOf: Date = new Date()): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (n === 0) seedDatabase(db, asOf);
  return db;
}

/** Shared connection for the Next.js server (survives dev hot reloads). */
export function getDb(): DB {
  if (!globalForDb.__clearfiDb) {
    const file = path.resolve(process.env.CLEARFI_DB_PATH ?? "./data/clearfi.db");
    globalForDb.__clearfiDb = openDb(file);
  }
  return globalForDb.__clearfiDb;
}

/** Drops all demo data and reseeds. Synthetic data only. */
export function resetDemoData(db: DB, asOf: Date = new Date()): void {
  db.transaction(() => {
    db.exec(DROP_SQL);
    db.exec(SCHEMA_SQL);
    seedDatabase(db, asOf);
  })();
}
