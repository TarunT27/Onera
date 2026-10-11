# Simulated bank connections API

Routes under `app/api/institutions` and `app/api/connections`, backed by [`lib/providers`](../../lib/providers/index.ts). This page describes the code as implemented and expands the summary table in [API.md](../API.md#simulated-bank-connections-integrated-october-10).

> **Simulated institutions.** Every institution is a synthetic profile that imitates the shape of a real bank's data. Onera is **not affiliated** with TD Bank, Bank of America, JPMorgan Chase, Barclays or RBC Royal Bank. There is no real connection, no credentials and no real money. Each institution has `simulated: true`, a display name ending in `(simulated)` and a `disclaimer` (`"Simulated connector. Not affiliated with <brand>; no real connection or credentials."`). Every connection has `simulated: true`. The UI must keep these labels visible.

## Conventions

- **Identity.** The user comes from the server session (`getSessionUserId()`, the `clearfi_user` cookie, default `alice`). No route accepts a user ID in the path, query or body.
- **Ownership.** Another user's connection, or an ID that doesn't exist, returns `404 NOT_FOUND` (`"Connection not found"`). The two cases look the same.
- **Errors.** `{ "error": { "code", "message", "details"? } }`, from `handler()` in `lib/http.ts`:
  - `400 BAD_REQUEST`: invalid JSON (`"Body must be valid JSON"`) or a body that fails the Zod schema (`message: "Invalid request"`, `details`: Zod issues).
  - `404 NOT_FOUND`: unknown institution or connection, or one owned by someone else.
  - `409 INVALID_STATE`: the connection's status doesn't allow the operation. `details` holds the current `status` and usually a `requiredAction` (`"reconnect"` or `"link"`).
  - `500 INTERNAL`: an unexpected error.
- **Bodies.** An empty body is read as `{}`. Routes without a body schema ignore whatever is sent.
- **Money.** Linked balances and transactions are integer minor units in the account's own currency (`USD`, `GBP`, `CAD`). Only USD accounts at transfer-capable institutions can be used as transfer endpoints.
- **Audit.** Each state change writes an audit event (`connection.linked`, `connection.relinked`, `connection.synced`, `connection.sync_blocked`, `connection.disconnected`, `connection.reconnected`, `connection.status_simulated`). Route calls use the actor `user:<id>`.

## Shapes

Defined in [`lib/providers/types.ts`](../../lib/providers/types.ts).

```ts
interface Institution {
  id: string;                 // "ins_td", "ins_boa", "ins_chase", "ins_barclays_uk", "ins_rbc"
  name: string;               // "TD Bank (simulated)"
  brand: string;              // the real-world brand being imitated; no affiliation
  country: string;            // "US" | "GB" | "CA"
  currency: CurrencyCode;     // "USD" | "GBP" | "CAD"
  kind: "bank" | "brokerage" | "international";
  products: AccountType[];
  supportsTransfers: boolean; // false for the GBP/CAD institutions
  simulated: true;
  disclaimer: string;
}

type ConnectionStatus = "healthy" | "login_required" | "error" | "disconnected";

interface Connection {
  id: string;                 // "conn_<user>_<institution slug>", e.g. "conn_bob_boa"
  userId: UserId;
  institutionId: string;
  institutionName: string;
  status: ConnectionStatus;
  consentScopes: string[];    // [] when disconnected
  lastSyncedAt: string | null;
  lastError: string | null;   // set by simulated failures, prefixed "Simulated:"
  accountIds: string[];       // linked accounts, also returned by GET /api/accounts
  createdAt: string;
  simulated: true;
}

interface SyncSummary {
  connectionId: string;
  status: ConnectionStatus;   // always "healthy" on success
  added: number;
  modified: number;           // e.g. a pending transaction posted
  removed: number;            // e.g. an authorization hold dropped
  newTransactionIds: string[];// posted transactions new in this sync
  syncedAt: string;
}
```

Consent scopes: `accounts:read`, `balances:read`, `transactions:read`, plus `identity:account_ownership` at transfer-capable institutions.

Account capabilities set at link time (`capabilitiesFor`):

| Institution | Checking / savings | Credit card |
|---|---|---|
| USD and `supportsTransfers` (TD, BoA, Chase) | `view`, `transfer_source`, `transfer_destination` | `view`, `transfer_destination` |
| GBP / CAD (Barclays UK, RBC) | `view` | – |
| Any connection after disconnect | `view` | `view` |

Linking also creates an `own_account` recipient (verified through the simulated link) for each account with `transfer_destination`. These recipients only make an account eligible for the governed transfer lifecycle (`lib/actions`). Nothing in this module moves money, approves or executes.

## Routes

### `GET /api/institutions`

Public catalog. Not user-specific.

- **Response 200:** `{ institutions: Institution[] }` (5 institutions)
- **Errors:** `500` only

### `GET /api/connections`

The session user's connections, ordered by `createdAt`, then `id`.

- **Response 200:** `{ connections: Connection[] }`
- **Errors:** `500` only

### `POST /api/connections`

Links a simulated institution (or re-links a disconnected one) and runs the initial sync over the last 90 days of history.

- **Body:** `{ institutionId: string }` (1–64 characters)
- **Response 201:** `{ connection: Connection, sync: SyncSummary }`
  - A new link creates the connection, its accounts and own-account recipients.
  - A re-link of a `disconnected` connection reuses the same connection ID, accounts and history, restores the consent scopes and capabilities, and syncs from the stored cursor.
- **Errors:**
  - `400 BAD_REQUEST`: missing or invalid `institutionId`, or invalid JSON
  - `404 NOT_FOUND`: unknown institution (`"Institution not found"`)
  - `409 INVALID_STATE`: already linked and not disconnected (`"<name> is already linked"`, `details: { connectionId, status }`)

### `POST /api/connections/:id/sync`

Cursor sync up to now. Each sync re-delivers the last 12 hours of provider events, and applying them is idempotent: repeated syncs never duplicate rows, a pending transaction that posts is updated in place, and a removed hold is deleted and never comes back. After applying events, the sync pairs both legs of moves between the user's own accounts with a shared `transferGroupId`, so they are excluded from spending. It then recomputes balances.

- **Body:** none
- **Response 200:** `{ sync: SyncSummary }`
- **Status handling:** a connection in `error` retries and recovers to `healthy` (the simulated outage is transient).
- **Errors:**
  - `404 NOT_FOUND`
  - `409 INVALID_STATE` when `login_required` (`details: { status: "login_required", requiredAction: "reconnect" }`) or `disconnected` (`details: { status: "disconnected", requiredAction: "link" }`). A `connection.sync_blocked` audit event is written.

### `POST /api/connections/:id/reconnect`

Simulated re-authentication (like Plaid "update mode"). Sets the status to `healthy` and clears `lastError`. It doesn't sync; call `/sync` afterwards.

- **Body:** none
- **Response 200:** `{ connection: Connection }`
- **Errors:**
  - `404 NOT_FOUND`
  - `409 INVALID_STATE` when `disconnected` (`"Link the institution again instead."`, `details: { status, requiredAction: "link" }`)

### `POST /api/connections/:id/disconnect`

Revokes the simulated consent. Status becomes `disconnected`, `consentScopes` becomes `[]`, and every linked account becomes `["view"]`, so it can no longer be a transfer endpoint. Accounts and transaction history are kept. Calling it on a connection that is already disconnected returns that connection unchanged.

- **Body:** none
- **Response 200:** `{ connection: Connection }`
- **Errors:** `404 NOT_FOUND`

### `POST /api/connections/:id/simulate`

Demo-only. Puts a connection into a failure state so the UI can show recovery flows.

- **Body:** `{ scenario: "login_required" | "error" }`
- **Response 200:** `{ connection: Connection }` with `status` set to the scenario and a `lastError` beginning with `"Simulated:"`
  - `login_required`: sync is refused until `/reconnect`.
  - `error`: the next sync recovers.
- **Errors:**
  - `400 BAD_REQUEST`: missing or unknown `scenario`
  - `404 NOT_FOUND`
  - `409 INVALID_STATE` when `disconnected` (`details: { status }`)

## Jobs enqueued after sync

When a sync (from `POST /api/connections`, `POST /api/connections/:id/sync` or a background `sync_connection` job) brings at least one **new posted** transaction, the sync enqueues two jobs for the background agents in [`lib/agents`](agents.md):

| Job type | Agent | Dedupe key |
|---|---|---|
| `spending_review` | Spending monitor | `spending_review:<userId>:<connectionId>:<syncedAt>` |
| `subscription_review` | Subscription monitor | `subscription_review:<userId>:<connectionId>:<syncedAt>` |

The payload of both jobs is `{ connectionId, syncedAt, newTransactionIds }`. A "new posted" transaction is either a transaction that first arrives as posted or a pending one that posts. A sync with no new posted transactions enqueues nothing. Seeding the demo database never enqueues.

The providers module doesn't enqueue `sync_connection` itself. The agents scheduler does that for healthy connections (`lib/agents/scheduler.ts`), and the resulting background syncs run with the `system` actor.

## Tests

- `tests/providers.test.ts`: catalog and disclaimers, link and initial sync, idempotent re-delivery, cross-user 404s, disconnect and re-link, error and login_required recovery, foreign-currency capabilities, governed transfers surviving a sync.
- `tests/providers-sync.test.ts`: pending → posted in place, step-wise vs one-jump sync convergence, hold removal without resurrection, transfer-leg grouping (same-institution, card autopay, cross-institution, GBP) and its exclusion from `spendingSummary`, job enqueueing and dedupe keys, GBP/CAD conversion in `netWorth` with paper accounts excluded.
