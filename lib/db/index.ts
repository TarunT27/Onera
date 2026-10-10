/**
 * SQLite connection. One file-backed database for the local demo server and
 * fresh in-memory databases for tests.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MODULES } from "./modules";
import { CORE_DROP_SQL, CORE_SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { seedDatabase } from "./seed";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __clearfiDb?: DB };

function createSchema(db: DB): void {
  db.exec(CORE_SCHEMA_SQL);
  for (const m of MODULES) db.exec(m.schemaSql);
}

function dropSchema(db: DB): void {
  for (const m of [...MODULES].reverse()) db.exec(m.dropSql);
  db.exec(CORE_DROP_SQL);
}

/** Opens a database, applies the schema and seeds it when empty or outdated. */
export function openDb(file: string, asOf: Date = new Date()): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const version = db.pragma("user_version", { simple: true }) as number;
  if (version !== SCHEMA_VERSION) {
    // Synthetic demo data only: rebuild instead of migrating.
    resetDemoData(db, asOf);
  } else {
    createSchema(db);
  }
  return db;
}

/** Shared connection for the Next.js server and worker (survives dev hot reloads). */
export function getDb(): DB {
  if (!globalForDb.__clearfiDb) {
    const file = path.resolve(process.env.CLEARFI_DB_PATH ?? "./data/clearfi.db");
    globalForDb.__clearfiDb = openDb(file);
  }
  return globalForDb.__clearfiDb;
}

/** Drops all demo data and reseeds. Synthetic data only. */
export function resetDemoData(db: DB, asOf: Date = new Date()): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      dropSchema(db);
      createSchema(db);
      seedDatabase(db, asOf);
      for (const m of MODULES) m.seed?.(db, asOf);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
