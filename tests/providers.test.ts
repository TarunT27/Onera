import { afterEach, describe, expect, it, vi } from "vitest";
import { approveAction, createTransfer } from "@/lib/actions/service";
import { executeTransfer } from "@/lib/actions/simulator";
import { openDb, type DB } from "@/lib/db";
import { listAccounts } from "@/lib/finance/accounts";
import {
  disconnectConnection,
  getConnection,
  getInstitution as getProviderInstitution,
  linkInstitution,
  linkInstitutionWithSummary,
  listConnectionAccounts,
  listConnections,
  listInstitutions,
  reconnectConnection,
  simulateConnectionIssue,
  syncConnection,
} from "@/lib/providers";
import { errorCode } from "./helpers";

afterEach(() => vi.useRealTimers());

const AS_OF = new Date("2026-10-10T12:00:00.000Z");

function testDb(): DB {
  return openDb(":memory:", AS_OF);
}

function countTransactions(db: DB, userId: string, accountId?: string): number {
  if (accountId) {
    return (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?",
        )
        .get(userId, accountId) as { count: number }
    ).count;
  }
  return (
    db
      .prepare("SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?")
      .get(userId) as { count: number }
  ).count;
}

function balance(db: DB, accountId: string): number {
  return (
    db
      .prepare("SELECT balance_cents AS balance FROM accounts WHERE id = ?")
      .get(accountId) as { balance: number }
  ).balance;
}

describe("provider catalog", () => {
  it("lists simulated institutions with explicit provider disclaimers", () => {
    const institutions = listInstitutions();

    expect(institutions).toHaveLength(5);
    expect(
      new Set(institutions.map((institution) => institution.id)).size,
    ).toBe(institutions.length);
    for (const institution of institutions) {
      expect(institution.simulated).toBe(true);
      expect(institution.name).toContain("(simulated)");
      expect(institution.disclaimer).toContain(
        `Not affiliated with ${institution.brand}`,
      );
      expect(institution.products.length).toBeGreaterThan(0);
    }

    expect(getProviderInstitution("ins_td")).toMatchObject({
      id: "ins_td",
      currency: "USD",
      supportsTransfers: true,
      simulated: true,
    });
    expect(errorCode(() => getProviderInstitution("ins_missing"))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("provider linking and cursor sync", () => {
  it("links a new institution, performs the initial history sync, and exposes its accounts", () => {
    const db = testDb();
    const result = linkInstitutionWithSummary(db, "bob", "ins_td", AS_OF);

    expect(result.connection).toMatchObject({
      id: "conn_bob_td",
      userId: "bob",
      institutionId: "ins_td",
      status: "healthy",
      simulated: true,
    });
    expect(result.connection.accountIds).toHaveLength(3);
    expect(result.connection.lastSyncedAt).toBe(AS_OF.toISOString());
    expect(result.sync).toMatchObject({
      connectionId: "conn_bob_td",
      status: "healthy",
      syncedAt: AS_OF.toISOString(),
    });
    expect(result.sync.added).toBeGreaterThan(0);
    expect(countTransactions(db, "bob")).toBeGreaterThan(0);

    const accounts = listConnectionAccounts(db, "bob", result.connection.id);
    expect(accounts.map((account) => account.id).sort()).toEqual(
      [...result.connection.accountIds].sort(),
    );
    expect(
      accounts.every(
        (account) => account.connectionId === result.connection.id,
      ),
    ).toBe(true);
    expect(accounts.every((account) => account.currency === "USD")).toBe(true);
    expect(
      accounts.find((account) => account.type === "checking")?.capabilities,
    ).toEqual(["view", "transfer_source", "transfer_destination"]);
    expect(
      accounts.find((account) => account.type === "savings")?.capabilities,
    ).toEqual(["view", "transfer_source", "transfer_destination"]);
    expect(
      accounts.find((account) => account.type === "credit")?.capabilities,
    ).toEqual(["view", "transfer_destination"]);
  });

  it("re-delivers the cursor window without duplicating or changing transactions", () => {
    const db = testDb();
    const linked = linkInstitutionWithSummary(db, "bob", "ins_td", AS_OF);
    const countAfterLink = countTransactions(db, "bob");
    const balancesAfterLink = linked.connection.accountIds.map((accountId) =>
      balance(db, accountId),
    );

    const repeated = syncConnection(db, "bob", linked.connection.id, AS_OF);
    expect(repeated).toMatchObject({
      connectionId: linked.connection.id,
      status: "healthy",
      added: 0,
      modified: 0,
      removed: 0,
      newTransactionIds: [],
      syncedAt: AS_OF.toISOString(),
    });
    expect(countTransactions(db, "bob")).toBe(countAfterLink);
    expect(
      linked.connection.accountIds.map((accountId) => balance(db, accountId)),
    ).toEqual(balancesAfterLink);

    const later = new Date(AS_OF.getTime() + 7 * 86_400_000);
    const catchUp = syncConnection(db, "bob", linked.connection.id, later);
    expect(catchUp.status).toBe("healthy");
    expect(catchUp.added + catchUp.modified + catchUp.removed).toBeGreaterThan(
      0,
    );
    const countAfterCatchUp = countTransactions(db, "bob");
    const repeatedCatchUp = syncConnection(
      db,
      "bob",
      linked.connection.id,
      later,
    );
    expect(repeatedCatchUp.added).toBe(0);
    expect(repeatedCatchUp.modified).toBe(0);
    expect(repeatedCatchUp.removed).toBe(0);
    expect(repeatedCatchUp.newTransactionIds).toEqual([]);
    expect(countTransactions(db, "bob")).toBe(countAfterCatchUp);
  });
});

describe("provider ownership and connection health", () => {
  it("returns 404 semantics for every connection operation across users", () => {
    const db = testDb();
    const aliceConnectionId = "conn_alice_td";

    expect(
      listConnections(db, "bob").some(
        (connection) => connection.id === aliceConnectionId,
      ),
    ).toBe(false);
    expect(errorCode(() => getConnection(db, "bob", aliceConnectionId))).toBe(
      "NOT_FOUND",
    );
    expect(
      errorCode(() => listConnectionAccounts(db, "bob", aliceConnectionId)),
    ).toBe("NOT_FOUND");
    expect(
      errorCode(() => syncConnection(db, "bob", aliceConnectionId, AS_OF)),
    ).toBe("NOT_FOUND");
    expect(
      errorCode(() => disconnectConnection(db, "bob", aliceConnectionId)),
    ).toBe("NOT_FOUND");
    expect(
      errorCode(() => reconnectConnection(db, "bob", aliceConnectionId)),
    ).toBe("NOT_FOUND");
    expect(
      errorCode(() =>
        simulateConnectionIssue(db, "bob", aliceConnectionId, "error"),
      ),
    ).toBe("NOT_FOUND");
  });

  it("disconnects to view-only while keeping history, then relinks the same connection", () => {
    const db = testDb();
    const linked = linkInstitutionWithSummary(db, "bob", "ins_td", AS_OF);
    const originalAccountIds = [...linked.connection.accountIds];
    const historyCount = countTransactions(db, "bob");

    const disconnected = disconnectConnection(db, "bob", linked.connection.id);
    expect(disconnected).toMatchObject({
      status: "disconnected",
      consentScopes: [],
      accountIds: originalAccountIds,
    });
    expect(
      listConnectionAccounts(db, "bob", linked.connection.id).every(
        (account) =>
          account.capabilities.length === 1 &&
          account.capabilities[0] === "view",
      ),
    ).toBe(true);
    expect(countTransactions(db, "bob")).toBe(historyCount);
    expect(
      errorCode(() => syncConnection(db, "bob", linked.connection.id, AS_OF)),
    ).toBe("INVALID_STATE");

    const relinked = linkInstitution(
      db,
      "bob",
      "ins_td",
      new Date(AS_OF.getTime() + 2 * 86_400_000),
    );
    expect(relinked).toMatchObject({
      id: linked.connection.id,
      status: "healthy",
      accountIds: originalAccountIds,
    });
    expect(relinked.consentScopes).toContain("identity:account_ownership");
    expect(
      listConnectionAccounts(db, "bob", relinked.id).some((account) =>
        account.capabilities.includes("transfer_source"),
      ),
    ).toBe(true);
    expect(countTransactions(db, "bob")).toBeGreaterThanOrEqual(historyCount);
  });

  it("recovers a transient error on sync and requires reconnect for login_required", () => {
    const db = testDb();
    const linked = linkInstitutionWithSummary(db, "bob", "ins_td", AS_OF);
    const error = simulateConnectionIssue(
      db,
      "bob",
      linked.connection.id,
      "error",
      AS_OF,
    );
    expect(error.status).toBe("error");
    expect(error.lastError).toContain("temporarily unavailable");

    const recovered = syncConnection(
      db,
      "bob",
      linked.connection.id,
      new Date(AS_OF.getTime() + 86_400_000),
    );
    expect(recovered.status).toBe("healthy");
    expect(getConnection(db, "bob", linked.connection.id).lastError).toBeNull();

    const loginRequired = simulateConnectionIssue(
      db,
      "bob",
      linked.connection.id,
      "login_required",
      AS_OF,
    );
    expect(loginRequired.status).toBe("login_required");
    expect(loginRequired.lastError).toContain("sign in again");
    expect(
      errorCode(() => syncConnection(db, "bob", linked.connection.id, AS_OF)),
    ).toBe("INVALID_STATE");
    expect(getConnection(db, "bob", linked.connection.id).status).toBe(
      "login_required",
    );

    const reconnected = reconnectConnection(
      db,
      "bob",
      linked.connection.id,
      AS_OF,
    );
    expect(reconnected).toMatchObject({ status: "healthy", lastError: null });
    expect(syncConnection(db, "bob", linked.connection.id, AS_OF).status).toBe(
      "healthy",
    );
  });
});

describe("foreign currency provider capabilities", () => {
  it("links foreign accounts as readable data without transfer capabilities", () => {
    const db = testDb();
    const expected = [
      ["ins_barclays_uk", "GBP"],
      ["ins_rbc", "CAD"],
    ] as const;

    for (const [institutionId, currency] of expected) {
      const linked = linkInstitutionWithSummary(
        db,
        "bob",
        institutionId,
        AS_OF,
      );
      const institution = getProviderInstitution(institutionId);
      expect(institution.currency).toBe(currency);
      expect(institution.supportsTransfers).toBe(false);
      expect(linked.connection.consentScopes).toEqual([
        "accounts:read",
        "balances:read",
        "transactions:read",
      ]);

      const accounts = listConnectionAccounts(db, "bob", linked.connection.id);
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts.every((account) => account.currency === currency)).toBe(
        true,
      );
      expect(
        accounts.every(
          (account) =>
            JSON.stringify(account.capabilities) === JSON.stringify(["view"]),
        ),
      ).toBe(true);
      const recipientCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM recipients WHERE user_id = ? AND account_id IN (SELECT id FROM accounts WHERE connection_id = ?)",
          )
          .get("bob", linked.connection.id) as { count: number }
      ).count;
      expect(recipientCount).toBe(0);
    }
  });
});

describe("provider sync and governed transfers", () => {
  it("preserves an approved and executed own-account transfer across a later sync", () => {
    vi.useFakeTimers();
    vi.setSystemTime(AS_OF);
    const db = testDb();
    const linked = linkInstitutionWithSummary(db, "bob", "ins_td", AS_OF);
    const checkingId = "acct_bob_td_checking";
    const savingsId = "acct_bob_td_savings";
    const amountCents = 10_000;
    const checkingBefore = balance(db, checkingId);
    const savingsBefore = balance(db, savingsId);

    const proposal = createTransfer(
      db,
      "bob",
      {
        sourceAccountId: checkingId,
        recipientId: "rcp_bob_td_savings",
        amountCents,
      },
      "user",
    );
    expect(proposal.state).toBe("AWAITING_APPROVAL");
    const approved = approveAction(db, "bob", proposal.id, {
      version: proposal.version,
    });
    expect(approved.state).toBe("APPROVED");
    const executed = executeTransfer(db, "bob", proposal.id);
    expect(executed.action.state).toBe("EXECUTED");
    expect(balance(db, checkingId)).toBe(checkingBefore - amountCents);
    expect(balance(db, savingsId)).toBe(savingsBefore + amountCents);

    const balancesAfterTransfer = [
      balance(db, checkingId),
      balance(db, savingsId),
    ];
    syncConnection(db, "bob", linked.connection.id, new Date());

    expect([balance(db, checkingId), balance(db, savingsId)]).toEqual(
      balancesAfterTransfer,
    );
    expect(executeTransfer(db, "bob", proposal.id).duplicate).toBe(true);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM transactions WHERE action_id = ?",
          )
          .get(proposal.id) as { count: number }
      ).count,
    ).toBe(2);
    expect(
      listAccounts(db, "bob").find((account) => account.id === checkingId)
        ?.balanceCents,
    ).toBe(checkingBefore - amountCents);
  });
});
