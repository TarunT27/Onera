/** `npm run db:reset` — recreate the local demo database with fresh synthetic data. */
import path from "node:path";
import { openDb, resetDemoData } from "@/lib/db";

const file = path.resolve(process.env.CLEARFI_DB_PATH ?? "./data/clearfi.db");
const db = openDb(file);
resetDemoData(db);
console.log(`Reset demo database at ${file}`);
db.close();
