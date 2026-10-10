# Markets API: simulated quotes, portfolio, paper orders, mandates

This file documents the routes under `app/api/markets`, `app/api/portfolio`, `app/api/orders` and `app/api/mandates` as they are implemented. Service code lives in `lib/markets/`. Types come from `lib/markets/types.ts` and are re-exported by `@/lib/markets`.

Conventions shared with [../API.md](../API.md):

- **Identity.** Every private route gets the user from `getSessionUserId()`. No body or query field can carry a user ID: request schemas are strict objects, so an unknown key such as `userId`, `state`, `version` (on create), `createdBy`, `mandateId` or `approvalHash` is a `400`.
- **Ownership.** Every SQL query on `orders`, `positions`, `mandates`, `trading_controls` and `accounts` filters on `user_id`. If a record belongs to another user, the route returns `404 NOT_FOUND`, exactly as if the record did not exist.
- **Errors.** `{ "error": { "code", "message", "details"? } }`. Zod validation failures are `400 BAD_REQUEST`, with message `"Invalid request"` and `details` set to the Zod issues. Unhandled errors are `500 INTERNAL`.
- **Money and shares.** Money is integer cents in USD. Share quantities are integer **micro-shares** (`quantityMicros`, shares × 1,000,000). Every share × price product goes through `mulDiv` (BigInt) in `lib/markets/math.ts`. Floats appear only inside the price simulator and in display-only percentages (`changePct`, `weightPct`).

## Simulation labels (must stay visible)

| Where | Value |
|---|---|
| `SIMULATED_PRICES_DISCLAIMER` | `"Simulated prices — not real market data"`, returned as `disclaimer` by instruments, quotes, history and portfolio |
| `SIMULATED_MARKET_STATUS` | `"Simulated market — always open"`, returned as `market: { status: "open", label }`. The simulator has no market hours, holidays or halts |
| `Quote.source`, `PriceHistory.source`, `Portfolio.quotesSource`, `OrderFill.quoteSource` | `"simulated"`. `Quote.delayedMinutes` is `0` |
| `PaperOrder.paper`, `Mandate.paper`, `OrderFill.paper`, `OrderFill.simulated` | always `true` (paper money only) |
| `PortfolioAccount.label` | `"Paper trading (simulated)"` or `"Imported holdings (view-only)"` |
| `Portfolio.paperValueCents` | paper cash plus paper positions. Shown separately and **never** counted in net worth (`investedValueCents` covers non-paper positions only) |

Real tickers are identifiers only. The catalog has 12 stocks and ETFs (`VTI VOO QQQ SCHD BND AAPL MSFT NVDA AMZN GOOGL JPM KO`). There are no options, margin, leverage or short positions.

## Market data (public, no user records)

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/api/markets/instruments` | – | `{ instruments: Instrument[], market: { status: "open", label }, disclaimer }` |
| GET | `/api/markets/quotes` | `?symbols=VTI,AAPL` (comma-separated, case-insensitive; omit to get every instrument) | `{ quotes: Quote[], unknown: string[], market, disclaimer }`. Symbols are trimmed, upper-cased and de-duplicated. Symbols outside the catalog go to `unknown` (they don't cause an error). More than 50 symbols returns `400 BAD_REQUEST` |
| GET | `/api/markets/history/:symbol` | `?days=30` | `{ history: PriceHistory, quote: Quote \| null }`. `days` defaults to 30 (also used when the value is missing, non-numeric or `0`) and is clamped to 1–365. `points` holds `days` completed UTC daily closes followed by the current simulated price, so there are `days + 1` points. An unknown symbol returns `404 NOT_FOUND` (`"Instrument not found"`) |

Quotes are deterministic for a given symbol and minute, so the same `(symbol, minute)` always returns the same price. Within a day, prices move smoothly, with a per-minute wiggle capped at 0.15%. That cap sits well inside the 1% order price bound.

## Trading controls

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/markets/controls` | – | `{ controls: TradingControls, paused: boolean, usage: { executedTodayCents } }`. `paused` is the global pause from core `user_controls`. `executedTodayCents` is the gross value of this user's paper fills in the current UTC day |
| PATCH | `/api/markets/controls` | `{ perOrderLimitCents?, dailyOrderLimitCents? }` (strict; integers 0–100,000,000; at least one) | `{ controls }`. Writes the `trading_controls.updated` audit event. `400` on invalid or empty input |

The seeded defaults are $500 per order and $1,000 per day (`DEFAULT_TRADING_CONTROLS`), and they also apply to a user without a row. The pause is **not** changed here: use `PATCH /api/controls` (core). It blocks transfers, orders and mandate trades alike. Only these user routes can change limits; no assistant or agent tool can.

## Portfolio

| Method | Path | Response |
|---|---|---|
| GET | `/api/portfolio` | `{ portfolio: Portfolio }`: every `brokerage` account the user owns (imported view-only accounts first, then paper), with positions valued at the current simulated price |

`Position` fields: `quantityMicros`, `costBasisCents`, `averageCostCents` (per whole share, rounded), `priceCents` (falls back to the average cost if there is no quote), `marketValueCents`, `unrealizedPnlCents` and `weightPct` (display only). `PortfolioAccount.tradable` is true only for a paper brokerage account with the `trade` capability.

## Paper orders

### Lifecycle

```
PROPOSED ──evaluate──▶ HELD ◀──────────────┐
    │                   │ evaluate (ALLOW)  │ policy fails at approve/execute
    └──evaluate──▶ AWAITING_APPROVAL ───────┤
                        │ approve {version} │ (or mandate authorization)
                        ▼                   │
                     APPROVED ──────────────┘
                        │ execute
                        ▼
                     EXECUTED            FAILED (paper broker internal error)
```

- `PROPOSED` is transient. Create and edit evaluate the order in the same transaction, so callers see `HELD` or `AWAITING_APPROVAL`.
- `EXECUTED` and `FAILED` are terminal. Neither can be edited, re-evaluated or approved.
- Any edit (allowed in `PROPOSED`, `HELD`, `AWAITING_APPROVAL` and `APPROVED`) bumps `version`, clears the approval, **detaches any mandate**, then re-prices and re-evaluates the order.
- A re-evaluation (from the evaluate route, or after a failed approve or execute) clears any approval. If the price bound changes, `version` is bumped.
- User, assistant and agent orders without a mandate always wait for the user's exact-version approval. Nothing auto-approves except a valid mandate (see below).

### Sizing

Provide exactly one of `quantityMicros` (0.001–1,000,000 shares, i.e. `1_000`–`1_000_000_000_000`) or `notionalCents` ($1–$1,000,000, i.e. `100`–`100_000_000`). Sells must be sized by `quantityMicros`, which also rules out short sales. Symbols must match `^[A-Za-z][A-Za-z.]{0,9}$` and are upper-cased. A well-formed symbol outside the catalog still creates an order, which is immediately `HELD` with `INSTRUMENT_NOT_ALLOWED` and `QUOTE_UNAVAILABLE`.

### Price bound (what the user approves)

Every evaluation captures the current simulated quote (`quotePriceCents`) and derives `priceBoundCents`:

- **Buy:** the maximum fill price, `ceil(quote × 1.01)`.
- **Sell:** the minimum fill price, `max(1, floor(quote × 0.99))`.

The bound is part of the approval hash (`lib/markets/approval.ts`). The hash covers `userId`, `orderId`, `version`, `accountId`, `symbol`, `side`, `quantityMicros`, `notionalCents`, `priceBoundCents`, `mandateId` and `"USD"`. When `evaluate`, or a failed approve or execute, re-prices to a different bound, the order gets a new `version`, so an earlier review can't approve it. At approval and again at execution, policy compares the **stored** bound against the **current** quote. If the price has moved past it, the order is held with `PRICE_OUT_OF_BOUND` and re-priced to a new version, which needs a fresh review.

### Estimated value (used for limits, cash and mandate budgets)

- Buy by notional: the notional.
- Buy by quantity: `ceil(quantity × priceBound)`, the worst case.
- Sell: `floor(quantity × current quote)`.

### Fill rules (paper broker, `lib/markets/broker.ts`)

- Fills happen at the current simulated price, which must be within the bound.
- Buy by notional: `quantity = floor(notional × 1e6 / price)`. For every buy, `grossCents = ceil(quantity × price / 1e6)`, which is never more than the notional or the worst-case estimate. Paper cash is debited by `grossCents`, and the cost basis rises by `grossCents`.
- Sell: `grossCents = floor(quantity × price / 1e6)`. The cost portion is pro-rata (rounded), or the whole basis when the position closes. `realizedPnlCents = gross − cost portion`. A fully sold position is deleted.
- Only accounts with `is_paper = 1` are touched. Imported (view-only) and bank balances never change.

### Hold reasons (`ORDER_HOLD_REASONS`)

| Reason | Check |
|---|---|
| `NOT_TRADABLE` | The account isn't a paper `brokerage` account with the `trade` capability (create, edit and mandate creation already reject such accounts with `400 UNSUPPORTED`) |
| `INSTRUMENT_NOT_ALLOWED` | The symbol isn't a supported stock or ETF |
| `QUOTE_UNAVAILABLE` | There is no simulated quote |
| `PRICE_OUT_OF_BOUND` | The current quote is above the buy maximum or below the sell minimum (or no bound was captured) |
| `ORDER_LIMIT_EXCEEDED` | The estimated value exceeds `perOrderLimitCents` (applies to sells too) |
| `DAILY_ORDER_LIMIT_EXCEEDED` | Today's executed gross plus the estimated value exceeds `dailyOrderLimitCents` (applies to sells too) |
| `INSUFFICIENT_CASH` | Buy: the estimated value exceeds the paper account's `availableCents` |
| `INSUFFICIENT_SHARES` | Sell: the quantity exceeds the shares held in that account (no shorting) |
| `PAUSED` | The global pause (`user_controls.paused`) is on |
| `MANDATE_INVALID` | Orders that carry a mandate only. The mandate is missing, revoked or expired, belongs to a different agent, or covers a different account, side or symbol. It can also mean the order exceeds the mandate's per-order cap or its remaining daily budget |

`PaperOrder.policy` holds the full `OrderPolicyResult`: `decision`, `reasons`, per-check `checks[]` with human-readable `detail`, `quotePriceCents`, `estimatedValueCents` and `evaluatedAt`.

### Routes

| Method | Path | Body | Response | Errors |
|---|---|---|---|---|
| GET | `/api/orders` | `?state=&limit=` | `{ orders: PaperOrder[] }`, newest first. `limit` defaults to 50, clamped to 1–500. An unrecognized `state` returns `[]` | – |
| POST | `/api/orders` | `{ accountId, symbol, side: "buy"\|"sell", quantityMicros? , notionalCents? }` | `201 { order }`, with `createdBy: "user"` and state `HELD` or `AWAITING_APPROVAL` | `400 BAD_REQUEST` (validation), `404 NOT_FOUND` (account), `400 UNSUPPORTED` (view-only/bank account) |
| GET | `/api/orders/:id` | – | `{ order, instrument: Instrument \| null, quote: Quote \| null }` | `404` |
| PATCH | `/api/orders/:id` | any of `{ accountId, symbol, side, quantityMicros, notionalCents }` (at least one, at most one sizing field; setting one sizing field clears the other) | `{ order }`: version + 1, approval cleared, mandate detached, re-priced and re-evaluated | `400` (validation, or a sell without `quantityMicros`), `404`, `409 INVALID_STATE` (`EXECUTED`/`FAILED`), `400 UNSUPPORTED` |
| POST | `/api/orders/:id/evaluate` | – | `{ order }`: re-priced and re-evaluated. Version + 1 only if the bound changed | `404`, `409 INVALID_STATE` unless `PROPOSED`/`HELD`/`AWAITING_APPROVAL` |
| POST | `/api/orders/:id/approve` | `{ version }` (positive integer; other keys are ignored and are never treated as a hash) | `{ order }` → `APPROVED`, `approvedBy: "user:<id>"`, `hasApproval: true` | `400`, `404`, `409 INVALID_STATE` unless `AWAITING_APPROVAL`, `409 STALE_VERSION` if `version` isn't current, `409 POLICY_HOLD` (`details.reasons`): policy now fails, the order was re-evaluated (it may be `HELD`, or re-priced to a new version) |
| POST | `/api/orders/:id/execute` | – | `{ order, fill: OrderFill, duplicate: boolean }`. Repeats return the original fill with `duplicate: true` and move nothing | `404`; `409 INVALID_STATE` unless `APPROVED` (`details.state`); `409 APPROVAL_INVALID` if the stored hash no longer matches the current version (the approval is discarded and the order re-evaluated); `409 POLICY_HOLD` (`details.reasons`) if pause, limits, cash/shares, mandate or the price bound now fail (the approval is discarded and the order re-evaluated); `500 INTERNAL` `"Paper order failed: …"` if the broker hits an internal error (the order becomes `FAILED`, with `failureReason`) |

The execute route runs as `user:<id>`. A `409` from approve or execute still commits the re-evaluation, so the order's new state is in the database.

**Approval hash.** The server computes the hash and stores it in `orders.approval_hash`. It is never serialized: `toOrder()` exposes only `hasApproval: boolean`. No route accepts a hash. Audit events record only `approvalHashPrefix` (first 12 hex characters), the same as core transfers.

**Single execution.** Execution runs in one `BEGIN IMMEDIATE` transaction. It verifies the owner, the state and the hash, re-runs policy, and checks the bound. It then claims the order with `UPDATE … WHERE state = 'APPROVED' AND version = ?` before moving cash and shares. A table `CHECK` ties `state = 'EXECUTED'` to exactly one fill.

## Mandates (bounded autonomous paper buying)

A mandate gives **one background agent** limited authority to place **paper BUY orders**, sized by notional, in **one paper account** and for **listed symbols**. Each mandate has a per-order cap, a daily budget and an expiry.

### Who can do what

- **Create and revoke:** only the signed-in user, through the routes below. No assistant or agent tool creates, widens or revokes a mandate, and none are seeded.
- **Use:** only the agent named in `agentId`, through the governed helper `proposeMandateOrder` (below).
- **Edit:** mandates can't be edited. To change the terms, revoke the mandate and create a new one.

### What a valid mandate auto-authorizes

When the agent's order passes **every** policy check, the order is approved as `approvedBy: "mandate:<id>"` instead of waiting for the user, and the broker executes it straight away as `agent:<agentId>`. The policy checks include the mandate check: active (not revoked, `expiresAt` in the future), same agent, same account, `buy`, symbol covered, estimated value ≤ `maxOrderCents`, and today's mandate usage plus value ≤ `maxDailyCents`.

### What still applies under a mandate

All the ordinary checks still apply: the global **pause**, the user's **trading limits** (per-order and daily, counted across all orders), paper cash, the supported-instrument list and the price bound. Execution re-checks all of them, including the mandate itself. So revoking or expiring a mandate after authorization still blocks the fill, and so does using up the daily budget with another order. An order that fails stays `HELD` (or is re-evaluated) for the user to review, and the user's explicit approval is then required. If the user edits a mandate order, the mandate is detached. A user approval never lets the agent execute: agents can execute only their own orders with `approvedBy: "mandate:<id>"`.

`usedTodayCents` and `remainingTodayCents` count the gross of `EXECUTED` orders carrying this `mandate_id` in the current UTC day.

### Routes

| Method | Path | Body | Response | Errors |
|---|---|---|---|---|
| GET | `/api/mandates` | – | `{ mandates: Mandate[] }`, newest first, with `status` (`active`/`expired`/`revoked`), `usedTodayCents` and `remainingTodayCents` | – |
| POST | `/api/mandates` | `{ agentId, accountId, symbols: string[], side?: "buy", maxOrderCents, maxDailyCents, expiresAt }` | `201 { mandate }`. Writes the `mandate.created` audit event | `400 BAD_REQUEST`: `agentId` must match `^[a-z0-9][a-z0-9_-]{0,39}$`; 1–12 symbols, all in the catalog (duplicates removed); caps of $1–$1,000,000 with `maxOrderCents ≤ maxDailyCents`; `side` other than `"buy"`; `expiresAt` must be an ISO datetime with offset, in the future and at most 90 days out. Also `404 NOT_FOUND` (account) and `400 UNSUPPORTED` (account isn't a paper trading account) |
| POST | `/api/mandates/:id/revoke` | – | `{ mandate }` with `status: "revoked"`. Takes effect immediately and is idempotent (revoking again changes nothing and writes no second audit event). Writes `mandate.revoked` | `404` |

There is no `GET /api/mandates/:id` route. `getMandate(db, userId, id)` exists in the library.

### Governed helper for the agents module

```ts
import { proposeMandateOrder } from "@/lib/markets";

proposeMandateOrder(
  db: DB,
  userId: UserId,          // from the job / ToolContext, never from model output
  mandateId: string,
  agentId: string,         // the calling agent's registry id, e.g. "dca-bot"
  input: { symbol: string; notionalCents: number },  // strict; notional $1–$1,000,000
  now?: Date,
): MandateOrderResult      // { order: PaperOrder; fill: OrderFill | null; executed: boolean; refusal: { code; message } | null }
```

| Outcome | Result |
|---|---|
| Fits the mandate and every policy check | `executed: true`, `order.state: "EXECUTED"`, `fill` set, `approvedBy: "mandate:<id>"`, `fill.executedBy: "agent:<agentId>"` |
| Policy holds at creation (e.g. `MANDATE_INVALID`, `PAUSED`, a limit) | `executed: false`, `refusal: null`, `order.state: "HELD"`, with `holdReasons` |
| Authorized, but the execution re-check refuses (409) | `executed: false`, `refusal: { code, message }`, order re-evaluated |
| Invalid `agentId` | throws `ServiceError` `400 BAD_REQUEST` |
| Invalid `input` (bad symbol format, notional out of range, extra keys) | throws `ZodError` (`handler()` renders it as `400 BAD_REQUEST`) |
| Well-formed `agentId` that isn't the mandate's agent | not thrown: the order is created as `agent:<agentId>` and `HELD` with `MANDATE_INVALID` |
| Mandate not found for this user | throws `404 NOT_FOUND` |
| The mandate's account is no longer tradable | throws `400 UNSUPPORTED` |
| Paper broker internal error | throws `500 INTERNAL`, order `FAILED` |

Agents must not call `approveOrder`, `createMandate`, `revokeMandate`, `updateTradingControls` or `editOrder`. They must not call `executeOrder` directly either: `proposeMandateOrder` is the only governed path to execution.

## Audit events

`order.proposed`, `order.held`, `order.awaiting_approval`, `order.repriced`, `order.edited`, `order.approved`, `order.mandate_authorized`, `order.approval_invalidated`, `order.executed`, `order.execute_duplicate`, `order.execute_refused`, `order.failed`, `mandate.created`, `mandate.revoked`, `trading_controls.updated`. Order events use the order ID as `actionId`, so `GET /api/audit?actionId=<orderId>` returns an order's history.
