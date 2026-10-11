# Guidance for AI coding assistants (Claude, Codex, Gemini)

Onera is a hackathon finance demo whose whole pitch is that AI can't move money without enforced controls. Keep these invariants intact when you change code.

## Invariants — do not break

1. **Money is integer cents + `"USD"`.** Never use floats for amounts. Format only for display (`lib/finance/money.ts`).
2. **The user ID comes from the server session** (`getSessionUserId()` in routes, `ToolContext.userId` in AI tools). No route, service or tool may accept a user ID from a request body, query string or model input. Every SQL query on private tables filters on `user_id`.
3. **Records owned by another user are "not found" (404)**, never "forbidden".
4. **The assistant gets read tools plus two proposal tools only: `propose_transfer` and `propose_order`** (`lib/ai/tools.ts`). Proposals always wait for the user's exact-version approval. Each assistant agent (`lib/ai/agents.ts`) gets a subset of tools, enforced in `runTool`; only the Trade drafter has `propose_order`. Never add tools that approve, execute, verify recipients, change limits or pause/unpause. `tests/ai-boundary.test.ts` and `tests/ai-agents.test.ts` assert the exact tool lists; update them only with team agreement.
5. **All writes go through `lib/actions/service.ts` and `lib/actions/simulator.ts`.** Don't update `actions.state`, balances or approvals from routes, UI code or AI code.
6. **Approvals bind to an exact version.** Any material edit must bump `version` and clear `approval_hash`. The client never sends or receives the hash.
7. **Policy (`lib/policy/evaluate.ts`) is deterministic.** Model output must never feed into a policy decision.
8. **Synthetic and simulated labels stay visible** in the UI. Fallback chat answers must be labeled and must never create proposals or replay writes.
9. **Never commit secrets.** API keys live in `.env.local` (gitignored).

## Conventions

- Shared contract: `lib/types.ts`, `lib/db/modules.ts` and each module's `lib/<module>/index.ts`. HTTP contract: `docs/API.md`. Backend architecture: `docs/BACKEND_PLAN.md`.
- Feature modules (`lib/providers`, `lib/markets`, `lib/agents`) call each other only through their `index.ts`. They register tables via their own `db.ts`, never by editing `lib/db/schema.ts`.
- Delegating to subagents: follow `docs/agents/SUBAGENT_DELEGATION.md`.
- Services throw `ServiceError` (`lib/errors.ts`); routes wrap handlers with `handler()` from `lib/http.ts`.
- New state-changing logic needs a Vitest test in `tests/` (use `freshDb()` from `tests/helpers.ts`, an in-memory seeded database).
- UI code talks to the server only through `/api/*` fetches; never import `lib/db`, `lib/actions` or `lib/ai` into client components.
- Run `npm run typecheck` and `npm test` before pushing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
