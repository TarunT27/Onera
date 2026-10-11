# Onera — what's real, simulated, and roadmap

Use this list for the pitch, the submission and judge Q&A. If something isn't in "Real code", don't present it as working.

## Real code (runs and is tested)

| Feature | Where | Evidence |
|---|---|---|
| Transfer governance: propose → deterministic policy → exact-version approval → single atomic execution → receipt | `lib/actions`, `lib/policy` | `tests/transfers.test.ts`, `tests/scenarios.test.ts` |
| Holds: changed/unverified recipient, per-transfer and daily limits, insufficient funds, pause | `lib/policy/evaluate.ts`, `lib/policy/messages.ts` | `tests/transfers.test.ts` |
| Approval binding (any edit discards approval; recipient change after approval blocks execution) | `lib/policy/approval.ts` | `tests/approval.test.ts` |
| Duplicate and concurrent execution protection | `lib/actions/simulator.ts` | `tests/transfers.test.ts` |
| Server boundary independent of the UI (direct API calls refused) | `app/api/actions/**` | `tests/routes.test.ts` |
| Per-user data isolation (another user's records are 404) | every service | `tests/ownership.test.ts` |
| Spending summary excluding internal transfers; subscription price-increase detection with evidence | `lib/finance` | `tests/insights.test.ts` |
| Bank connector sync engine: link, cursor sync, no duplicates, pending→posted, removals, connection health, internal-transfer matching | `lib/providers` | `tests/providers*.test.ts` |
| Net worth across USD/GBP/CAD/EUR using dated demo FX; paper money excluded | `lib/finance/accounts.ts`, `lib/finance/fx.ts` | `tests/providers-sync.test.ts` |
| Paper orders through the same governed lifecycle; bounded mandates for autonomous paper trading | `lib/markets` | `tests/markets*.test.ts` |
| Background monitoring agents: job queue (dedupe, retries, dead-letter), worker, five monitors, persisted insights | `lib/agents`, `npm run worker` | `tests/agents*.test.ts` |
| AI governance in code: agent permission registry enforced at runtime; agents can't approve, execute, use mandates or change controls | `lib/agents/registry.ts`, `lib/agents/context.ts` | `tests/agents-registry.test.ts`, `tests/agents-scope.test.ts`, `tests/agents-boundary.test.ts` |
| Claude assistant with read tools and proposal-only writes; tool trace shown to the user; labeled fallback | `lib/ai` | `tests/ai-boundary.test.ts` |
| Family cards: kids' secondary cards with parent-set monthly and per-purchase limits, blocked categories, freeze, and deterministic approve/decline | `lib/family`, `/family` | `tests/family.test.ts`, e2e "family cards" |
| Audit log of every proposal, decision, approval, execution, agent run and tool call | `lib/audit.ts` | visible in Control |

## Simulated (works, but the data or counterparty is fake)

| Item | Label shown |
|---|---|
| People, balances, transaction history | "Synthetic" |
| TD Bank, Bank of America, JPMorgan Chase, Barclays UK, RBC connectors | "(simulated)" + "not affiliated, no real connection" |
| Money movement | "Simulated" receipts; no bank connection |
| Stock/ETF prices | "Simulated prices — not real market data"; simulated market is always open |
| Paper portfolio | "Paper · not in net worth" |
| FX rates | "Onera demo FX (synthetic)" with a date |
| Recipient verification | "Simulated out-of-band check" |
| The injected article | Labeled synthetic and malicious |

## Not verified at time of writing

- Live Claude chat with a real API key (only the labeled fallback has been exercised). Run it before the demo and record what the model actually did with the injected article.

## Roadmap (not built — say "next")

- Real account aggregation (e.g. Plaid) behind the same connector interface; verified webhooks.
- Licensed market data and a brokerage partner; real customer brokerage accounts.
- A payment partner for real transfers; international corridors and FX quotes with fees.
- Production authentication, partner compliance, fraud operations.
- Trading UI and a stock-research workspace.

## Claims to avoid

- "Connected to TD/Chase/BofA" → say "simulated connectors modeled on how aggregators expose banks".
- "Prevents fraud" / "immune to prompt injection" → say "these specific scenarios are blocked by server rules, and here are the tests".
- "Trades autonomously" → say "paper trades autonomously only inside a mandate you grant and can revoke".
