/**
 * In-process background services for the Next.js server (started from
 * instrumentation.ts), so the agents work without anyone clicking "run":
 *
 *  - the agents job worker: schedules and runs the monitoring agents and the
 *    personal assistant (same tick as `npm run worker`);
 *  - the chat security monitor: consumes new chat security events on arrival,
 *    plus a catch-up poll that also heartbeats;
 *  - the Alpaca order sync: while orders are open at Alpaca, polls their status
 *    and records fills, cancellations and rejections (no-op without keys).
 *
 * Both are advisory: they write insights, briefings and findings only. Running
 * `npm run worker` at the same time is safe — jobs are claimed atomically with
 * leases, and the chat monitor holds a lease on its cursor.
 *
 * CLEARFI_BACKGROUND=off disables this (tests, e2e, or when only the separate
 * worker process should run).
 */
import { runWorkerLoop } from "@/lib/agents";
import { startChatSecurityMonitor } from "@/lib/chatguard";
import type { DB } from "@/lib/db";
import { startBrokerOrderSync } from "@/lib/markets";

const g = globalThis as unknown as { __clearfiBackground?: { stop(): void } };

export function backgroundEnabled(): boolean {
  return process.env.CLEARFI_BACKGROUND !== "off";
}

/** Starts the services once per process. Returns a stop function. */
export function startBackgroundServices(db: DB, log: (line: string) => void = (l) => console.log(l)): () => void {
  if (g.__clearfiBackground) return g.__clearfiBackground.stop;

  const stopWorker = new AbortController();
  const intervalMs = Number(process.env.CLEARFI_WORKER_INTERVAL_MS) || undefined;
  void runWorkerLoop(db, {
    intervalMs,
    signal: stopWorker.signal,
    // Lets the Agents tab show monitoring as live, stale or offline (lib/agents/health.ts).
    heartbeat: { workerId: `in-process:${process.pid}`, mode: "in-process" },
    // Quiet unless something actually ran.
    log: (line) => {
      if (!/processed=0 /.test(line)) log(line);
    },
  }).catch((err) => console.error("[background] agents worker stopped", err));

  const monitor = startChatSecurityMonitor(db, { log });
  const brokerSync = startBrokerOrderSync(db, { log });
  const handle = {
    stop() {
      stopWorker.abort();
      monitor.stop();
      brokerSync.stop();
      g.__clearfiBackground = undefined;
    },
  };
  g.__clearfiBackground = handle;
  log("[background] agents worker, chat security monitor and Alpaca order sync started");
  return handle.stop;
}
