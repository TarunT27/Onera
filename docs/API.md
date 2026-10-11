# Onera API contract

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
| POST | `/api/chat` | `ChatRequest` (`{ agent?, source?, messages: { role, content }[] }`, full visible history). `agent` is `general` (default), `research`, `chart`, `risk` or `drafter`; each gets only its own tools (`lib/ai/agents.ts`). `source: "voice"` asks for a short spoken-style reply and is recorded on the `assistant.prompt` audit event; it changes no tools | `ChatResponse` — `mode` is `live` (real model call) or `fallback` (labeled deterministic summary). `trace` lists every tool call the model made. `proposedActionIds` are transfer proposals and `proposedOrderIds` paper-order proposals (Trade drafter only) it created; the user still approves on the transfer card or the Trade page. `agent` is the agent that answered |

Assistant tools are read-only plus `propose_transfer`. There is no approve or execute tool.

### Voice (ElevenLabs)

Voice is transport only. The UI transcribes speech, routes the transcript with a deterministic keyword router (`app/components/voiceIntent.ts`: page navigation, explicit buy/sell → `drafter`, everything else → `general`) and sends it to `POST /api/chat` with `source: "voice"`. Approvals stay a tap on the card. `ELEVENLABS_API_KEY` stays on the server.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/voice` | — | `{ configured, provider: "ElevenLabs", sttModel, ttsModel }` (never the key) |
| POST | `/api/voice/transcribe` | multipart form with an `audio` file (≤ 10 MB, `audio/*` or `video/webm`) | `{ text, languageCode }`. Transcribes only; nothing is acted on |
| POST | `/api/voice/speak` | `{ text }` | `audio/mpeg`. Markdown, URLs and record IDs are stripped and long replies are cut at a sentence (`lib/voice`) |

Without a key both POSTs return `503 UNSUPPORTED`. ElevenLabs failures return `502` (or `429` for rate limits) with ElevenLabs' message.

## Security monitoring

Refused requests are audited at the HTTP boundary (`handler()` in `lib/http.ts`): any `404 NOT_FOUND` or `409 INVALID_STATE | STALE_VERSION | APPROVAL_INVALID | POLICY_HOLD` writes a `request.refused` audit event under the **caller's** session user with `{ code, status, method, path }` only — never whether the record exists or who owns it. When the assistant reads a research document containing embedded instructions, `assistant.untrusted_instructions` is written with `{ source, markers }` (detection only; the document is returned unchanged).

The background **threat monitor** (`threat_sweep` job, agent `threat_monitor`) sweeps the user's own audit log shortly after new activity and raises `security_threat` insights for patterns such as repeated not-found probes, execution without approval, stale-approval replays, recipient swaps before a transfer, limit probing, controls loosened before an approval, prompt injection and refused assistant tools. Rules and thresholds: `lib/agents/monitors/threats.ts`. Findings use the existing insight routes (`GET /api/agents/insights?agentId=threat_monitor`, `PATCH /api/agents/insights/:id`) and appear on `/security`. The monitor is advisory: it cannot pause, hold, approve or execute. The page's "Pause transfers" button is the user's own `PATCH /api/controls`.

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

Module API references: [api/providers.md](api/providers.md) (bank connections), [api/markets.md](api/markets.md) (quotes, portfolio, paper orders, mandates) and [api/agents.md](api/agents.md) (monitoring agents, permission matrix, worker) and [api/family.md](api/family.md) (kids' secondary cards, limits, freeze). The selected UI exposes accounts and holdings, not a new trading workflow. See [UI-IMPLEMENTATION.md](UI-IMPLEMENTATION.md) for local launch, data initialization and QA.
