// HTTP-level evidence: the server boundary holds when the route handlers are
// called directly with real Request objects (as curl would), independent of the UI.
// The session cookie is controlled via a mocked next/headers; every test gets a
// fresh seeded in-memory database via a mocked getDb.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/lib/db";
import type { TransferAction } from "@/lib/types";
import { balance, freshDb } from "./helpers";

const session = vi.hoisted(() => ({ user: undefined as string | undefined, db: undefined as unknown }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "clearfi_user" && session.user !== undefined ? { name, value: session.user } : undefined,
  }),
}));

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    ...actual,
    getDb: () => {
      if (!session.db) throw new Error("test database not initialised");
      return session.db as DB;
    },
  };
});

const actionsRoute = await import("@/app/api/actions/route");
const actionRoute = await import("@/app/api/actions/[id]/route");
const approveRoute = await import("@/app/api/actions/[id]/approve/route");
const executeRoute = await import("@/app/api/actions/[id]/execute/route");
const evaluateRoute = await import("@/app/api/actions/[id]/evaluate/route");
const verifyRoute = await import("@/app/api/recipients/[id]/verify/route");
const controlsRoute = await import("@/app/api/controls/route");

let db: DB;

beforeEach(() => {
  db = freshDb();
  session.db = db;
  session.user = "alice";
});

const BASE = "http://localhost:3000";

function req(method: string, path: string, body?: unknown, raw?: string): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    action?: TransferAction;
    error?: { code: string; message: string };
  };
}

async function propose(body: Record<string, unknown>) {
  const res = await actionsRoute.POST(req("POST", "/api/actions", body));
  return { res, body: await json(res) };
}

const toSavings = { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_savings", amountCents: 50_000 };
const toLandlord = { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents: 185_000 };

function storedAction(id: string) {
  return db.prepare("SELECT user_id, state, version, approval_hash, created_by FROM actions WHERE id = ?").get(id) as {
    user_id: string; state: string; version: number; approval_hash: string | null; created_by: string;
  };
}

describe("POST /api/actions/[id]/execute", () => {
  it("refuses a HELD action with 409 INVALID_STATE and leaves balances unchanged", async () => {
    const checking = balance(db, "acct_alice_checking");
    const { res, body } = await propose(toLandlord);
    expect(res.status).toBe(201);
    expect(body.action!.state).toBe("HELD");
    expect(body.action!.holdReasons).toEqual(["RECIPIENT_CHANGED"]);

    const exec = await executeRoute.POST(req("POST", `/api/actions/${body.action!.id}/execute`), ctx(body.action!.id));
    expect(exec.status).toBe(409);
    expect((await json(exec)).error!.code).toBe("INVALID_STATE");
    expect(balance(db, "acct_alice_checking")).toBe(checking);
    expect(storedAction(body.action!.id).state).toBe("HELD");
  });

  it("happy path: propose → approve → execute → execute again returns duplicate with the same receipt", async () => {
    const checking = balance(db, "acct_alice_checking");
    const savings = balance(db, "acct_alice_savings");
    const { body } = await propose(toSavings);
    const id = body.action!.id;
    expect(body.action!.state).toBe("AWAITING_APPROVAL");

    const approve = await approveRoute.POST(req("POST", `/api/actions/${id}/approve`, { version: body.action!.version }), ctx(id));
    expect(approve.status).toBe(200);
    const approved = await json(approve);
    expect(approved.action!.state).toBe("APPROVED");
    expect(approved.action!.hasApproval).toBe(true);

    const first = await executeRoute.POST(req("POST", `/api/actions/${id}/execute`), ctx(id));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { duplicate: boolean; receipt: { receiptId: string; simulated: boolean } };
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.receipt.simulated).toBe(true);

    const again = await executeRoute.POST(req("POST", `/api/actions/${id}/execute`), ctx(id));
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { duplicate: boolean; receipt: { receiptId: string } };
    expect(againBody.duplicate).toBe(true);
    expect(againBody.receipt.receiptId).toBe(firstBody.receipt.receiptId);

    expect(balance(db, "acct_alice_checking")).toBe(checking - 50_000);
    expect(balance(db, "acct_alice_savings")).toBe(savings + 50_000);
  });
});

describe("session boundary", () => {
  it("Bob's cookie gets 404 on Alice's action for read, edit, approve, evaluate and execute", async () => {
    const { body } = await propose(toSavings);
    const id = body.action!.id;
    const before = storedAction(id);

    session.user = "bob";
    const responses = [
      await actionRoute.GET(req("GET", `/api/actions/${id}`), ctx(id)),
      await actionRoute.PATCH(req("PATCH", `/api/actions/${id}`, { amountCents: 1 }), ctx(id)),
      await approveRoute.POST(req("POST", `/api/actions/${id}/approve`, { version: 1 }), ctx(id)),
      await evaluateRoute.POST(req("POST", `/api/actions/${id}/evaluate`), ctx(id)),
      await executeRoute.POST(req("POST", `/api/actions/${id}/execute`), ctx(id)),
      await verifyRoute.POST(req("POST", "/api/recipients/rcp_alice_landlord/verify"), ctx("rcp_alice_landlord")),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect((await json(res)).error!.code).toBe("NOT_FOUND");
    }
    // Bob's action list does not include Alice's action.
    const list = (await (await actionsRoute.GET()).json()) as { actions: TransferAction[] };
    expect(list.actions.map((a) => a.id)).not.toContain(id);

    expect(storedAction(id)).toEqual(before);
  });

  it("an unknown cookie value falls back to the demo default, not to an arbitrary user", async () => {
    session.user = "mallory";
    const { res, body } = await propose(toSavings);
    expect(res.status).toBe(201);
    expect(body.action!.userId).toBe("alice");
  });

  it("body fields for state, approvalHash, userId or createdBy cannot change state or identity", async () => {
    session.user = "bob";
    const bobChecking = balance(db, "acct_bob_checking");
    const { res, body } = await propose({
      sourceAccountId: "acct_bob_checking", recipientId: "rcp_bob_savings", amountCents: 5_000,
      userId: "alice", user_id: "alice", state: "APPROVED", approvalHash: "0".repeat(64), approval_hash: "0".repeat(64),
      hasApproval: true, approvedVersion: 1, createdBy: "assistant", version: 99,
    });
    expect(res.status).toBe(201);
    const id = body.action!.id;
    expect(body.action!.userId).toBe("bob");
    expect(body.action!.state).toBe("AWAITING_APPROVAL");
    expect(body.action!.hasApproval).toBe(false);
    expect(body.action!.version).toBe(1);
    expect(body.action!.createdBy).toBe("user");
    expect(storedAction(id)).toMatchObject({ user_id: "bob", state: "AWAITING_APPROVAL", approval_hash: null });

    // The hash never leaves the server.
    expect(JSON.stringify(body)).not.toMatch(/approval_?hash/i);

    // Executing without approval is refused even though the body claimed APPROVED.
    const exec = await executeRoute.POST(req("POST", `/api/actions/${id}/execute`), ctx(id));
    expect(exec.status).toBe(409);
    expect((await json(exec)).error!.code).toBe("INVALID_STATE");
    expect(balance(db, "acct_bob_checking")).toBe(bobChecking);

    // A PATCH carrying only privileged fields is not a valid edit.
    const patchOnly = await actionRoute.PATCH(
      req("PATCH", `/api/actions/${id}`, { state: "EXECUTED", approvalHash: "x", userId: "alice" }), ctx(id));
    expect(patchOnly.status).toBe(400);
    expect((await json(patchOnly)).error!.code).toBe("BAD_REQUEST");

    // A PATCH mixing a real edit with privileged fields applies only the edit.
    const mixed = await actionRoute.PATCH(
      req("PATCH", `/api/actions/${id}`, { amountCents: 6_000, state: "APPROVED", approvalHash: "x", userId: "alice" }), ctx(id));
    expect(mixed.status).toBe(200);
    const edited = (await json(mixed)).action!;
    expect(edited.userId).toBe("bob");
    expect(edited.state).toBe("AWAITING_APPROVAL");
    expect(edited.version).toBe(2);
    expect(edited.hasApproval).toBe(false);

    // Approve with extra fields: the server computes the hash, ignoring the client's.
    const approve = await approveRoute.POST(
      req("POST", `/api/actions/${id}/approve`, { version: 2, approvalHash: "0".repeat(64), userId: "alice" }), ctx(id));
    expect(approve.status).toBe(200);
    expect(storedAction(id).approval_hash).not.toBe("0".repeat(64));
    expect(storedAction(id).approval_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("controls are per session: Alice pausing does not pause Bob, and body userId is ignored", async () => {
    const res = await controlsRoute.PATCH(req("PATCH", "/api/controls", { paused: true, userId: "bob" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { controls: { userId: string; paused: boolean } }).controls).toMatchObject({
      userId: "alice", paused: true,
    });
    session.user = "bob";
    const bob = (await (await controlsRoute.GET()).json()) as { controls: { userId: string; paused: boolean } };
    expect(bob.controls).toMatchObject({ userId: "bob", paused: false });
  });
});

describe("approval binding over HTTP", () => {
  it("approving a stale version returns 409 STALE_VERSION", async () => {
    const { body } = await propose(toSavings);
    const id = body.action!.id;
    const edit = await actionRoute.PATCH(req("PATCH", `/api/actions/${id}`, { amountCents: 70_000 }), ctx(id));
    expect(edit.status).toBe(200);
    expect((await json(edit)).action!.version).toBe(2);

    const stale = await approveRoute.POST(req("POST", `/api/actions/${id}/approve`, { version: 1 }), ctx(id));
    expect(stale.status).toBe(409);
    expect((await json(stale)).error!.code).toBe("STALE_VERSION");
    expect(storedAction(id)).toMatchObject({ state: "AWAITING_APPROVAL", approval_hash: null });
  });

  it("pausing via PATCH /api/controls blocks an approved action with 409 POLICY_HOLD", async () => {
    const checking = balance(db, "acct_alice_checking");
    const { body } = await propose(toSavings);
    const id = body.action!.id;
    await approveRoute.POST(req("POST", `/api/actions/${id}/approve`, { version: 1 }), ctx(id));
    const pause = await controlsRoute.PATCH(req("PATCH", "/api/controls", { paused: true }));
    expect(pause.status).toBe(200);

    const exec = await executeRoute.POST(req("POST", `/api/actions/${id}/execute`), ctx(id));
    expect(exec.status).toBe(409);
    expect((await json(exec)).error!.code).toBe("POLICY_HOLD");
    expect(storedAction(id)).toMatchObject({ state: "HELD", approval_hash: null });
    expect(balance(db, "acct_alice_checking")).toBe(checking);
  });
});

describe("request validation", () => {
  it("malformed JSON returns 400 BAD_REQUEST on every write route", async () => {
    const { body } = await propose(toSavings);
    const id = body.action!.id;
    const bad = "{ not json";
    const responses = [
      await actionsRoute.POST(req("POST", "/api/actions", undefined, bad)),
      await actionRoute.PATCH(req("PATCH", `/api/actions/${id}`, undefined, bad), ctx(id)),
      await approveRoute.POST(req("POST", `/api/actions/${id}/approve`, undefined, bad), ctx(id)),
      await controlsRoute.PATCH(req("PATCH", "/api/controls", undefined, bad)),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect((await json(res)).error!.code).toBe("BAD_REQUEST");
    }
    expect(storedAction(id)).toMatchObject({ state: "AWAITING_APPROVAL", version: 1 });
  });

  it("schema violations (float or negative cents, missing fields) return 400 BAD_REQUEST", async () => {
    for (const bad of [
      { ...toSavings, amountCents: 500.5 },
      { ...toSavings, amountCents: -100 },
      { ...toSavings, currency: "EUR" },
      { recipientId: "rcp_alice_savings", amountCents: 100 },
    ]) {
      const { res, body } = await propose(bad);
      expect(res.status).toBe(400);
      expect(body.error!.code).toBe("BAD_REQUEST");
    }
    expect((db.prepare("SELECT COUNT(*) AS n FROM actions").get() as { n: number }).n).toBe(0);
  });
});
