/**
 * Agent registry — the AI-governance permission matrix, as code.
 *
 * Each definition states exactly what an agent may read and write. The runner
 * builds every handler's context from its definition (lib/agents/context.ts),
 * so a read or write outside this list throws, fails the run and is audited.
 * No agent can approve, execute, create mandates, verify recipients or change
 * controls: those fields are the literal type `false`, and the context exposes
 * no such operations.
 *
 * Pure data — safe to import from routes and docs without loading handlers.
 */
import type { AgentDefinition, AgentId, DataScope, JobType, WriteScope } from "./types";
import { DATA_SCOPES, JOB_TYPES, WRITE_SCOPES } from "./types";

const NO_POWERS = {
  canApprove: false,
  canExecute: false,
  canCreateMandates: false,
  canVerifyRecipients: false,
  canChangeControls: false,
  usesModel: false,
} as const;

const DEFINITIONS: AgentDefinition[] = [
  {
    id: "spending_monitor",
    name: "Spending monitor",
    purpose:
      "Flags categories whose last-30-day spending spikes above the trailing average and unusually large purchases. " +
      "Internal transfers are excluded; foreign-currency spending is converted with the dated demo FX rate.",
    trigger: "Daily schedule and after a bank sync imports new transactions",
    jobTypes: ["spending_review"],
    reads: ["transactions"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
  {
    id: "subscription_monitor",
    name: "Subscription monitor",
    purpose: "Persists recurring-charge price increases with the charges that prove them. Never cancels anything.",
    trigger: "Daily schedule and after a bank sync imports new transactions",
    jobTypes: ["subscription_review"],
    reads: ["transactions"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
  {
    id: "security_sentinel",
    name: "Security sentinel",
    purpose:
      "Advisory review of each transfer proposal: changed or unverified recipient details, first-time external " +
      "recipient, amount far above the user's typical transfers, assistant-created proposal to an external recipient. " +
      "It cannot hold, release, approve or execute; deterministic policy holds are enforced separately.",
    trigger: "Every new transfer proposal (enqueued by lib/actions)",
    jobTypes: ["security_review"],
    reads: ["actions", "recipients", "transactions"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
  {
    id: "portfolio_monitor",
    name: "Portfolio monitor",
    purpose: "Flags single positions above 25% of an account and large daily moves at simulated prices. Never trades.",
    trigger: "Daily schedule",
    jobTypes: ["portfolio_review"],
    reads: ["portfolio"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
  {
    id: "connection_monitor",
    name: "Connection monitor",
    purpose:
      "Refreshes healthy simulated bank connections, queues spending and subscription reviews when new data arrives, " +
      "and raises a connection-health insight when a sync fails.",
    trigger: "Every 15 minutes per healthy connection",
    jobTypes: ["sync_connection"],
    reads: ["connections"],
    writes: ["insights", "jobs", "connection_sync"],
    enqueues: ["spending_review", "subscription_review"],
    ...NO_POWERS,
  },
  {
    id: "threat_monitor",
    name: "Threat monitor",
    purpose:
      "Advisory, rule-based sweep of the user's own audit log for attack patterns over time: repeated not-found " +
      "probes, execution without approval, stale-approval replays, recipient swaps before a transfer, limit probing, " +
      "controls loosened right before an approval, prompt-injection attempts and refused assistant tools. " +
      "It cannot hold, pause, approve or execute anything; it only writes insights.",
    trigger: "Shortly after new user, assistant or system activity appears in the audit log",
    jobTypes: ["threat_sweep"],
    reads: ["audit", "actions"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
  {
    id: "personal_assistant",
    name: "Personal assistant",
    purpose:
      "Prepares a briefing in the background: where you could save (recurring charges, small habits, fees, idle " +
      "cash), where spending looks too high or doesn't add up (possible duplicate charges, spending above income), " +
      "notes on your holdings from simulated price history, and transfers or bank connections that need you. " +
      "Observation only: it can't move money, propose, approve, trade or change anything. Not financial advice.",
    trigger: "Every 30 minutes per user, and on demand from the Briefing page",
    jobTypes: ["assistant_briefing"],
    reads: ["accounts", "transactions", "actions", "portfolio", "connections"],
    writes: ["insights"],
    enqueues: [],
    ...NO_POWERS,
  },
];

/** Frozen at load: nothing can widen an agent's permissions at runtime. */
export const AGENT_REGISTRY: readonly AgentDefinition[] = Object.freeze(
  DEFINITIONS.map((d) =>
    Object.freeze({
      ...d,
      jobTypes: Object.freeze([...d.jobTypes]) as JobType[],
      reads: Object.freeze([...d.reads]) as DataScope[],
      writes: Object.freeze([...d.writes]) as WriteScope[],
      enqueues: Object.freeze([...d.enqueues]) as JobType[],
    }),
  ),
);

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function agentForJobType(type: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => (a.jobTypes as string[]).includes(type));
}

export const agentIds = (): AgentId[] => AGENT_REGISTRY.map((a) => a.id);

/** Every job type is handled by exactly one agent (asserted in tests). */
export const REGISTERED_JOB_TYPES: readonly JobType[] = JOB_TYPES;

/** Rows of the permission matrix: one per agent, a column per data scope and write scope. */
export interface PermissionRow {
  agentId: AgentId;
  name: string;
  reads: Record<DataScope, boolean>;
  writes: Record<WriteScope, boolean>;
  canApprove: false;
  canExecute: false;
  canCreateMandates: false;
  canVerifyRecipients: false;
  canChangeControls: false;
  usesModel: false;
}

export function permissionMatrix(): PermissionRow[] {
  return AGENT_REGISTRY.map((a) => ({
    agentId: a.id,
    name: a.name,
    reads: Object.fromEntries(DATA_SCOPES.map((s) => [s, a.reads.includes(s)])) as Record<DataScope, boolean>,
    writes: Object.fromEntries(WRITE_SCOPES.map((s) => [s, a.writes.includes(s)])) as Record<WriteScope, boolean>,
    ...NO_POWERS,
  }));
}

/** Markdown table for docs/api/agents.md (a test keeps the doc in sync with this output). */
export function permissionMatrixMarkdown(): string {
  const yes = (b: boolean) => (b ? "yes" : "—");
  const head = [
    "Agent", "Job types",
    ...DATA_SCOPES.map((s) => `read ${s}`),
    ...WRITE_SCOPES.map((s) => `write ${s}`),
    "approve", "execute", "mandates", "verify recipients", "change controls", "model",
  ];
  const rows = AGENT_REGISTRY.map((a) => [
    `${a.name} (\`${a.id}\`)`,
    a.jobTypes.map((t) => `\`${t}\``).join(", "),
    ...DATA_SCOPES.map((s) => yes(a.reads.includes(s))),
    ...WRITE_SCOPES.map((s) => yes(a.writes.includes(s))),
    "never", "never", "never", "never", "never", "none",
  ]);
  return [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}
