# ClearFi Azure implementation

October 10, 2026. Selected direction: Obsidian Flow.

## What works

- Responsive dark/azure shell and Overview, Accounts, Transfers, Assistant and Controls pages.
- API-backed overview, account details, currency-aware amounts, cash plus brokerage holdings, subscription evidence and recent activity.
- Five simulated bank profiles: TD Bank, Bank of America, JPMorgan Chase, Barclays UK and RBC Royal Bank. Link, cursor sync, error recovery, reconnect, disconnect and relink are wired to server services.
- Search and account-type filters, paged activity disclosure, transaction details and preselected transfer source.
- Changed-recipient holds, explicit verification, reevaluation, exact-version approval, simulated execution, receipt and duplicate protection.
- Pause/resume, transfer limits, readable audit events with expandable details, user switch and labeled assistant fallback.
- Wordmark only while the logo is revisited. Phosphor icons and a generated azure background provide the visual assets.

## Recovered backend work

The main checkout contained placeholder modules. Module-owned sources, routes and tests were recovered from the three existing `.claude/worktrees/` directories. Original worktrees were preserved. Providers, markets and agents now compile together. Provider HTTP routes and browser screens were added here; agent test fixtures were reconciled with the completed portfolio contract and the missing permission matrix was generated.

The imported paper-order/mandate and background-agent APIs have backend test coverage, but there is no new trading workspace or continuously running agent worker in this UI scope. No privileged assistant tools were added.

## Run the demonstrated version

From the repository root:

```sh
CLEARFI_DB_PATH=/tmp/clearfi-azure-preview.db CLEARFI_NEXT_DIR=.next-azure ANTHROPIC_API_KEY= npm run dev -- --port 3100
```

Open http://localhost:3100. The demonstrated instance is still running. An illustrative held rent proposal was created through its UI for the final screenshot; no transfer was executed in that preview database.

This explicitly separate database preserves the existing `data/clearfi.db`. A new file seeds all recovered modules and their expanded mock data. Existing schema-version-2 databases receive tables but are not silently reseeded: they can link banks manually, or the owner can deliberately use Reset demo to replace their synthetic data. Imported holding seeds are available in fresh/reset databases. Do not bump the schema version merely to force a destructive reset.

The blank key above deliberately tests assistant fallback without paid model calls. Remove that environment override to use an independently configured server-side key. Live model/provider access was not verified, and no credentials were read or changed.

## Repeat QA

```sh
npm run typecheck
npm test
npm run test:e2e
CLEARFI_NEXT_DIR=.next-build npm run build
```

On a new machine, install test Chromium with `npx playwright install chromium` first. Playwright uses port 3101, `.next-e2e`, a new temporary SQLite database per run, one worker, and desktop/mobile Chromium projects. It refuses to reuse an existing server. It never resets the ordinary local database. Failure screenshots/traces go to the OS temporary `clearfi-playwright-results` directory.

Acceptance evidence: 118 Vitest tests; 16 Playwright scenarios; production build and typecheck. See `../design-qa.md` for visual comparisons, fixes, screenshot paths and limits. Browser scenarios cover navigation, evidence, account search, holdings, activity pagination, bank lifecycle, verification/approval/execution, duplicate receipts, approval invalidation, limits/pause, fallback chat, user isolation, failures and reduced motion.

The automated browser suite uses Chromium, including an emulated mobile viewport; it does not certify native Safari/iOS. Manual Playwright captures additionally inspected 320px and 820px layouts. Real banking, live AI acceptance, native mobile, public authentication, deployments and production operations remain outside this verification.
