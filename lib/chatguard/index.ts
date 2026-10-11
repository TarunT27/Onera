/**
 * Public surface of the chatguard module: inline gates for the chat assistant,
 * the server-side security event recorder, and the background monitor that
 * turns events into findings. Other modules import only from "@/lib/chatguard".
 *
 * Contract and acceptance scenarios: docs/api/chat-security.md.
 */
export type * from "./types";
export { CHATGUARD_RULESET_VERSION, EVENT_STAGES, FINDING_RULES } from "./types";
export {
  countRecentInputs,
  listTurnEvents,
  listUserEvents,
  newConversationId,
  newTurnId,
  rateLimitRecordedSince,
  recordEvent,
  tryRecordEvent,
} from "./events";
export {
  chatRateLimit,
  checkOutput,
  MAX_TOOL_CALLS_PER_TURN,
  RATE_WINDOW_MS,
  referencedRecordIds,
  withheldReply,
  type OutputDecision,
  type OutputEvidence,
  type RecordEvidence,
} from "./gates";
export { getFinding, listFindings } from "./findings";
export {
  getMonitorStatus,
  MONITOR_SETTINGS,
  processChatSecurityBatch,
  startChatSecurityMonitor,
  type BatchOptions,
  type MonitorLoopHandle,
} from "./monitor";
export { reviewerEnabled, type ReviewRequest, type ReviewResult, type Reviewer } from "./reviewer";
