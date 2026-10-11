/**
 * Inline gates: checks that must finish BEFORE a chat reply or tool result is
 * released. The background monitor only explains what happened afterwards; it
 * can't un-disclose anything, so prevention lives here.
 *
 *  - Rate limit: a fixed per-user request budget per minute (server-enforced).
 *  - Tool budget: a fixed number of tool calls per turn; the model can't extend it.
 *  - Output gate: the reply is fully buffered (never streamed), then checked for
 *    defined sensitive-data patterns and for transfer/order status or amount
 *    claims that contradict Onera's own records. A failing check withholds the
 *    reply and substitutes a status built from structured server data.
 *
 * Pure functions over plain data: callers read the authoritative records with
 * user-scoped services and pass them in. Pattern matching is fallible: it finds
 * the identified contradictions below, not every unsupported sentence.
 */
import { findSensitiveData, sensitiveLabel } from "@/lib/security/redact";
import type { EventReason } from "./types";

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT = 12;
/** Tool calls allowed in one chat turn, across all model iterations. */
export const MAX_TOOL_CALLS_PER_TURN = 16;

export function chatRateLimit(): number {
  const n = Number(process.env.CLEARFI_CHAT_RATE_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Output gate
// ---------------------------------------------------------------------------

/** A transfer action or paper order the reply may talk about, read from the server. */
export interface RecordEvidence {
  kind: "transfer" | "order";
  id: string;
  state: string;
  /** Integer cents, or null when the record has no fixed amount (share-quantity orders). */
  amountCents: number | null;
  /** e.g. "to Oak Street Properties" or "buy VTI". */
  label: string;
  holdReasons: string[];
  /** Proposed during this turn. */
  proposedThisTurn: boolean;
}

export interface OutputEvidence {
  /** Proposals from this turn plus any records the reply cites by ID (user-scoped lookups). */
  records: RecordEvidence[];
}

export interface ClaimIssue {
  reason: Extract<EventReason, "UNSUPPORTED_EXECUTION_CLAIM" | "AMOUNT_MISMATCH" | "AMBIGUOUS_CLAIM">;
  recordId: string | null;
  /** What the reply claimed, in plain words (no excerpt of the reply). */
  claimed: string;
  /** What the record says. */
  actual: string | null;
}

export interface OutputDecision {
  release: boolean;
  /** Deny reasons when withheld; AMBIGUOUS_CLAIM may appear on a released reply. */
  reasons: EventReason[];
  sensitive: string[];
  issues: ClaimIssue[];
  /** Record IDs the decision relied on. */
  evidenceIds: string[];
}

const ID_PATTERN = /\b(act_[a-f0-9]{6,}|ord_[a-f0-9]{6,})\b/g;

/** act_/ord_ IDs mentioned in a reply, so the caller can look them up for the gate. */
export function referencedRecordIds(reply: string): string[] {
  return [...new Set(reply.match(ID_PATTERN) ?? [])];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Words that make a status phrase conditional, negated or future rather than a claim. */
const NEGATION = /\b(not|never|no|until|once|after|before|when|if|will|would|can|cannot|could|must|need|needs|should|awaiting|pending|unless|only)\b|n't\b/i;

/** "I've sent / I executed / I approved …" — the assistant has no tool that does any of these. */
const FIRST_PERSON = /\bI(?:'ve|’ve| have| just| already| now| successfully)*\s+(executed|approved|filled|bought|sold|wired|sent|transferred|moved|paid|completed)\b/i;
/** Verbs that are only a money claim when the sentence is about money. */
const WEAK_VERB = /^(sent|transferred|moved|paid|completed)$/i;
const MONEY_CUE = /\$\s?\d|\b(transfer|payment|money|funds|rent|order|trade|shares?|cash)\b/i;

/** "The transfer has been completed", "payment was sent", "order filled", "transfer complete". */
const STATUS_CLAIM =
  /\b(transfer|payment|order|money|funds|rent|trade)\b([^.!?\n]{0,48}?)\b(?:has been|have been|was|were|is now|is|are now|are|got)\s+(?:successfully\s+|already\s+|now\s+)?(completed|complete|executed|sent|processed|filled|transferred|moved|paid|approved)\b|\b(transfer|payment|order|trade)\s+(complete|completed|executed|sent|successful|filled)\b/i;

const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
/** Amounts next to these words describe limits or balances, not the proposal itself. */
const CONTEXT_AMOUNT =
  /\b(limit|limits|balance|available|budget|remaining|daily|cap|maximum|minimum|spent|spending|income|average|typical|used|last|previous|earlier|ago|history|month|week|year)\b/i;

/** Dollar amounts in a sentence, in cents, skipping ones that describe limits or balances. */
function proposalAmountsInCents(sentence: string): number[] {
  return [...sentence.matchAll(DOLLARS)]
    .filter((m) => {
      const start = m.index ?? 0;
      const around = sentence.slice(Math.max(0, start - 25), start) + sentence.slice(start + m[0].length, start + m[0].length + 25);
      return !CONTEXT_AMOUNT.test(around);
    })
    .map((m) => {
      const whole = Number(m[1].replace(/,/g, ""));
      const frac = m[2] ? Number(m[2].padEnd(2, "0")) : 0;
      return whole * 100 + frac;
    });
}

const formatUsd = (cents: number) =>
  `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;

function claimedState(verb: string): "EXECUTED" | "APPROVED" {
  return /approved/i.test(verb) ? "APPROVED" : "EXECUTED";
}

function satisfies(actual: string, claimed: "EXECUTED" | "APPROVED"): boolean {
  return claimed === "APPROVED" ? actual === "APPROVED" || actual === "EXECUTED" : actual === "EXECUTED";
}

/**
 * Decides whether a buffered reply may be released. Throwing is a bug; the
 * caller treats a throw as "check unavailable" and withholds the reply.
 */
export function checkOutput(reply: string, evidence: OutputEvidence): OutputDecision {
  const sensitive = findSensitiveData(reply);
  const issues: ClaimIssue[] = [];
  const byId = new Map(evidence.records.map((r) => [r.id, r]));
  const thisTurn = evidence.records.filter((r) => r.proposedThisTurn);
  const used = new Set<string>();

  for (const s of sentences(reply)) {
    const ids = (s.match(ID_PATTERN) ?? []).filter((id) => byId.has(id));
    const mentionsProposal = /\bpropos(al|ed|e)\b|\bdraft(ed)?\b/i.test(s);
    // Referent: an ID in the sentence, else the single proposal from this turn.
    const referents =
      ids.length > 0 ? ids.map((id) => byId.get(id)!) : thisTurn.length === 1 ? [thisTurn[0]] : [];

    // --- First-person execution claims: always contradicted by the tool set ---
    const fp = s.match(FIRST_PERSON);
    const fpIsMoney = fp && (!WEAK_VERB.test(fp[1]) || MONEY_CUE.test(s));
    if (fp && fpIsMoney && !mentionsProposal && !/\brequest(ed)?\b|\bfor (your )?approval\b/i.test(s)) {
      const target = referents[0] ?? null;
      issues.push({
        reason: "UNSUPPORTED_EXECUTION_CLAIM",
        recordId: target?.id ?? null,
        claimed: `the assistant ${fp[1].toLowerCase()} it`,
        actual: target ? `${target.kind} ${target.id} is ${target.state}` : "the assistant has no tool that executes or approves",
      });
      if (target) used.add(target.id);
      continue;
    }

    // --- Status claims about a transfer/order ------------------------------------
    const sc = s.match(STATUS_CLAIM);
    // Negation only counts in the claim's own clause: before the subject or between subject and verb.
    if (sc && !NEGATION.test(s.slice(0, sc.index ?? 0) + (sc[2] ?? ""))) {
      const verb = sc[4] ?? sc[6] ?? "";
      const claimed = claimedState(verb);
      if (referents.length === 0) {
        issues.push({ reason: "AMBIGUOUS_CLAIM", recordId: null, claimed: `a ${sc[1] ?? sc[5]} is ${verb.toLowerCase()}`, actual: null });
      } else {
        for (const r of referents) {
          used.add(r.id);
          if (!satisfies(r.state, claimed)) {
            issues.push({
              reason: "UNSUPPORTED_EXECUTION_CLAIM",
              recordId: r.id,
              claimed: `${r.kind} ${r.id} is ${claimed}`,
              actual: `${r.kind} ${r.id} is ${r.state}`,
            });
          }
        }
      }
    }

    // --- Amount claims about a referenced proposal ---------------------------------
    const amounts = proposalAmountsInCents(s);
    if (amounts.length === 0) continue;
    const mentionsKind = /\b(transfer|payment|order)\b/i.test(s);
    const amountReferents = ids.length > 0 || mentionsProposal || sc || mentionsKind ? referents : [];
    for (const r of amountReferents) {
      if (r.amountCents === null) continue;
      used.add(r.id);
      if (!amounts.includes(r.amountCents)) {
        issues.push({
          reason: "AMOUNT_MISMATCH",
          recordId: r.id,
          claimed: `${r.kind} ${r.id} for ${amounts.map(formatUsd).join(" / ")}`,
          actual: `${r.kind} ${r.id} is for ${formatUsd(r.amountCents)}`,
        });
      }
    }
  }

  const blocking = issues.filter((i) => i.reason !== "AMBIGUOUS_CLAIM");
  const reasons: EventReason[] = [];
  if (sensitive.length > 0) reasons.push("SENSITIVE_DATA");
  for (const r of ["UNSUPPORTED_EXECUTION_CLAIM", "AMOUNT_MISMATCH", "AMBIGUOUS_CLAIM"] as const) {
    if (issues.some((i) => i.reason === r)) reasons.push(r);
  }
  return {
    release: sensitive.length === 0 && blocking.length === 0,
    reasons,
    sensitive,
    issues,
    evidenceIds: [...new Set([...used, ...thisTurn.map((r) => r.id)])],
  };
}

/** The reply shown instead of a withheld one. Built only from structured server data. */
export function withheldReply(decision: Pick<OutputDecision, "sensitive" | "issues">, evidence: OutputEvidence,
  opts: { checkUnavailable?: boolean } = {}): string {
  const why = opts.checkUnavailable
    ? "a required safety check couldn't complete"
    : decision.sensitive.length > 0
      ? `it contained data the assistant must never display (${decision.sensitive.map(sensitiveLabel).join(", ")})`
      : "it described a transfer or order status or amount that doesn't match Onera's records";
  const lines = [`I can't show that reply because ${why}.`];
  const records = evidence.records.filter((r) => r.proposedThisTurn || decision.issues.some((i) => i.recordId === r.id));
  if (records.length > 0) {
    lines.push("Verified status from Onera's records:");
    for (const r of records) {
      const amount = r.amountCents !== null ? `${formatUsd(r.amountCents)} ` : "";
      const held = r.holdReasons.length > 0 ? ` (${r.holdReasons.join(", ")})` : "";
      lines.push(`• ${r.kind === "transfer" ? "Transfer" : "Paper order"} ${r.id}: ${amount}${r.label} — ${r.state}${held}`);
    }
    lines.push("Nothing moves without your approval of the exact version on its card.");
  } else {
    lines.push("Nothing was approved or executed by the assistant. Please ask again or check the Transfers page.");
  }
  return lines.join("\n");
}
