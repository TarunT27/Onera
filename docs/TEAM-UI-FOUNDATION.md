# Person 1 — team UI checkpoint (2026-10-10)

## Foundation and collaboration

- Active branch: `codex/person1-team-ui`; latest main foundation: `f18a521`.
- Preserve the team's liquid-glass layout, blue accents, paper labels, monitoring UI and modified-click navigation fix. Do not reapply the earlier silver/obsidian stylesheet.
- Earlier work was backed up on `codex/obsidian-polish` at `02bbba2`; the team foundation plus additive interactions was pushed at `e643007`.
- Shared primary checkout and its untracked planning documents were left untouched. No main/teammate branch was pushed, and no backend, schema, policy, AI boundary or API contract was changed relative to this main foundation.

## Requested interactions retained or completed

- Click an account to open a dedicated full account workspace, not a small right-hand detail view. Native currency remains primary; dated demo USD equivalents sit underneath non-USD values.
- No hover/focus activity preview. Removed the now-redundant directory “All activity” button.
- Account-type filters and bank/account-name searches also scope transactions. Merchant/category search remains supported within the selected account type. Unit regression tests cover empty scopes and account isolation.
- Transactions use a capped, content-sized scroll area with hidden scrollbars, touch/wheel scrolling and keyboard focus. Start with 16 records and grow the existing read limit by 16 near the bottom (200px buffer). Short lists have no reserved blank height; loading further rows does not extend the page.
- This uses the existing prefix-limit API, not cursor pagination. The existing latest-100 range is retained. Explicit transaction searches read that bounded range; full-history pagination would require a Person 2 API change.
- Navigation glass becomes more opaque after page scroll; entry/tab animations are shorter. User menu opens downward and retains keyboard/outside-click dismissal. Shared select chevrons have inset spacing.
- A shared server-session snapshot prevents the overview greeting from briefly displaying “there.”
- Transfer wording is plain language. Receipt/version/reference information and successful safety-check details use progressive disclosure. Failed checks and exact server refusals remain visible; exact-version approval and duplicate protection are unchanged.
- Connection management remains centralized because one bank connection can cover several accounts. Per-account connection status already exists; a “Manage connection” link is a recommendation, not an implemented change in this checkpoint.

## Tab-speed improvement and safety

- Display-only reads reuse memory snapshots for at most 30 seconds (64 entries), then always refresh from the server. Concurrent identical reads are deduplicated; errors are not cached.
- Cache identity comes only from `/api/session`. Session changes, reset and window focus clear private snapshots/views. Every POST/PATCH invalidates reads before and after completion, including refusals; old in-flight results cannot repopulate an invalidated generation.
- Actions, controls, recipients, approvals and audit are not snapshot-cached. Writes are never cached/deduplicated; HTTP fetches still use `no-store`. Financial authorization remains live and server-owned. No persistent browser storage of private snapshots was added.
- Local development can still compile a route on its first visit; Next Link's automatic prefetch operates in production. No latency percentage or production-speed benchmark is claimed.

## Verification

- `npm run typecheck`, `npm test` (216 tests / 24 files) and `npm run build` passed; `git diff --check` passed.
- Live browser checks at 1440×900 and 390×844: no horizontal overflow, Bob greeting on revisits, downward menu, dedicated GBP account view, small USD equivalent, inset transfer chevrons, scroll opacity, short paper-account activity without reserved space, and hidden-scrollbar keyboard scrolling.
- Checking filter showed only `acct_bob_boa_checking` and `acct_bob_checking` transaction IDs. Bank-of-America search showed only that connection's account IDs. Buffered loading increased visible filtered rows from 17 to 24 while page height remained 1366px; unfiltered loading from 16 to 32 also kept page height unchanged.
- New tests cover expiry, scope separation, memory bounds, read deduplication, session clearing, stale in-flight protection, uncached governance reads/writes and invalidation after refused writes.
- E2E source expectations were updated, but the full Playwright suite and real Safari/screen-reader testing were not run. No live transfer or approval was made for this browser QA; receipt wording was type/build-checked, not exercised against a newly completed browser transfer.
- Preview: `http://localhost:3100`, isolated synthetic DB, fallback AI only. No external model calls or subagents used for this checkpoint.
