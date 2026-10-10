/**
 * `npm run worker` — background worker for the monitoring agents.
 *
 * Each tick schedules the recurring reviews (deduped per day / 15-min bucket)
 * and runs due jobs. Agents are advisory only: they write insights and queue
 * follow-up jobs; they never approve, execute or change controls.
 *
 *   npm run worker                  # loop forever, tick every CLEARFI_WORKER_INTERVAL_MS (default 5000)
 *   npm run worker -- --once        # one tick, then exit (0 on success, 1 if the tick failed)
 *   npm run worker -- --limit 50    # max jobs per tick (default 25)
 *
 * Env: CLEARFI_DB_PATH (default ./data/clearfi.db), CLEARFI_WORKER_INTERVAL_MS.
 * SIGINT/SIGTERM: the current tick finishes, the DB is closed, the process exits.
 */
import path from "node:path";
import { DEFAULT_WORKER_INTERVAL_MS, runWorkerLoop } from "@/lib/agents";
import { openDb } from "@/lib/db";

function usage(message: string): never {
  console.error(`[worker] ${message}\nUsage: tsx scripts/worker.ts [--once] [--limit N]`);
  process.exit(2);
}

function positiveInt(raw: string | undefined, name: string): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) usage(`${name} must be a positive integer (got "${raw ?? ""}")`);
  return n;
}

function parseArgs(argv: string[]): { once: boolean; limit?: number } {
  const out: { once: boolean; limit?: number } = { once: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") out.once = true;
    else if (arg === "--limit") out.limit = positiveInt(argv[++i], "--limit");
    else if (arg.startsWith("--limit=")) out.limit = positiveInt(arg.slice("--limit=".length), "--limit");
    else usage(`Unknown argument "${arg}"`);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const intervalMs = process.env.CLEARFI_WORKER_INTERVAL_MS
    ? positiveInt(process.env.CLEARFI_WORKER_INTERVAL_MS, "CLEARFI_WORKER_INTERVAL_MS")
    : DEFAULT_WORKER_INTERVAL_MS;
  const file = path.resolve(process.env.CLEARFI_DB_PATH ?? "./data/clearfi.db");
  const db = openDb(file);

  const stop = new AbortController();
  let signals = 0;
  const onSignal = (sig: NodeJS.Signals) => {
    signals++;
    if (signals > 1) {
      console.error(`[worker] ${sig} again; exiting immediately`);
      process.exit(130);
    }
    console.log(`[worker] ${sig} received; finishing current tick`);
    stop.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.log(
    `[worker] db=${file} ${args.once ? "mode=once" : `interval=${intervalMs}ms`}` +
      (args.limit ? ` limit=${args.limit}` : ""),
  );
  try {
    const result = await runWorkerLoop(db, { once: args.once, limit: args.limit, intervalMs, signal: stop.signal });
    console.log(`[worker] stopped after ${result.ticks} tick(s), ${result.errors} error(s)`);
    return args.once && result.errors > 0 ? 1 : 0;
  } finally {
    db.close();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[worker] fatal", err);
    process.exit(1);
  },
);
