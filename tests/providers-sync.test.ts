/**
 * Sync-lifecycle acceptance tests for the simulated providers module:
 * pending → posted, hold removal, internal-transfer grouping, downstream job
 * enqueueing and multi-currency net worth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the real queue so calls are observable while jobs are still written.
vi.mock("@/lib/agents/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/queue")>();
  return { ...actual, enqueueJob: vi.fn(actual.enqueueJob) };
});

import { enqueueJob } from "@/lib/agents/queue";
import { openDb, type DB } from "@/lib/db";
import type { TransactionRow } from "@/lib/db/rows";
import { listAccounts, netWorth } from "@/lib/finance/accounts";
import { convertToUsdCents, DEMO_FX_RATES } from "@/lib/finance/fx";
import { isSpending, spendingSummary } from "@/lib/finance/spending";
import { toTransaction } from "@/lib/db/rows";
import { getPortfolio } from "@/lib/markets";
import type { UserId } from "@/lib/types";
import { linkInstitution, linkInstitutionWithSummary, syncConnection } from "@/lib/providers";
import { accountIdFor } from "@/lib/providers/catalog";
import { DAY_MS, occurrencesBetween, type Occurrence } from "@/lib/providers/generator";

const AS_OF = new Date("2026-10-10T12:00:00.000Z");
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const enqueueMock = vi.mocked(enqueueJob);

beforeEach(() => {
  enqueueMock.mockClear();
});

function testDb(): DB {
  return openDb(":memory:", AS_OF);
}

const at = (ms: number) => new Date(ms);

function providerRows(db: DB, userId: string, accountId: string, providerTxId: string): TransactionRow[] {
  return db
    .prepare("SELECT * FROM transactions WHERE user_id = ? AND account_id = ? AND provider_tx_id = ?")
    .all(userId, accountId, providerTxId) as TransactionRow[];
}

/** Every synced row of a user, keyed by id, as a comparable snapshot. */
function syncedSnapshot(db: DB, userId: string): Record<string, string> {
  const rows = db
    .prepare("SELECT * FROM transactions WHERE user_id = ? AND provider_tx_id IS NOT NULL ORDER BY id")
    .all(userId) as TransactionRow[];
  return Object.fromEntries(
    rows.map((r) => [r.id, `${r.status}|${r.amount_cents}|${r.posted_at}|${r.transfer_group_id ?? "-"}`]),
  );
}

function duplicateProviderIds(db: DB, userId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT account_id, provider_tx_id FROM transactions
           WHERE user_id = ? AND provider_tx_id IS NOT NULL
           GROUP BY account_id, provider_tx_id HAVING COUNT(*) > 1)`,
      )
      .get(userId) as { n: number }
  ).n;
}

/** First occurrence after AS_OF (and within 90 days) matching the predicate. */
function findOccurrence(
  userId: string,
  institutionId: string,
  pred: (o: Occurrence) => boolean,
): Occurrence {
  const found = occurrencesBetween(userId as UserId, institutionId, AS_OF.getTime() + HOUR_MS, AS_OF.getTime() + 90 * DAY_MS)
    .filter(pred)
    .sort((a, b) => a.atMs - b.atMs)[0];
  expect(found, `no matching occurrence for ${userId}/${institutionId}`).toBeDefined();
  return found!;
}

// ---------------------------------------------------------------------------
// (a) pending → posted
// ---------------------------------------------------------------------------

describe("pending transactions that later post", () => {
  it("updates the same row in place (with the tip) instead of inserting a second one", () => {
    const db = testDb();
    // Bob's Bank of America card: restaurant charges post 24–48h later with an 18% tip.
    const occ = findOccurrence("bob", "ins_boa", (o) => o.lifecycle.type === "pending_post" && o.merchant === "Taqueria Sol");
    if (occ.lifecycle.type !== "pending_post") throw new Error("unreachable");
    const accountId = accountIdFor("bob", "ins_boa", occ.accountKey);
    const conn = "conn_bob_boa";

    // Appears pending.
    syncConnection(db, "bob", conn, at(occ.atMs + MINUTE_MS));
    const pending = providerRows(db, "bob", accountId, occ.providerTxId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending", amount_cents: occ.lifecycle.pendingCents });
    expect(occ.lifecycle.finalCents).not.toBe(occ.lifecycle.pendingCents); // tip changes the amount

    // Posts: same row, new status and final amount, reported as modified and as newly posted.
    const posted = syncConnection(db, "bob", conn, at(occ.lifecycle.postAtMs + MINUTE_MS));
    const after = providerRows(db, "bob", accountId, occ.providerTxId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: pending[0].id,
      status: "posted",
      amount_cents: occ.lifecycle.finalCents,
      posted_at: pending[0].posted_at,
    });
    expect(posted.modified).toBeGreaterThanOrEqual(1);
    expect(posted.newTransactionIds).toContain(pending[0].id);

    // Re-delivery of the (stale) "added" and the "modified" events changes nothing.
    const again = syncConnection(db, "bob", conn, at(occ.lifecycle.postAtMs + 2 * HOUR_MS));
    expect(again.newTransactionIds).not.toContain(pending[0].id);
    expect(providerRows(db, "bob", accountId, occ.providerTxId)).toEqual(after);
    expect(duplicateProviderIds(db, "bob")).toBe(0);
  });

  it("converges to the same rows whether synced in small overlapping steps or one jump", () => {
    const stepped = testDb();
    const jumped = testDb();
    // 16 days covers pending posts, hold removals, Alice's Chase autopay (debited at TD on the 21st,
    // credited 2 days later) and month-end card autopay at both banks.
    const end = AS_OF.getTime() + 16 * DAY_MS;
    const connections = [
      ["bob", "conn_bob_boa"],
      ["alice", "conn_alice_td"],
      ["alice", "conn_alice_chase"],
      ["alice", "conn_alice_barclays_uk"],
    ] as const;
    for (let t = AS_OF.getTime() + 7 * HOUR_MS; t < end; t += 7 * HOUR_MS) {
      for (const [user, conn] of connections) syncConnection(stepped, user, conn, at(t));
    }
    for (const db of [stepped, jumped]) {
      for (const [user, conn] of connections) syncConnection(db, user, conn, at(end));
    }

    for (const user of ["bob", "alice"]) {
      expect(syncedSnapshot(stepped, user)).toEqual(syncedSnapshot(jumped, user));
      expect(duplicateProviderIds(stepped, user)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) provider removals
// ---------------------------------------------------------------------------

describe("provider-removed transactions", () => {
  it("deletes a removed authorization hold and never resurrects it on repeated syncs", () => {
    const db = testDb();
    // Alice's TD card: fuel pre-authorization holds are removed 26h later and the final charge posts.
    const hold = findOccurrence("alice", "ins_td", (o) => o.lifecycle.type === "hold");
    if (hold.lifecycle.type !== "hold") throw new Error("unreachable");
    const accountId = accountIdFor("alice", "ins_td", hold.accountKey);
    const finalProviderTxId = hold.providerTxId.replace(/-auth$/, "");
    const conn = "conn_alice_td";

    syncConnection(db, "alice", conn, at(hold.atMs + MINUTE_MS));
    expect(providerRows(db, "alice", accountId, hold.providerTxId)).toMatchObject([
      { status: "pending", amount_cents: hold.lifecycle.amountCents },
    ]);

    const removal = syncConnection(db, "alice", conn, at(hold.lifecycle.removeAtMs + MINUTE_MS));
    expect(removal.removed).toBeGreaterThanOrEqual(1);
    expect(providerRows(db, "alice", accountId, hold.providerTxId)).toHaveLength(0);
    // The final charge is a separate, posted transaction.
    expect(providerRows(db, "alice", accountId, finalProviderTxId)).toMatchObject([{ status: "posted" }]);

    // Later syncs at, inside and just past the 12h re-delivery overlap, and days later.
    for (const offset of [MINUTE_MS, 2 * HOUR_MS, 11 * HOUR_MS, 13 * HOUR_MS, 3 * DAY_MS]) {
      const s = syncConnection(db, "alice", conn, at(hold.lifecycle.removeAtMs + offset));
      expect(s.removed).toBe(0);
      expect(providerRows(db, "alice", accountId, hold.providerTxId)).toHaveLength(0);
    }
    // A sync with an older clock than the cursor cannot bring it back either.
    syncConnection(db, "alice", conn, at(hold.atMs + 2 * HOUR_MS));
    expect(providerRows(db, "alice", accountId, hold.providerTxId)).toHaveLength(0);
    expect(duplicateProviderIds(db, "alice")).toBe(0);
  });

  it("does not insert a hold that was added and removed between two syncs", () => {
    const db = testDb();
    const hold = findOccurrence("alice", "ins_td", (o) => o.lifecycle.type === "hold");
    if (hold.lifecycle.type !== "hold") throw new Error("unreachable");
    const accountId = accountIdFor("alice", "ins_td", hold.accountKey);

    const s = syncConnection(db, "alice", "conn_alice_td", at(hold.lifecycle.removeAtMs + HOUR_MS));
    expect(providerRows(db, "alice", accountId, hold.providerTxId)).toHaveLength(0);
    expect(s.newTransactionIds.some((id) => id.endsWith("-auth"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) internal transfers
// ---------------------------------------------------------------------------

describe("internal transfers between the user's own accounts", () => {
  /** Alice is seeded with TD (checking, savings, card), Chase (card paid from TD checking) and Barclays. */
  function groups(db: DB, userId: string, predicate: string): Map<string, TransactionRow[]> {
    const rows = db
      .prepare(
        `SELECT * FROM transactions WHERE user_id = ? AND provider_tx_id IS NOT NULL AND ${predicate} ORDER BY posted_at`,
      )
      .all(userId) as TransactionRow[];
    const out = new Map<string, TransactionRow[]>();
    for (const r of rows) {
      const g = r.transfer_group_id ?? `__ungrouped_${r.id}`;
      out.set(g, [...(out.get(g) ?? []), r]);
    }
    return out;
  }

  function expectPairedLegs(legs: TransactionRow[] | undefined, accounts: [string, string]) {
    expect(legs).toBeDefined();
    expect(legs!).toHaveLength(2);
    const [out, inn] = [...legs!].sort((a, b) => a.amount_cents - b.amount_cents);
    expect(out.amount_cents).toBeLessThan(0);
    expect(out.amount_cents + inn.amount_cents).toBe(0);
    expect(out.currency).toBe(inn.currency);
    expect(out.transfer_group_id).not.toBeNull();
    expect(out.transfer_group_id).toBe(inn.transfer_group_id);
    expect([out.account_id, inn.account_id]).toEqual(accounts);
  }

  it("groups both legs of same-institution moves, card autopay and cross-institution card payments", () => {
    const db = testDb();
    const tdChecking = "acct_alice_td_checking";

    // Same-institution savings transfer (provider-grouped).
    const save = groups(db, "alice", "provider_tx_id LIKE 'td-save-%'");
    expect(save.size).toBeGreaterThan(0);
    for (const legs of save.values()) expectPairedLegs(legs, [tdChecking, "acct_alice_td_savings"]);

    // Same-institution card autopay (provider-grouped).
    const cardpay = groups(db, "alice", "provider_tx_id LIKE 'td-cardpay-%'");
    expect(cardpay.size).toBeGreaterThan(0);
    for (const legs of cardpay.values()) expectPairedLegs(legs, [tdChecking, "acct_alice_td_card"]);

    // Cross-institution: TD checking debit + Chase card credit (2-day lag), matched by Onera.
    const xpay = groups(
      db,
      "alice",
      "(provider_tx_id LIKE 'td-xpay_chase-%' OR provider_tx_id LIKE 'chase-xpay-%')",
    );
    expect(xpay.size).toBeGreaterThan(0);
    for (const [group, legs] of xpay) {
      expect(group.startsWith("tg_alice_m_")).toBe(true);
      expectPairedLegs(legs, [tdChecking, "acct_alice_chase_card"]);
    }

    // Foreign-currency transfer legs are grouped too.
    const gbp = groups(db, "alice", "provider_tx_id LIKE 'barclays_uk-save-%'");
    expect(gbp.size).toBeGreaterThan(0);
    for (const legs of gbp.values()) {
      expectPairedLegs(legs, ["acct_alice_barclays_uk_current", "acct_alice_barclays_uk_savings"]);
      expect(legs[0].currency).toBe("GBP");
    }

    // No posted provider transfer is left without its partner.
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions WHERE user_id = 'alice' AND provider_tx_id IS NOT NULL
           AND category = 'transfer' AND status = 'posted' AND transfer_group_id IS NULL`,
      )
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it("excludes every transfer leg from spendingSummary totals", () => {
    const db = testDb();
    // September holds the TD savings transfer, TD card autopay and the Chase cross-institution payment.
    const asOf = new Date("2026-09-15T12:00:00.000Z");
    const monthRows = (db
      .prepare("SELECT * FROM transactions WHERE user_id = 'alice' AND posted_at >= ? AND posted_at < ?")
      .all("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z") as TransactionRow[]).map(toTransaction);
    const transferOut = monthRows.filter((t) => t.transferGroupId !== null && t.amountCents < 0);
    const kinds = new Set(transferOut.map((t) => t.providerTxId?.replace(/-\d+(-out)?$/, "")));
    for (const k of ["td-save", "td-cardpay", "td-xpay_chase", "barclays_uk-save"]) expect(kinds.has(k)).toBe(true);

    const usd = (t: (typeof monthRows)[number]) =>
      t.currency === "USD" ? t.amountCents : convertToUsdCents(t.amountCents, DEMO_FX_RATES[t.currency]);
    const summary = spendingSummary(db, "alice", asOf);
    expect(summary.month).toBe("2026-09");
    expect(summary.totalCents).toBe(monthRows.filter(isSpending).reduce((s, t) => s - usd(t), 0));
    expect(summary.excludedInternalTransferCents).toBe(transferOut.reduce((s, t) => s - usd(t), 0));
    expect(summary.excludedInternalTransferCents).toBeGreaterThan(0);

    // Un-grouping the cross-institution payment would count it as spending: the grouping is what excludes it.
    const xpayOut = transferOut.find((t) => t.providerTxId?.startsWith("td-xpay_chase-"))!;
    db.prepare("UPDATE transactions SET transfer_group_id = NULL WHERE user_id = 'alice' AND transfer_group_id = ?")
      .run(xpayOut.transferGroupId);
    expect(spendingSummary(db, "alice", asOf).totalCents).toBe(summary.totalCents - xpayOut.amountCents);
  });

  it("matches a cross-institution payment once its second leg arrives, then keeps the group stable", () => {
    const db = testDb();
    // Next Chase autopay: debited from TD checking on the 21st, credited to the card 2 days later.
    const debit = findOccurrence("alice", "ins_td", (o) => o.providerTxId.startsWith("td-xpay_chase-"));
    const credit = findOccurrence("alice", "ins_chase", (o) => o.providerTxId.startsWith("chase-xpay-"));
    expect(credit.atMs).toBeGreaterThan(debit.atMs);

    syncConnection(db, "alice", "conn_alice_td", at(debit.atMs + HOUR_MS));
    syncConnection(db, "alice", "conn_alice_chase", at(debit.atMs + HOUR_MS));
    const [debitRow] = providerRows(db, "alice", "acct_alice_td_checking", debit.providerTxId);
    expect(debitRow.transfer_group_id).toBeNull(); // partner not delivered yet

    syncConnection(db, "alice", "conn_alice_chase", at(credit.atMs + HOUR_MS));
    const [matchedDebit] = providerRows(db, "alice", "acct_alice_td_checking", debit.providerTxId);
    const [creditRow] = providerRows(db, "alice", "acct_alice_chase_card", credit.providerTxId);
    expect(matchedDebit.transfer_group_id).not.toBeNull();
    expect(creditRow.transfer_group_id).toBe(matchedDebit.transfer_group_id);

    // Further syncs on both connections keep the same group.
    syncConnection(db, "alice", "conn_alice_td", at(credit.atMs + 2 * HOUR_MS));
    syncConnection(db, "alice", "conn_alice_chase", at(credit.atMs + 2 * HOUR_MS));
    expect(providerRows(db, "alice", "acct_alice_td_checking", debit.providerTxId)[0].transfer_group_id)
      .toBe(matchedDebit.transfer_group_id);
  });
});

// ---------------------------------------------------------------------------
// (d) downstream jobs
// ---------------------------------------------------------------------------

describe("jobs enqueued after sync", () => {
  it("enqueues user-scoped spending and subscription reviews when a sync brings new posted transactions", () => {
    const db = testDb();
    expect(enqueueMock).not.toHaveBeenCalled(); // seeding never enqueues

    const later = at(AS_OF.getTime() + 7 * DAY_MS);
    const summary = syncConnection(db, "bob", "conn_bob_boa", later);
    expect(summary.newTransactionIds.length).toBeGreaterThan(0);

    const calls = enqueueMock.mock.calls.map(([, job]) => job);
    expect(calls.map((j) => j.type).sort()).toEqual(["spending_review", "subscription_review"]);
    for (const job of calls) {
      expect(job.userId).toBe("bob");
      expect(job.dedupeKey).toBe(`${job.type}:bob:conn_bob_boa:${later.toISOString()}`);
      expect(job.payload).toEqual({
        connectionId: "conn_bob_boa",
        syncedAt: later.toISOString(),
        newTransactionIds: summary.newTransactionIds,
      });
    }
    const jobs = db
      .prepare("SELECT user_id, type, dedupe_key FROM jobs WHERE dedupe_key LIKE '%conn_bob_boa%' ORDER BY type")
      .all() as { user_id: string; type: string; dedupe_key: string }[];
    expect(jobs.map((j) => [j.user_id, j.type])).toEqual([
      ["bob", "spending_review"],
      ["bob", "subscription_review"],
    ]);
  });

  it("enqueues nothing when a sync has no new data", () => {
    const db = testDb();
    const later = at(AS_OF.getTime() + 7 * DAY_MS);
    syncConnection(db, "bob", "conn_bob_boa", later);
    enqueueMock.mockClear();
    const jobsBefore = (db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;

    const repeat = syncConnection(db, "bob", "conn_bob_boa", later);
    const atSeed = syncConnection(db, "alice", "conn_alice_td", AS_OF);
    expect(repeat.newTransactionIds).toEqual([]);
    expect(atSeed.newTransactionIds).toEqual([]);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect((db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n).toBe(jobsBefore);
  });

  it("enqueues reviews for the initial history sync when a user links a new institution", () => {
    const db = testDb();
    const { sync } = linkInstitutionWithSummary(db, "bob", "ins_chase", AS_OF);
    expect(sync.newTransactionIds.length).toBeGreaterThan(0);
    const keys = enqueueMock.mock.calls.map(([, job]) => job.dedupeKey).sort();
    expect(keys).toEqual([
      `spending_review:bob:conn_bob_chase:${AS_OF.toISOString()}`,
      `subscription_review:bob:conn_bob_chase:${AS_OF.toISOString()}`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// (e) multi-currency net worth
// ---------------------------------------------------------------------------

describe("net worth with foreign-currency linked accounts", () => {
  it("converts GBP and CAD balances with the demo FX rate and excludes paper accounts", () => {
    const db = testDb();
    linkInstitution(db, "alice", "ins_rbc", AS_OF);
    const accounts = listAccounts(db, "alice");
    const gbp = accounts.filter((a) => a.currency === "GBP");
    const cad = accounts.filter((a) => a.currency === "CAD");
    const paper = accounts.filter((a) => a.paper);
    expect(gbp.length).toBeGreaterThan(0);
    expect(cad.length).toBeGreaterThan(0);
    expect(paper.length).toBeGreaterThan(0);
    expect(paper.some((a) => a.balanceCents !== 0)).toBe(true);

    const toUsd = (cents: number, currency: keyof typeof DEMO_FX_RATES) =>
      currency === "USD" ? cents : convertToUsdCents(cents, DEMO_FX_RATES[currency]);
    const expectedCash = accounts.filter((a) => !a.paper).reduce((s, a) => s + toUsd(a.balanceCents, a.currency), 0);

    const nw = netWorth(db, "alice", AS_OF);
    expect(nw.cashAndDebtCents).toBe(expectedCash);
    expect(nw.totalCents).toBe(expectedCash + getPortfolio(db, "alice", AS_OF).investedValueCents);
    expect(Number.isInteger(nw.totalCents)).toBe(true);

    // Concretely: 1 GBP = 1.27 USD and 1 CAD = 0.73 USD in the demo data.
    const gbpUsd = gbp.reduce((s, a) => s + convertToUsdCents(a.balanceCents, 1_270_000), 0);
    const cadUsd = cad.reduce((s, a) => s + convertToUsdCents(a.balanceCents, 730_000), 0);
    const usdOnly = accounts.filter((a) => !a.paper && a.currency === "USD").reduce((s, a) => s + a.balanceCents, 0);
    expect(nw.cashAndDebtCents).toBe(usdOnly + gbpUsd + cadUsd);
    expect(gbpUsd).not.toBe(gbp.reduce((s, a) => s + a.balanceCents, 0));
    expect(nw.fxRates.find((r) => r.currency === "GBP")?.rateMicros).toBe(1_270_000);
    expect(nw.fxRates.find((r) => r.currency === "CAD")?.rateMicros).toBe(730_000);

    // Paper money never leaks into net worth: changing it leaves cash and debt unchanged.
    db.prepare("UPDATE accounts SET balance_cents = balance_cents + 999999 WHERE user_id = 'alice' AND is_paper = 1").run();
    expect(netWorth(db, "alice", AS_OF).cashAndDebtCents).toBe(expectedCash);
  });
});
