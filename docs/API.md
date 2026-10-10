# ClearFi API contract

All routes live under `app/api/` and return JSON. Types are defined in [`lib/types.ts`](../lib/types.ts) — import them instead of redefining shapes.

**Identity.** The current demo user comes from the `clearfi_user` cookie (`alice` default, or `bob`). This is a local demo mechanism, not authentication. No route accepts a user ID in the body or query; every read and write is scoped to the session user on the server.

**Errors.** Failures return `{ "error": { "code": ApiErrorCode, "message": string, "details"?: unknown } }` with status 400 (bad input), 404 (missing or not yours — the two are indistinguishable on purpose), 409 (state, version, approval or policy conflict) or 500.

**Money.** Integer cents + `"USD"`. Never floats.

## Session and demo

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/session` | – | `{ user: { id, name }, users: { id, name }[] }` |
| POST | `/api/session` | `{ userId: "alice" \| "bob" }` | same as GET |
| POST | `/api/demo/reset` | – | `{ ok: true }` — wipes and reseeds the SQLite database |

## Reads

| Method | Path | Response |
|---|---|---|
| GET | `/api/accounts` | `{ accounts: Account[], netWorthCents: number, asOf: string }` |
| GET | `/api/transactions?accountId=&limit=` | `{ transactions: Transaction[] }` (newest first, default limit 50) |
| GET | `/api/insights` | `{ spending: SpendingSummary, subscriptions: SubscriptionIncrease[], evidence: Record<string, Transaction> }` — `evidence` maps every evidence transaction ID to its record |
| GET | `/api/recipients` | `{ recipients: (Recipient & { status: RecipientStatus })[] }` |
| GET | `/api/research` | `{ documents: { id, title, source, publishedAt, synthetic: true, untrusted: true }[] }` |
| GET | `/api/controls` | `{ controls: UserControls, usage: { executedTodayCents: number } }` |
| GET | `/api/audit?actionId=&limit=` | `{ events: AuditEvent[] }` (newest first) |

## Transfer actions

Lifecycle: `PROPOSED → HELD | AWAITING_APPROVAL → APPROVED → EXECUTED` (`FAILED` if the simulation fails).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/actions` | – | `{ actions: TransferAction[] }` newest first |
| POST | `/api/actions` | `CreateTransferInput` | `201 { action }` — created and immediately evaluated, so state is `HELD` or `AWAITING_APPROVAL` |
| GET | `/api/actions/:id` | – | `{ action, recipient: Recipient & { status }, sourceAccount: Account }` |
| PATCH | `/api/actions/:id` | `EditTransferInput` | `{ action }` — bumps `version`, drops any approval, re-evaluates |
| POST | `/api/actions/:id/evaluate` | – | `{ action }` — reruns policy (use after resolving a hold) |
| POST | `/api/actions/:id/approve` | `{ version }` | `{ action }` → `APPROVED`. `409 STALE_VERSION` if the version changed, `409 POLICY_HOLD` (and action moves to `HELD`) if policy now fails, `409 INVALID_STATE` unless `AWAITING_APPROVAL` |
| POST | `/api/actions/:id/execute` | – | `{ action, receipt, duplicate: boolean }`. Repeated calls return the original receipt with `duplicate: true`. `409 INVALID_STATE` if not approved (e.g. held), `409 APPROVAL_INVALID` if anything material changed since approval, `409 POLICY_HOLD` if pause/limits/balance now fail |
| POST | `/api/recipients/:id/verify` | – | `{ recipient }` — simulates out-of-band verification of the current details. Held actions must then be re-evaluated |

There is deliberately **no** route that lets a client set an action's state or supply an approval hash.

## Controls

| Method | Path | Body | Response |
|---|---|---|---|
| PATCH | `/api/controls` | `UpdateControlsInput` | `{ controls }` — pausing blocks execution of new and already-approved actions |

## Assistant

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/chat` | `ChatRequest` (`{ messages: { role, content }[] }`, full visible history) | `ChatResponse` — `mode` is `live` (real model call) or `fallback` (labeled deterministic summary). `trace` lists every tool call the model made. `proposedActionIds` are proposals it created; the user still approves on the transfer card |

Assistant tools are read-only plus `propose_transfer`. There is no approve or execute tool.

## Simulated bank connections (integrated October 10)

All private operations derive the user from the session and return 404 for another user's connection. Institutions are public synthetic profiles, not real bank links.

| Method | Path | Body / response |
|---|---|---|
| GET | `/api/institutions` | `{ institutions: Institution[] }` |
| GET | `/api/connections` | `{ connections: Connection[] }` |
| POST | `/api/connections` | `{ institutionId }` → `201 { connection, sync }` |
| POST | `/api/connections/:id/sync` | `{ sync: SyncSummary }` |
| POST | `/api/connections/:id/reconnect` | `{ connection }` — simulated reauthentication |
| POST | `/api/connections/:id/disconnect` | `{ connection }` — retains history, removes transfer capabilities |
| POST | `/api/connections/:id/simulate` | `{ scenario: "login_required" \| "error" }` → `{ connection }` |
| GET | `/api/portfolio` | `{ portfolio }` — simulated holdings, paper value separate |

Account/transaction amounts retain their own USD, GBP, CAD or EUR currency. Transfers and limits remain USD. `/api/accounts` also returns `netWorth`, including its cash/debt, simulated investments and dated FX rates. Paper balances are excluded. UI account values use cash plus positions where available; unavailable holdings are labeled rather than silently presented as total account value.

Recovered market/order/mandate and agent routes are present under `app/api/`; the selected UI exposes accounts and holdings, not a new trading workflow. Agent permissions are documented in [api/agents.md](api/agents.md). See [UI-IMPLEMENTATION.md](UI-IMPLEMENTATION.md) for local launch, data initialization and QA.
