import { msg } from "./msg";

/**
 * Bare words the server sends as data (run status, and so on). Marked here so
 * they get translated; the UI renders them with `t(value)`.
 */
export const RUN_STATUS_LABEL = {
  running: msg("running"),
  succeeded: msg("succeeded"),
  failed: msg("failed"),
} as const;
