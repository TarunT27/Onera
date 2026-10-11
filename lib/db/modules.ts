/**
 * Feature-module registration. Each module owns its own tables, seed data and
 * code in its directory and plugs in here. Order matters: a module may only
 * reference tables from core or from modules listed before it.
 */
import type { DB } from "./index";
import { providersModule } from "@/lib/providers/db";
import { marketsModule } from "@/lib/markets/db";
import { agentsModule } from "@/lib/agents/db";
import { chatguardModule } from "@/lib/chatguard/db";

export interface DbModule {
  name: string;
  /** CREATE TABLE IF NOT EXISTS ... statements. */
  schemaSql: string;
  /** DROP TABLE IF EXISTS ... statements, children before parents. */
  dropSql: string;
  /** Inserts synthetic demo data. Runs after core seeding, inside the seed transaction. */
  seed?: (db: DB, asOf: Date) => void;
}

export const MODULES: DbModule[] = [providersModule, marketsModule, agentsModule, chatguardModule];
