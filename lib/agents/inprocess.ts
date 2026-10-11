/**
 * In-process background worker, started once per Next.js server by
 * instrumentation.ts. It runs the same loop as `npm run worker` against the
 * server's database, so the monitoring agents work in the background without
 * a second terminal. Disable with CLEARFI_INPROCESS_WORKER=off (for example
 * when running the standalone worker instead; both together are safe — job
 * leases stop a job running twice).
 *
 * It only sequences the scheduler and runner: agents stay advisory, scoped to
 * each job's user, and audited as agent:<id>.
 */
import { getDb } from "@/lib/db";
import { DEFAULT_WORKER_INTERVAL_MS, runWorkerLoop } from "./worker";

const globalForWorker = globalThis as unknown as { clearfiWorker?: AbortController };

export function startInProcessWorker(): void {
  if (globalForWorker.clearfiWorker) return; // already running in this process
  const stop = new AbortController();
  globalForWorker.clearfiWorker = stop;

  const intervalMs = Number(process.env.CLEARFI_WORKER_INTERVAL_MS) || DEFAULT_WORKER_INTERVAL_MS;
  void runWorkerLoop(getDb(), {
    intervalMs,
    signal: stop.signal,
    heartbeat: { workerId: `in-process:${process.pid}`, mode: "in-process" },
    // Quiet when idle: log only ticks that did something.
    log: (line) => {
      if (!/ processed=0 /.test(line) || / scheduled=[1-9]/.test(line)) console.log(line.replace("[worker]", "[worker:in-process]"));
    },
  }).finally(() => {
    if (globalForWorker.clearfiWorker === stop) globalForWorker.clearfiWorker = undefined;
  });
  console.log(`[worker:in-process] started, tick every ${intervalMs} ms`);
}
