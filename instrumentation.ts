/**
 * Runs once when a Next.js server starts. Starts the background monitoring
 * worker inside the server process (Node.js runtime only, never during
 * `next build`). Set CLEARFI_INPROCESS_WORKER=off to rely on `npm run worker`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.CLEARFI_INPROCESS_WORKER === "off") return;
  const { startInProcessWorker } = await import("./lib/agents/inprocess");
  startInProcessWorker();
}
