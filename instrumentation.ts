/**
 * Runs once when a Next.js server instance starts. Starts the background
 * agents (monitoring agents, personal assistant) and the chat security
 * monitor in this process. Node.js runtime only; skipped during `next build`
 * and when CLEARFI_BACKGROUND=off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CLEARFI_BACKGROUND === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ getDb }, { startBackgroundServices }] = await Promise.all([import("@/lib/db"), import("@/lib/background")]);
  startBackgroundServices(getDb());
}
