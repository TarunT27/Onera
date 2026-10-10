// Regression tests for the markets hardening review:
//  1. executeOrder has no free-form actor; the mandate path is internal.
//  2. Write paths use the real clock; a caller-supplied time is ignored.
//  3. Load-then-write is one IMMEDIATE transaction with state/version-guarded UPDATEs (409, never 500).
//  4. Broker FAILED path uses the attempt's time; transient SQLITE_BUSY is retryable (503), not FAILED.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { openDb, type DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import * as markets from "@/lib/markets";
import {
  approveOrder,
  createMandate,
  createOrder,
  editOrder,
  evaluateOrder,
  executeOrder,
  getOrder,
  getQuote,
  proposeMandateOrder,
} from "@/lib/markets";
import { executeMandateOrder } from "@/lib/markets/broker";
import { applyOrderEvaluation, createOrderInternal, loadOrderRow } from "@/lib/markets/orders";
import { balance, errorCode, freshDb } from "./helpers";

const PAPER = "acct_alice_paper";
const AGENT = "dca-bot";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const T0 = new Date("2026-10-07T15:30:20.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// Calls a function with extra trailing arguments the type no longer allows (as untyped JS could).
const loose = (fn: unknown) => fn as (...args: unknown[]) => unknown;

function grant(db: DB, overrides: Record<string, unknown> = {}) {
  return createMandate(db, "alice", {
    agentId: AGENT, accountId: PAPER, symbols: ["VTI"],
    maxOrderCents: 10_000, maxDailyCents: 25_000,
    expiresAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
    ...overrides,
  });
}

const userBuy = (db: DB, notionalCents = 5_000, createdBy: Parameters<typeof createOrder>[3] = "user") =>
  createOrder(db, "alice", { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents }, createdBy);

function serviceError(fn: () => unknown): ServiceError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ServiceError) return err;
    throw err;
  }
  throw new Error("Expected a ServiceError");
}

const row = (db: DB, id: string) =>
  db.prepare("SELECT state, version, updated_at, failure_reason FROM orders WHERE id = ?").get(id) as
    { state: string; version: number; updated_at: string; failure_reason: string | null };

/**
 * Wraps db.prepare so statements whose SQL contains `match` get `method` replaced.
 * Returns a restore function.
 */
function patchStatement(db: DB, match: string, method: "run" | "get", impl: (orig: (...a: unknown[]) => unknown, args: unknown[]) => unknown) {
  const original = db.prepare;
  db.prepare = function (this: DB, sql: string) {
    const stmt = original.call(this, sql);
    if (!sql.includes(match)) return stmt;
    return new Proxy(stmt, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop === method) return (...args: unknown[]) => impl((value as (...a: unknown[]) => unknown).bind(target), args);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as unknown as DB["prepare"];
  return () => { db.prepare = original; };
}

// --- 1. No free-form actor; mandate execution is internal ---------------------------

describe("execution entry points", () => {
  it("the public surface exposes only the user executeOrder(db, userId, orderId)", () => {
    expect(markets.executeOrder.length).toBe(3);
    for (const name of ["executeMandateOrder", "createOrderInternal", "applyOrderEvaluation", "runOrderPolicy"]) {
      expect(name in markets).toBe(false);
    }
    // Write helpers no longer take a time.
    expect(markets.approveOrder.length).toBe(4);
    expect(markets.proposeMandateOrder.length).toBe(5);
    expect(markets.createMandate.length).toBe(3);
  });

  it("an actor passed to executeOrder is ignored: it always runs as the signed-in user", () => {
    const db = freshDb();
    const o = userBuy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    const { fill } = loose(executeOrder)(db, "alice", o.id, { actor: `agent:${AGENT}` }) as markets.ExecuteOrderResult;
    expect(fill.executedBy).toBe("user:alice");
    const executed = listAudit(db, "alice", { actionId: o.id }).find((e) => e.eventType === "order.executed")!;
    expect(executed.actor).toBe("user:alice");
  });

  it("a user-approved order cannot be executed through the mandate path, even by its proposing agent", () => {
    const db = freshDb();
    const m = grant(db);
    const o = userBuy(db, 5_000, `agent:${AGENT}`);
    approveOrder(db, "alice", o.id, { version: o.version });
    const cash = balance(db, PAPER);

    expect(errorCode(() => executeMandateOrder(db, "alice", o.id, m.id, AGENT))).toBe("INVALID_STATE");
    expect(getOrder(db, "alice", o.id).state).toBe("APPROVED");
    expect(balance(db, PAPER)).toBe(cash);
    const refused = listAudit(db, "alice", { actionId: o.id }).find((e) => e.eventType === "order.execute_refused")!;
    expect(refused.actor).toBe(`agent:${AGENT}`);
    expect(refused.detail.reason).toBe("AGENT_NOT_AUTHORIZED");

    const { fill } = executeOrder(db, "alice", o.id); // the user still can
    expect(fill.executedBy).toBe("user:alice");
    expect(fill.approvedBy).toBe("user:alice");
  });

  it("the mandate path refuses an order authorized under a different mandate", () => {
    const db = freshDb();
    const m1 = grant(db);
    const m2 = grant(db);
    const o = createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, `agent:${AGENT}`, m1.id);
    expect(o.state).toBe("APPROVED");
    const cash = balance(db, PAPER);
    expect(errorCode(() => executeMandateOrder(db, "alice", o.id, m2.id, AGENT))).toBe("INVALID_STATE");
    expect(balance(db, PAPER)).toBe(cash);
    expect(executeMandateOrder(db, "alice", o.id, m1.id, AGENT).fill.approvedBy).toBe(`mandate:${m1.id}`);
  });

  it("records agent:<id> as executor and mandate:<id> as approver for mandate trades", () => {
    const db = freshDb();
    const m = grant(db);
    const r = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 });
    expect(r.executed).toBe(true);
    expect(r.fill!.executedBy).toBe(`agent:${AGENT}`);
    expect(r.fill!.approvedBy).toBe(`mandate:${m.id}`);
    const audit = listAudit(db, "alice", { actionId: r.order.id });
    expect(audit.find((e) => e.eventType === "order.proposed")!.actor).toBe(`agent:${AGENT}`);
    expect(audit.find((e) => e.eventType === "order.mandate_authorized")!.detail.approvedBy).toBe(`mandate:${m.id}`);
    const executed = audit.find((e) => e.eventType === "order.executed")!;
    expect(executed.actor).toBe(`agent:${AGENT}`);
    expect(executed.detail.approvedBy).toBe(`mandate:${m.id}`);
    expect(executed.detail.mandateId).toBe(m.id);
  });

  it("only lib/markets and tests reach markets internals", () => {
    const root = process.cwd();
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
    const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "lib"))]
      .filter((f) => !f.startsWith(path.join(root, "lib", "markets") + path.sep));
    const offenders = files.flatMap((file) => {
      const rel = path.relative(root, file);
      const text = fs.readFileSync(file, "utf8");
      const hits: string[] = [];
      for (const m of text.matchAll(/from\s+["']@\/lib\/markets\/([^"']+)["']/g)) {
        if (!(rel === path.join("lib", "db", "modules.ts") && m[1] === "db")) hits.push(`${rel}: @/lib/markets/${m[1]}`);
      }
      for (const name of ["executeMandateOrder", "createOrderInternal", "applyOrderEvaluation"]) {
        if (new RegExp(`\\b${name}\\b`).test(text)) hits.push(`${rel}: ${name}`);
      }
      return hits;
    });
    expect(offenders).toEqual([]);
  });
});

// --- 2. Caller-supplied time is ignored -------------------------------------------------

describe("write paths use the real clock", () => {
  it("a stale time passed to executeOrder cannot fill at a historical price", () => {
    const db = freshDb();
    const o = userBuy(db, 20_000);
    approveOrder(db, "alice", o.id, { version: o.version });
    const current = getQuote("VTI", T0)!.priceCents;

    let stale: Date | null = null;
    for (let k = 1; k <= 2_000 && !stale; k++) {
      const t = new Date(T0.getTime() - k * MINUTE_MS);
      const p = getQuote("VTI", t)!.priceCents;
      if (p !== current && p <= o.priceBoundCents!) stale = t;
    }
    expect(stale).not.toBeNull();

    const { fill } = loose(executeOrder)(db, "alice", o.id, { now: stale }) as markets.ExecuteOrderResult;
    expect(fill.priceCents).toBe(current);
    expect(fill.executedAt).toBe(T0.toISOString());
  });

  it("a previous-day time cannot reset the daily limit at execution", () => {
    const db = freshDb();
    const [a, b, c] = [userBuy(db, 45_000), userBuy(db, 45_000), userBuy(db, 45_000)];
    for (const o of [a, b, c]) approveOrder(db, "alice", o.id, { version: o.version });
    executeOrder(db, "alice", a.id);
    executeOrder(db, "alice", b.id);
    const cash = balance(db, PAPER);
    const yesterday = new Date(T0.getTime() - DAY_MS);
    expect(errorCode(() => loose(executeOrder)(db, "alice", c.id, { now: yesterday }))).toBe("POLICY_HOLD");
    expect(getOrder(db, "alice", c.id).holdReasons).toContain("DAILY_ORDER_LIMIT_EXCEEDED");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("a stale time passed to approveOrder cannot approve at a price that has since moved past the bound", () => {
    const db = freshDb();
    const o = userBuy(db, 20_000);
    let later: Date | null = null;
    for (let k = 1; k <= 730 && !later; k++) {
      const t = new Date(T0.getTime() + k * DAY_MS);
      if (getQuote("VTI", t)!.priceCents > o.priceBoundCents!) later = t;
    }
    expect(later).not.toBeNull();
    vi.setSystemTime(later!);
    expect(errorCode(() => loose(approveOrder)(db, "alice", o.id, { version: o.version }, T0))).toBe("POLICY_HOLD");
    expect(getOrder(db, "alice", o.id).hasApproval).toBe(false);
  });

  it("a stale time passed to proposeMandateOrder cannot trade after the mandate expired", () => {
    const db = freshDb();
    const m = grant(db, { expiresAt: new Date(T0.getTime() + HOUR_MS).toISOString() });
    vi.setSystemTime(new Date(T0.getTime() + 2 * HOUR_MS));
    const cash = balance(db, PAPER);
    const r = loose(proposeMandateOrder)(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 }, T0) as
      markets.MandateOrderResult;
    expect(r.executed).toBe(false);
    expect(r.order.state).toBe("HELD");
    expect(r.order.holdReasons).toContain("MANDATE_INVALID");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("a stale time passed to createMandate cannot create an already-expired or over-long mandate", () => {
    const db = freshDb();
    const input = (expiresAt: Date) => ({
      agentId: AGENT, accountId: PAPER, symbols: ["VTI"], maxOrderCents: 10_000, maxDailyCents: 10_000,
      expiresAt: expiresAt.toISOString(),
    });
    const past = new Date(T0.getTime() - HOUR_MS);
    expect(errorCode(() => loose(createMandate)(db, "alice", input(past), new Date(T0.getTime() - 2 * HOUR_MS))))
      .toBe("BAD_REQUEST");
    const farFuture = new Date(T0.getTime() + 120 * DAY_MS);
    expect(errorCode(() => loose(createMandate)(db, "alice", input(farFuture), new Date(T0.getTime() + 60 * DAY_MS))))
      .toBe("BAD_REQUEST");
  });
});

// --- 3. Guarded, transactional load-then-write ---------------------------------------------

describe("state conflicts are 409 INVALID_STATE", () => {
  const injectAfterLoad = (db: DB, sql: string) => {
    let fired = false;
    return patchStatement(db, "SELECT * FROM orders WHERE id = ? AND user_id = ?", "get", (orig, args) => {
      const result = orig(...args);
      if (!fired) {
        fired = true;
        db.prepare(sql).run(args[0]); // a concurrent writer changes the order between load and write
      }
      return result;
    });
  };

  it("editOrder: the order changes state between load and write", () => {
    const db = freshDb();
    const o = userBuy(db);
    const restore = injectAfterLoad(db, "UPDATE orders SET state = 'FAILED', failure_reason = 'x' WHERE id = ?");
    const err = serviceError(() => editOrder(db, "alice", o.id, { notionalCents: 6_000 }));
    restore();
    expect(err.code).toBe("INVALID_STATE");
    expect(err.status).toBe(409);
    // Rolled back as a whole; nothing from the edit was written.
    expect(row(db, o.id)).toMatchObject({ state: "AWAITING_APPROVAL", version: o.version });
    expect(listAudit(db, "alice", { actionId: o.id }).map((e) => e.eventType)).not.toContain("order.edited");
  });

  it("editOrder: a concurrent edit bumped the version between load and write", () => {
    const db = freshDb();
    const o = userBuy(db);
    const restore = injectAfterLoad(db, "UPDATE orders SET version = version + 1 WHERE id = ?");
    const err = serviceError(() => editOrder(db, "alice", o.id, { notionalCents: 6_000 }));
    restore();
    expect([err.code, err.status]).toEqual(["INVALID_STATE", 409]);
    expect(row(db, o.id).version).toBe(o.version);
  });

  it("evaluateOrder: the order changes state between load and write", () => {
    const db = freshDb();
    const o = userBuy(db);
    const restore = injectAfterLoad(db, "UPDATE orders SET state = 'FAILED', failure_reason = 'x' WHERE id = ?");
    const err = serviceError(() => evaluateOrder(db, "alice", o.id));
    restore();
    expect([err.code, err.status]).toEqual(["INVALID_STATE", 409]);
    expect(row(db, o.id).state).toBe("AWAITING_APPROVAL");
  });

  it("applyOrderEvaluation with a stale row cannot overwrite an approval made by a second operation", () => {
    const db = freshDb();
    const o = userBuy(db);
    const stale = loadOrderRow(db, "alice", o.id);
    approveOrder(db, "alice", o.id, { version: o.version }); // second operation
    const err = serviceError(() => db.transaction(() =>
      applyOrderEvaluation(db, "alice", stale, "system", new Date(), { bumpOnReprice: true }))());
    expect([err.code, err.status]).toEqual(["INVALID_STATE", 409]);
    const after = getOrder(db, "alice", o.id);
    expect(after.state).toBe("APPROVED");
    expect(after.hasApproval).toBe(true);
    expect(executeOrder(db, "alice", o.id).order.state).toBe("EXECUTED");
  });

  it("a direct state change before the call is a 409 for edit, evaluate and approve", () => {
    const db = freshDb();
    const o = userBuy(db);
    db.prepare("UPDATE orders SET state = 'FAILED', failure_reason = 'x' WHERE id = ?").run(o.id);
    for (const fn of [
      () => editOrder(db, "alice", o.id, { notionalCents: 6_000 }),
      () => evaluateOrder(db, "alice", o.id),
      () => approveOrder(db, "alice", o.id, { version: o.version }),
    ]) {
      const err = serviceError(fn);
      expect([err.code, err.status]).toEqual(["INVALID_STATE", 409]);
    }
    expect(row(db, o.id)).toMatchObject({ state: "FAILED", version: o.version });
  });
});

// --- 4. Broker failure handling -----------------------------------------------------------------

describe("paper broker failures", () => {
  const CLAIM = "UPDATE orders SET state = 'EXECUTED'";

  it("a transient SQLITE_BUSY during the fill is a retryable 503 and leaves the order APPROVED", () => {
    const db = freshDb();
    const o = userBuy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    const cash = balance(db, PAPER);

    const restore = patchStatement(db, CLAIM, "run", () => {
      throw new Database.SqliteError("database is locked", "SQLITE_BUSY");
    });
    const err = serviceError(() => executeOrder(db, "alice", o.id));
    restore();

    expect(err.status).toBe(503);
    expect(err.details).toEqual({ retryable: true });
    expect(row(db, o.id).state).toBe("APPROVED");
    expect(balance(db, PAPER)).toBe(cash);
    expect(listAudit(db, "alice", { actionId: o.id }).map((e) => e.eventType)).not.toContain("order.failed");

    const retry = executeOrder(db, "alice", o.id);
    expect(retry.order.state).toBe("EXECUTED");
    expect(retry.duplicate).toBe(false);
  });

  it("a write lock held by another connection is a retryable 503, then the retry fills", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clearfi-busy-"));
    const file = path.join(dir, "busy.db");
    const db = openDb(file, T0);
    const other = new Database(file);
    try {
      db.pragma("busy_timeout = 0"); // fail fast instead of waiting 5s
      const o = userBuy(db);
      approveOrder(db, "alice", o.id, { version: o.version });

      other.exec("BEGIN IMMEDIATE");
      const err = serviceError(() => executeOrder(db, "alice", o.id));
      other.exec("ROLLBACK");

      expect(err.status).toBe(503);
      expect(row(db, o.id).state).toBe("APPROVED");
      expect(executeOrder(db, "alice", o.id).order.state).toBe("EXECUTED");
    } finally {
      other.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an internal error marks the order FAILED, stamped with the attempt's time", () => {
    const db = freshDb();
    const o = userBuy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    const attempt = new Date(T0.getTime() + 5 * MINUTE_MS);
    vi.setSystemTime(attempt);
    const cash = balance(db, PAPER);

    const restore = patchStatement(db, CLAIM, "run", () => { throw new Error("disk exploded"); });
    const err = serviceError(() => executeOrder(db, "alice", o.id));
    restore();

    expect([err.code, err.status]).toEqual(["INTERNAL", 500]);
    expect(row(db, o.id)).toMatchObject({ state: "FAILED", failure_reason: "disk exploded",
      updated_at: attempt.toISOString() });
    expect(balance(db, PAPER)).toBe(cash);
    expect(listAudit(db, "alice", { actionId: o.id }).map((e) => e.eventType)).toContain("order.failed");
  });
});
