/**
 * Threat monitor (job type "threat_sweep").
 *
 * Sweeps the user's own audit log for attack patterns that only show up over
 * time: repeated not-found probes, execution without approval, stale-approval
 * replays, recipient swaps right before a transfer, limit probing, controls
 * loosened right before an approval, prompt-injection attempts and refused
 * assistant tools. Each pattern becomes one insight that cites the audit events
 * behind it.
 *
 * Advisory only. The context offers no write besides insights, so the monitor
 * cannot hold, pause, approve or execute anything; deterministic policy and the
 * user's exact-version approval are enforced elsewhere. Rules are deterministic
 * thresholds on synthetic activity — not a guarantee of detection.
 */
import { findInjectionMarkers, injectionMarkerLabel } from "@/lib/security/injection";
import type { AuditEvent } from "@/lib/types";
import type { AgentHandler } from "../context";
import type { InsightSeverity } from "../types";
import { msg, tpl } from "@/lib/i18n/msg";

const MIN = 60_000;

export const THREAT_RULES = {
  /** How far back each sweep reads the audit log. */
  lookbackMs: 24 * 60 * MIN,
  /** Only clusters whose latest event is this recent are reported, so aged-out clusters never re-alert. */
  reportRecentMs: 2 * 60 * MIN,
  probe: { gapMs: 10 * MIN, warning: 3, critical: 6 },
  unapproved: { gapMs: 10 * MIN, warning: 1, critical: 3 },
  staleApproval: { gapMs: 60 * MIN, warning: 1, criticalPerAction: 2 },
  recipientSwap: { withinMs: 60 * MIN },
  replay: { gapMs: 10 * MIN, warning: 2 },
  limitProbing: { gapMs: 30 * MIN, warning: 3 },
  controlsThenSpend: { withinMs: 15 * MIN },
  injection: { gapMs: 30 * MIN },
  privilege: { gapMs: 30 * MIN, warning: 1, critical: 3 },
  failure: { gapMs: 60 * MIN },
  velocity: { gapMs: 60 * MIN, warning: 5 },
} as const;

export type ThreatCode =
  | "CROSS_USER_PROBE"
  | "UNAPPROVED_EXECUTION"
  | "STALE_APPROVAL_REPLAY"
  | "RECIPIENT_SWAP"
  | "REPLAY_EXECUTION"
  | "LIMIT_PROBING"
  | "CONTROLS_LOOSENED_THEN_SPEND"
  | "PROMPT_INJECTION"
  | "ASSISTANT_PRIVILEGE_ATTEMPT"
  | "EXECUTION_FAILURE"
  | "TRANSFER_VELOCITY";

export interface ThreatSignal {
  code: ThreatCode;
  severity: Exclude<InsightSeverity, "info">;
  title: string;
  /** What was observed, in plain words. Never claims an attack definitely happened. */
  text: string;
  /** What the user can do about it. */
  advice: string;
  /** First event of the cluster: the finding's stable identity. */
  anchorId: number;
  auditEventIds: number[];
  /** Transfer actions cited (owned by the user). */
  actionIds: string[];
  /** Paper orders cited (owned by the user). */
  orderIds: string[];
}

export interface ThreatLookups {
  /** Recipient of one of the user's transfer actions, or null if unknown. */
  recipientOfAction?(actionId: string): string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const time = (e: AuditEvent) => Date.parse(e.createdAt);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Groups events (oldest first) so that consecutive events are at most gapMs apart. */
export function clusterByGap(events: AuditEvent[], gapMs: number): AuditEvent[][] {
  const out: AuditEvent[][] = [];
  let cur: AuditEvent[] = [];
  for (const e of events) {
    if (cur.length > 0 && time(e) - time(cur[cur.length - 1]) > gapMs) {
      out.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function clock(e: AuditEvent): string {
  return new Date(e.createdAt).toISOString().slice(11, 16) + " UTC";
}

function span(events: AuditEvent[]): string {
  const a = clock(events[0]);
  const b = clock(events[events.length - 1]);
  return a === b ? tpl("at {time}", { time: a }) : tpl("between {from} and {to}", { from: a, to: b });
}

function cite(events: AuditEvent[]) {
  const actionIds = uniq(events.filter((e) => e.eventType.startsWith("action.") && e.actionId).map((e) => e.actionId!));
  const orderIds = uniq(events.filter((e) => e.eventType.startsWith("order.") && e.actionId).map((e) => e.actionId!));
  return { anchorId: events[0].id, auditEventIds: events.map((e) => e.id), actionIds, orderIds };
}

function list(xs: string[], max = 4): string {
  const shown = xs.slice(0, max).join(", ");
  return xs.length > max ? tpl("{shown} and {count} more", { shown, count: xs.length - max }) : shown;
}

/** Transfer action ID in a refused request path such as /api/actions/<id>/approve. */
function actionIdFromPath(path: unknown): string | undefined {
  return str(path)?.match(/\/api\/actions\/([^/]+)/)?.[1];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function crossUserProbe(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.probe;
  const hits = events.filter((e) => e.eventType === "request.refused" && e.detail.code === "NOT_FOUND");
  return clusterByGap(hits, R.gapMs)
    .filter((c) => c.length >= R.warning)
    .map((c) => ({
      code: "CROSS_USER_PROBE",
      severity: c.length >= R.critical ? "critical" : "warning",
      title: tpl("{count} requests for unavailable records", { count: c.length }),
      // A cluster has at least `warning` (3) events, so the plural form always applies.
      text: tpl(
        "{count} requests {span} asked for accounts, recipients or actions that don't exist or belong to someone else ({paths}). Each one was refused as \"not found\", and no other user's data was returned.",
        { count: c.length, span: span(c), paths: list(uniq(c.map((e) => str(e.detail.path) ?? "?"))) },
      ),
      advice: msg("If this wasn't you, sign out other sessions and review recent activity."),
      ...cite(c),
    }));
}

function unapprovedExecution(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.unapproved;
  const hits = events.filter(
    (e) => (e.eventType === "action.execute_refused" || e.eventType === "order.execute_refused"),
  );
  return clusterByGap(hits, R.gapMs)
    .filter((c) => c.length >= R.warning)
    .map((c) => {
      const reasons = uniq(c.map((e) => str(e.detail.reason) ?? "NOT_APPROVED"));
      return {
        code: "UNAPPROVED_EXECUTION",
        severity: c.length >= R.critical ? "critical" : "warning",
        title: c.length === 1 ? msg("Execution attempted without approval") : tpl("{count} executions attempted without approval", { count: c.length }),
        text:
          c.length === 1
            ? tpl(
                "1 execution request {span} targeted transfers or orders that were not approved ({reasons}). The server refused every one; no money moved.",
                { span: span(c), reasons: reasons.join(", ") },
              )
            : tpl(
                "{count} execution requests {span} targeted transfers or orders that were not approved ({reasons}). The server refused every one; no money moved.",
                { count: c.length, span: span(c), reasons: reasons.join(", ") },
              ),
        advice: msg("The app never offers Execute before you approve, so repeated attempts suggest a script or direct API calls."),
        ...cite(c),
      };
    });
}

function staleApprovalReplay(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.staleApproval;
  const hits = events.filter(
    (e) =>
      e.eventType === "action.approval_invalidated" ||
      e.eventType === "order.approval_invalidated" ||
      (e.eventType === "request.refused" && e.detail.code === "STALE_VERSION"),
  );
  return clusterByGap(hits, R.gapMs)
    .filter((c) => c.length >= R.warning)
    .map((c) => {
      const perAction = new Map<string, number>();
      for (const e of c) {
        const id = e.actionId ?? actionIdFromPath(e.detail.path);
        if (id) perAction.set(id, (perAction.get(id) ?? 0) + 1);
      }
      const repeated = [...perAction.values()].some((n) => n >= R.criticalPerAction);
      return {
        code: "STALE_APPROVAL_REPLAY",
        severity: repeated ? "critical" : "warning",
        title: repeated ? msg("Repeated use of an outdated approval") : msg("An approval no longer matched its transfer"),
        text:
          c.length === 1
            ? tpl(
                "1 attempt {span} used an approval or version that no longer matched the current transfer details. The approval was invalidated and nothing executed.",
                { span: span(c) },
              )
            : tpl(
                "{count} attempts {span} used an approval or version that no longer matched the current transfer details. The approval was invalidated and nothing executed.",
                { count: c.length, span: span(c) },
              ),
        advice: msg("Re-check the recipient and amount, then approve the current version only if you still want it."),
        ...cite(c),
      };
    });
}

const SWAP_FOLLOW_UPS = new Set([
  "action.proposed", "action.approved", "action.execute_refused", "action.approval_invalidated", "action.executed",
]);

/** Whole-sentence variants (one step vs several, executed vs not) so each is translatable as written. */
function swapText(recipientId: string, at: string, steps: number, types: string, executed: boolean): string {
  const minutes = THREAT_RULES.recipientSwap.withinMs / MIN;
  if (steps === 1) {
    return executed
      ? tpl(
          "Recipient {id}'s details changed at {time}, and 1 transfer step to that recipient followed within {minutes} minutes ({types}). Changed payment instructions just before a payment are a common fraud pattern. A transfer to the changed details executed.",
          { id: recipientId, time: at, minutes, types },
        )
      : tpl(
          "Recipient {id}'s details changed at {time}, and 1 transfer step to that recipient followed within {minutes} minutes ({types}). Changed payment instructions just before a payment are a common fraud pattern. No transfer to the changed details executed.",
          { id: recipientId, time: at, minutes, types },
        );
  }
  return executed
    ? tpl(
        "Recipient {id}'s details changed at {time}, and {count} transfer steps to that recipient followed within {minutes} minutes ({types}). Changed payment instructions just before a payment are a common fraud pattern. A transfer to the changed details executed.",
        { id: recipientId, time: at, count: steps, minutes, types },
      )
    : tpl(
        "Recipient {id}'s details changed at {time}, and {count} transfer steps to that recipient followed within {minutes} minutes ({types}). Changed payment instructions just before a payment are a common fraud pattern. No transfer to the changed details executed.",
        { id: recipientId, time: at, count: steps, minutes, types },
      );
}

function recipientSwap(events: AuditEvent[], lookups: ThreatLookups): ThreatSignal[] {
  const R = THREAT_RULES.recipientSwap;
  const out: ThreatSignal[] = [];
  for (const change of events.filter((e) => e.eventType === "recipient.changed")) {
    const recipientId = str(change.detail.recipientId);
    if (!recipientId) continue;
    const follow = events.filter((e) => {
      if (e.id <= change.id || time(e) - time(change) > R.withinMs || !SWAP_FOLLOW_UPS.has(e.eventType)) return false;
      const rid = str(e.detail.recipientId) ?? (e.actionId ? lookups.recipientOfAction?.(e.actionId) : null);
      return rid === recipientId;
    });
    if (follow.length === 0) continue;
    const cluster = [change, ...follow];
    const executed = follow.some((e) => e.eventType === "action.executed");
    out.push({
      code: "RECIPIENT_SWAP",
      severity: "critical",
      title: msg("Recipient bank details changed right before a transfer"),
      text: swapText(recipientId, clock(change), follow.length, list(uniq(follow.map((e) => e.eventType))), executed),
      advice: msg("Confirm the new details on a phone number you already trust before verifying or approving."),
      ...cite(cluster),
    });
  }
  return out;
}

function replayExecution(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.replay;
  const hits = events.filter((e) => e.eventType === "action.execute_duplicate" || e.eventType === "order.execute_duplicate");
  const byTarget = new Map<string, AuditEvent[]>();
  for (const e of hits) byTarget.set(e.actionId ?? "?", [...(byTarget.get(e.actionId ?? "?") ?? []), e]);
  return [...byTarget.values()].flatMap((evs) =>
    clusterByGap(evs, R.gapMs)
      .filter((c) => c.length >= R.warning)
      .map((c): ThreatSignal => ({
        code: "REPLAY_EXECUTION",
        severity: "warning",
        title: c[0].eventType.startsWith("order.")
          ? tpl("Completed order re-submitted {count} times", { count: c.length })
          : tpl("Completed transfer re-submitted {count} times", { count: c.length }),
        // A cluster has at least `warning` (2) events, so the plural form always applies.
        text: tpl(
          "{count} repeat execution requests {span} targeted {target}, which had already completed. Each returned the existing receipt; nothing executed twice.",
          { count: c.length, span: span(c), target: String(c[0].actionId) },
        ),
        advice: msg("Repeated submissions can be a stuck client or a replay attempt. No action is needed if this was you."),
        ...cite(c),
      })),
  );
}

const LIMIT_REASONS = new Set(["LIMIT_EXCEEDED", "DAILY_LIMIT_EXCEEDED"]);

function limitProbing(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.limitProbing;
  const hits = events.filter(
    (e) =>
      e.eventType === "action.held" &&
      Array.isArray(e.detail.reasons) &&
      (e.detail.reasons as unknown[]).some((r) => LIMIT_REASONS.has(String(r))),
  );
  return clusterByGap(hits, R.gapMs)
    .map((c) => ({ c, attempts: uniq(c.map((e) => `${e.actionId}:v${String(e.detail.version)}`)) }))
    .filter(({ attempts }) => attempts.length >= R.warning)
    .map(({ c, attempts }) => ({
      code: "LIMIT_PROBING",
      severity: "warning",
      title: tpl("{count} transfer attempts held at your limits", { count: attempts.length }),
      // At least `warning` (3) attempts, so the plural form always applies.
      text: tpl(
        "{count} transfer versions {span} were held for exceeding the per-transfer or daily limit. Trying amounts against a limit is a common way to find out how much can be moved.",
        { count: attempts.length, span: span(c) },
      ),
      advice: msg("Leave your limits as they are unless you meant to change them yourself."),
      ...cite(c),
    }));
}

function limitRaised(e: AuditEvent): boolean {
  const before = (e.detail.before ?? {}) as Record<string, unknown>;
  const patch = (e.detail.patch ?? {}) as Record<string, unknown>;
  return (["perTransferLimitCents", "dailyLimitCents"] as const).some(
    (k) => typeof patch[k] === "number" && typeof before[k] === "number" && (patch[k] as number) > (before[k] as number),
  );
}

function controlsThenSpend(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.controlsThenSpend;
  const out: ThreatSignal[] = [];
  const loosened = events.filter(
    (e) => e.eventType === "controls.resumed" || (e.eventType === "controls.updated" && limitRaised(e)),
  );
  for (const change of loosened) {
    const approvals = events.filter(
      (e) =>
        e.id > change.id &&
        time(e) - time(change) <= R.withinMs &&
        (e.eventType === "action.approved" || e.eventType === "order.approved"),
    );
    if (approvals.length === 0) continue;
    const resumed = change.eventType === "controls.resumed";
    const vars = { time: clock(change), count: approvals.length, minutes: R.withinMs / MIN };
    out.push({
      code: "CONTROLS_LOOSENED_THEN_SPEND",
      severity: "warning",
      title: resumed ? msg("Transfers were resumed shortly before an approval") : msg("A limit was raised shortly before an approval"),
      text: resumed
        ? approvals.length === 1
          ? tpl("Transfers were resumed at {time}, then 1 approval followed within {minutes} minutes. Loosening controls right before moving money is worth a second look.", vars)
          : tpl("Transfers were resumed at {time}, then {count} approvals followed within {minutes} minutes. Loosening controls right before moving money is worth a second look.", vars)
        : approvals.length === 1
          ? tpl("A limit was raised at {time}, then 1 approval followed within {minutes} minutes. Loosening controls right before moving money is worth a second look.", vars)
          : tpl("A limit was raised at {time}, then {count} approvals followed within {minutes} minutes. Loosening controls right before moving money is worth a second look.", vars),
      advice: msg("If you didn't change your controls, pause transfers and review the approved items."),
      ...cite([change, ...approvals]),
    });
  }
  return out;
}

function isInjection(e: AuditEvent): boolean {
  if (e.eventType === "assistant.untrusted_instructions") return true;
  return e.eventType === "assistant.prompt" && findInjectionMarkers(str(e.detail.text) ?? "").length > 0;
}

/** Whole-sentence variants (one vs several messages, with or without untrusted sources, proposal or none). */
function injectionText(p: { count: number; span: string; markers: string; sources: string | null; proposals: number }): string {
  const vars = { count: p.count, span: p.span, markers: p.markers, sources: p.sources ?? "", n: p.proposals };
  if (p.count === 1) {
    if (p.sources === null) {
      return p.proposals === 0
        ? tpl("1 message or document {span} tried to instruct the assistant ({markers}). The assistant drafted no proposal in response.", vars)
        : p.proposals === 1
          ? tpl("1 message or document {span} tried to instruct the assistant ({markers}). The assistant then drafted 1 proposal; it still needs your exact-version approval and policy checks.", vars)
          : tpl("1 message or document {span} tried to instruct the assistant ({markers}). The assistant then drafted {n} proposals; it still needs your exact-version approval and policy checks.", vars);
    }
    return p.proposals === 0
      ? tpl("1 message or document {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant drafted no proposal in response.", vars)
      : p.proposals === 1
        ? tpl("1 message or document {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant then drafted 1 proposal; it still needs your exact-version approval and policy checks.", vars)
        : tpl("1 message or document {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant then drafted {n} proposals; it still needs your exact-version approval and policy checks.", vars);
  }
  if (p.sources === null) {
    return p.proposals === 0
      ? tpl("{count} message or documents {span} tried to instruct the assistant ({markers}). The assistant drafted no proposal in response.", vars)
      : p.proposals === 1
        ? tpl("{count} message or documents {span} tried to instruct the assistant ({markers}). The assistant then drafted 1 proposal; it still needs your exact-version approval and policy checks.", vars)
        : tpl("{count} message or documents {span} tried to instruct the assistant ({markers}). The assistant then drafted {n} proposals; it still needs your exact-version approval and policy checks.", vars);
  }
  return p.proposals === 0
    ? tpl("{count} message or documents {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant drafted no proposal in response.", vars)
    : p.proposals === 1
      ? tpl("{count} message or documents {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant then drafted 1 proposal; it still needs your exact-version approval and policy checks.", vars)
      : tpl("{count} message or documents {span} tried to instruct the assistant ({markers}), including untrusted content from {sources}. The assistant then drafted {n} proposals; it still needs your exact-version approval and policy checks.", vars);
}

function promptInjection(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.injection;
  return clusterByGap(events.filter(isInjection), R.gapMs).map((c) => {
    const first = time(c[0]);
    const last = time(c[c.length - 1]);
    // A proposal the assistant drafted during or right after the injection: a model-layer slip worth flagging.
    const proposals = events.filter(
      (e) =>
        e.actor === "assistant" &&
        (e.eventType === "action.proposed" || e.eventType === "order.proposed") &&
        time(e) >= first &&
        time(e) - last <= R.gapMs,
    );
    const markers = uniq(
      c.flatMap((e) =>
        e.eventType === "assistant.prompt"
          ? findInjectionMarkers(str(e.detail.text) ?? "")
          : Array.isArray(e.detail.markers) ? (e.detail.markers as unknown[]).map(String) : [],
      ),
    );
    const sources = uniq(c.filter((e) => e.eventType === "assistant.untrusted_instructions").map((e) => str(e.detail.source) ?? "document"));
    return {
      code: "PROMPT_INJECTION",
      severity: proposals.length > 0 ? "critical" : "warning",
      title: proposals.length > 0 ? msg("Injected instructions followed by an assistant proposal") : msg("Prompt-injection attempt"),
      text: injectionText({
        count: c.length,
        span: span(c),
        markers: list(markers.map(injectionMarkerLabel)),
        sources: sources.length ? list(sources) : null,
        proposals: proposals.length,
      }),
      advice: msg("Review any assistant proposal carefully. Text in documents or messages can never approve or execute anything."),
      ...cite([...c, ...proposals].sort((a, b) => a.id - b.id)),
    };
  });
}

const PRIVILEGE_REFUSALS = new Set(["Unknown tool", "Refused: not available to this agent"]);

function privilegeText(tools: string, c: AuditEvent[]): string {
  const a = clock(c[0]);
  const b = clock(c[c.length - 1]);
  return a === b
    ? tpl("The assistant requested {tools} at {time}, which it is not allowed to use. The tool layer refused every call.", { tools, time: a })
    : tpl("The assistant requested {tools} between {from} and {to}, which it is not allowed to use. The tool layer refused every call.", { tools, from: a, to: b });
}

function privilegeAttempt(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.privilege;
  const hits = events.filter(
    (e) => e.eventType === "assistant.tool_call" && e.detail.ok === false && PRIVILEGE_REFUSALS.has(String(e.detail.summary)),
  );
  return clusterByGap(hits, R.gapMs)
    .filter((c) => c.length >= R.warning)
    .map((c) => ({
      code: "ASSISTANT_PRIVILEGE_ATTEMPT",
      severity: c.length >= R.critical ? "critical" : "warning",
      title: c.length === 1 ? msg("Assistant asked for a tool it doesn't have") : tpl("Assistant asked for unavailable tools {count} times", { count: c.length }),
      text: privilegeText(list(uniq(c.map((e) => str(e.detail.tool) ?? "?"))), c),
      advice: msg("This often follows a prompt-injection attempt. Check the conversation that triggered it."),
      ...cite(c),
    }));
}

const FAILURE_EVENTS = new Set(["action.failed", "order.failed", "agent.job_dead", "agent.scope_violation"]);

function failureText(events: string, c: AuditEvent[], scope: boolean): string {
  const a = clock(c[0]);
  const b = clock(c[c.length - 1]);
  if (a === b) {
    return scope
      ? tpl("{events} at {time}. The agent's out-of-scope read was blocked and its run failed.", { events, time: a })
      : tpl("{events} at {time}. Failed simulated operations roll back completely; no partial debit or credit was made.", { events, time: a });
  }
  return scope
    ? tpl("{events} between {from} and {to}. The agent's out-of-scope read was blocked and its run failed.", { events, from: a, to: b })
    : tpl("{events} between {from} and {to}. Failed simulated operations roll back completely; no partial debit or credit was made.", { events, from: a, to: b });
}

function executionFailure(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.failure;
  return clusterByGap(events.filter((e) => FAILURE_EVENTS.has(e.eventType)), R.gapMs).map((c) => {
    const scope = c.some((e) => e.eventType === "agent.scope_violation");
    return {
      code: "EXECUTION_FAILURE",
      severity: scope ? "critical" : "warning",
      title: scope
        ? msg("A background agent tried to read outside its scope")
        : c.length === 1
          ? msg("1 operation failed")
          : tpl("{count} operations failed", { count: c.length }),
      text: failureText(list(uniq(c.map((e) => e.eventType))), c, scope),
      advice: msg("Check the affected items' status before retrying."),
      ...cite(c),
    };
  });
}

function transferVelocity(events: AuditEvent[]): ThreatSignal[] {
  const R = THREAT_RULES.velocity;
  return clusterByGap(events.filter((e) => e.eventType === "action.executed"), R.gapMs)
    .filter((c) => c.length >= R.warning)
    .map((c) => ({
      code: "TRANSFER_VELOCITY",
      severity: "warning",
      title: tpl("{count} transfers executed in quick succession", { count: c.length }),
      // At least `warning` (5) transfers, so the plural form always applies.
      text: tpl("{count} transfers executed {span}, faster than typical activity.", { count: c.length, span: span(c) }),
      advice: msg("If you didn't make these, pause transfers and review the receipts."),
      ...cite(c),
    }));
}

/** All signals in `events` (oldest first) whose latest event is recent relative to `now`. Pure. */
export function detectThreats(events: AuditEvent[], now: Date, lookups: ThreatLookups = {}): ThreatSignal[] {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  const signals = [
    ...crossUserProbe(sorted),
    ...unapprovedExecution(sorted),
    ...staleApprovalReplay(sorted),
    ...recipientSwap(sorted, lookups),
    ...replayExecution(sorted),
    ...limitProbing(sorted),
    ...controlsThenSpend(sorted),
    ...promptInjection(sorted),
    ...privilegeAttempt(sorted),
    ...executionFailure(sorted),
    ...transferVelocity(sorted),
  ];
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const cutoff = now.getTime() - THREAT_RULES.reportRecentMs;
  return signals.filter((s) => {
    const latest = Math.max(...s.auditEventIds.map((id) => time(byId.get(id)!)));
    return latest >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const threatSweep: AgentHandler = (ctx) => {
  const sinceIso = new Date(ctx.now.getTime() - THREAT_RULES.lookbackMs).toISOString();
  const events = ctx.read.audit.list({ sinceIso });

  const recipients = new Map<string, string | null>();
  const recipientOfAction = (actionId: string) => {
    if (!recipients.has(actionId)) recipients.set(actionId, ctx.read.actions.get(actionId)?.recipientId ?? null);
    return recipients.get(actionId)!;
  };

  const signals = detectThreats(events, ctx.now, { recipientOfAction });
  for (const s of signals) {
    // Only cite actions the user owns; IDs typed into refused requests are left out.
    const actionIds = s.actionIds.filter((id) => ctx.read.actions.get(id) !== null);
    ctx.insights.upsert({
      type: "security_threat",
      severity: s.severity,
      title: s.title,
      body: tpl("{text}\n\nWhat you can do: {advice}\n\n{disclaimer}", {
        text: s.text,
        advice: s.advice,
        disclaimer: msg(
          "Advisory only: the threat monitor cannot pause, hold, approve or execute anything. Rule-based check of synthetic activity; not a guarantee that every attack is detected.",
        ),
      }),
      evidence: {
        signal: s.code,
        auditEventIds: s.auditEventIds,
        actionIds,
        orderIds: s.orderIds,
      },
      dedupeKey: `threat:${s.code}:${s.anchorId}`,
    });
  }

  const codes = uniq(signals.map((s) => s.code));
  return {
    summary: signals.length
      ? signals.length === 1
        ? tpl("1 threat signal: {codes} ({events} events reviewed)", { codes: codes.join(", "), events: events.length })
        : tpl("{count} threat signals: {codes} ({events} events reviewed)", {
            count: signals.length,
            codes: codes.join(", "),
            events: events.length,
          })
      : tpl("No threat signals in {count} audit events", { count: events.length }),
    data: { signals: codes, eventsReviewed: events.length },
  };
};
