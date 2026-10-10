# ClearFi — Feature Brainstorm and Backend Plan

Status: planning document. Proposed features below are not implemented.

ClearFi helps users understand their money, review AI proposals, and enforce financial controls. All accounts are synthetic and all money movement is simulated in the hackathon demo.

## Existing features

This inventory is based on the current code and README. Tests were not rerun to prepare this document.

| Feature | Existing backend work |
|---|---|
| Account dashboard | SQLite-backed synthetic accounts, balances, account capabilities, update timestamps, and scoped account APIs. |
| Transaction history | User-scoped transaction queries, account/date filtering, and separate identification of internal transfers. |
| Spending insights | Deterministic monthly comparisons and category totals; internal transfers excluded from spending. |
| Subscription increases | Monthly-pattern detection, previous/current charge comparisons, and evidence transaction IDs. |
| AI assistant | Claude integration, bounded tool loop, scoped reads, research retrieval, and transfer proposals. |
| Fallback chat | Clearly labeled deterministic responses; fallback cannot create proposals or replay writes. |
| Transfer proposals and edits | Central action service, validation, action lifecycle, version increments, and approval invalidation. |
| Recipient protection | Verification versions, previous destination details, and holds for changed or unverified recipients. |
| Transfer controls | Deterministic balance, per-transfer limit, daily limit, recipient, and pause checks. |
| Exact-action approval | Server-side approval hash binding authorization to the specific action and recipient version. |
| Simulated execution | Atomic balance changes, policy rechecks, duplicate-execution protection, and persistent simulated receipts. |
| Audit history and AI trace | Records of tool calls, control changes, approvals, and execution events. |
| Research and injection demonstration | Untrusted research fixtures; the assistant has no approval or execution tools. |
| Demo identities and reset | Server-side demo identity selection and seeded database reset; not production authentication. |
| Boundary tests | Ownership, approvals, transfer controls, duplicate execution, insights, and AI permission tests. |

## 1. Scam and unsafe-transaction simulator

Users choose a seeded scenario and watch ClearFi explain the actual server result.

### Scenarios

- A fake landlord sends changed bank details.
- An unverified recipient requests an urgent payment.
- A transfer amount changes after approval.
- A payment is submitted twice.
- Several transfers attempt to exceed the daily limit.
- A research article instructs the assistant to bypass approval.

### Backend work

- Add deterministic scenario fixtures and scenario loading/reset APIs.
- Define expected outcomes and structured explanations.
- Run scenarios through the existing action service, policy engine, and simulator.
- Preserve user scoping and isolate scenario resets from other demo users.
- Record outcomes in the audit history.
- Add integration tests confirming actual holds, stale approvals, and duplicate protection.

Changed destination details are a risk signal, not proof of fraud. Describe the demo as catching suspicious changes and enforcing controls, not general-purpose scam detection. Duplicate payments and excessive transfers are operational protections.

## 2. Upcoming bills calendar and affordability preview

The calendar estimates upcoming recurring expenses. Before a transfer, the preview shows whether the remaining balance can cover them.

Example:

> This transfer would leave $900 in checking. Your history suggests approximately $1,850 in rent is due in five days. Keep the money available or continue?

### Backend work

- Extend recurring-payment detection to rent, utilities, insurance, and other bills.
- Estimate next payment dates and amounts with supporting transaction IDs and uncertainty.
- Allow users to correct estimated bills and dates through a scoped service.
- Calculate projected balances using integer cents and a defined forecast window.
- Avoid counting bills already paid twice; distinguish pending and posted transactions.
- Return structured warnings through a preview API.
- Add cancellation of unexecuted proposals through the action service, including a `CANCELED` state and audit event.
- Recheck relevant conditions before execution.
- Test recurring detection, paid-bill matching, forecasts, cancellation, ownership, and stale previews.

Estimates must remain visible as estimates. Cancellation applies to an unexecuted ClearFi proposal; it cannot cancel an outside purchase or undo an executed transfer. An advisory warning can be acknowledged, but a failed hard policy check cannot be bypassed.

## 3. Minimum-balance and maintenance-fee warning

Warn when a proposed transfer drops an account below its configured balance threshold.

Example:

> This transfer leaves $350, below your configured $500 threshold. A maintenance fee may apply. Continue or cancel?

### Backend work

- Store account-specific thresholds and fee-rule metadata, including the rule's source.
- Calculate the projected post-transfer balance.
- Return a structured warning rather than a guaranteed fee prediction.
- Record acknowledgment against the exact proposal version.
- Invalidate acknowledgment after material changes and recheck before execution.
- Audit acknowledgment and resulting execution.
- Test threshold boundaries, changed balances, proposal edits, and concurrent transfers.

For the demo, use synthetic fee rules. Actual fee waivers may depend on average daily balances, deposits, or other conditions.

An optional enforced cash reserve is a separate hard control. If enabled, transfers below that reserve are held; acknowledgment cannot override the rule.

## 4. Savings goals and small-step planning

Users define a goal and receive a contribution plan that accounts for estimated bills and available funds.

Example:

> Save $1,200 for a laptop over 12 weeks. The target is $100 per week; estimated bills suggest $60 per week may be more manageable.

### Backend work

- Store goals, target amounts, deadlines, and linked savings accounts.
- Calculate contribution schedules using integer cents, distributing rounding remainders explicitly.
- Compare schedules with estimated disposable funds.
- Track contributions without counting one account balance toward multiple goals twice.
- Recalculate plans when balances, deadlines, or goals change.
- Route an explicitly requested contribution through the normal transfer proposal flow.
- Test goal ownership, contribution allocation, rounding, infeasible deadlines, and approval boundaries.

Planning never moves money automatically. The assistant's tool list remains unchanged unless the team explicitly agrees to modify it.

## 5. Bank security incident alerts

Notify users when a trusted source reports a relevant incident involving an institution associated with their accounts.

Example:

> Your institution published a security notice. View the official notice and recommended steps.

### Backend work

- Maintain institution identifiers and trusted source mappings.
- Begin with curated, visibly labeled demo incidents; live ingestion is a later enhancement.
- Store source links, publication dates, reported scope, affected services, and verification status.
- Match incidents to relevant institutions without exposing another user's account information.
- Deduplicate alerts and track read/dismissed status.
- Add an in-app notification feed.
- For live ingestion, add scheduled jobs, bounded retries, freshness tracking, and failure records.
- Test institution matching, duplicate suppression, source attribution, and ownership.

A bank incident does not establish that an individual account was compromised. Alerts must communicate reported scope and source. They must not redirect users to a “safe account” or automatically propose moving funds.

## 6. Parental controls and child profiles

Parents can add synthetic child profiles, view activity for accounts they are authorized to supervise, and configure enforced limits.

Example:

> Alex has used $30 of a $50 weekly transfer allowance. A new $25 transfer is held because it would exceed the limit.

### User-facing features

- Add and manage child profiles in the demo household.
- View each child's assigned synthetic accounts, transfer activity, remaining allowance, and held proposals.
- Set per-transfer, daily, and weekly limits, plus an optional minimum reserve.
- Receive in-app alerts for held transfers and limit changes.
- Pause transfers for a supervised account.
- Let children see their own activity and applicable limits.
- Optionally require an additional parent approval for selected transfers, while retaining exact-action approval requirements.

### Backend work

- Add household, child-profile, supervision-grant, and child-control records.
- Model demo parent/child roles in the server session; do not treat the demo switcher as production authentication.
- Keep synthetic child accounts owned by the signed-in demo parent for the initial parent dashboard, preserving the existing `user_id` query invariant.
- Scope every profile and account lookup to the session owner. Never use a request-provided user ID as authority.
- Treat separate child logins as a later architecture change: introduce explicit server-validated supervision grants and review the current ownership invariant with the team before enabling cross-user reads.
- Calculate executed daily/weekly transfer totals with defined time-zone boundaries.
- Apply child controls deterministically alongside existing policy checks. Recheck and update aggregates atomically during execution.
- Add service methods for profile creation, limit changes, pause, and notification state; keep writes out of routes and AI tools.
- If parent co-approval is added, store each approval's role and exact action version. Material edits invalidate all relevant approvals.
- Log supervision changes, control changes, approvals, and held attempts.
- Test household isolation, unauthorized access, aggregate limits, concurrent transfers, pause, and approval invalidation.

### Scope and control rules

- Limits govern ClearFi's simulated transfers, not purchases made outside the app.
- Children cannot increase their own limits, grant supervision, or clear enforced holds.
- Parent approval cannot bypass recipient verification, insufficient funds, or other hard controls.
- The assistant cannot change parental limits, approve transfers, or execute money movement.
- Production child accounts require a separate identity, consent, privacy, and provider design; this plan only covers the synthetic demo.

## Shared backend requirements

- Database migrations and synthetic seed data for new records.
- Matching shared contracts in `lib/types.ts` and HTTP contracts in `docs/API.md`.
- Server-session identity, user-scoped queries, and 404 responses for inaccessible records.
- Centralized service writes, with action state, balances, and approvals controlled by `lib/actions/service.ts` and `lib/actions/simulator.ts`.
- Deterministic financial calculations and policy decisions; model output cannot determine authorization.
- Exact-version approvals and acknowledgments, with execution-time rechecks.
- Structured `ServiceError` errors and routes wrapped with `handler()`.
- Client components access backend data only through `/api/*`.
- Audit events and Vitest coverage for new state-changing behavior using `freshDb()`.
- Visible synthetic, simulated, estimated, and fallback labels.
- No secrets in Git; provider credentials remain server-side.
- Run typecheck and tests before pushing implementation changes.

## Suggested build order

1. Scam and unsafe-transaction simulator: demonstrate existing enforced controls.
2. Upcoming bills and affordability preview: add everyday usefulness.
3. Minimum-balance warning: reuse the preview and acknowledgment flow.
4. Savings goals: reuse forecasts and normal transfer proposals.
5. Parental controls: start with parent-owned synthetic child profiles, then enforced limits.
6. Curated bank incident alerts: add the notification feed before considering live ingestion.

## Longer-term features already described in the roadmap

These remain future work, not implemented MVP capabilities:

- Multi-bank account aggregation and provider sync.
- Investment holdings, watchlists, market data, and cited investment research.
- Paper trading and supported brokerage integrations.
- Background monitoring workers and durable scheduled jobs.
- Bounded automation mandates.
- International account visibility, FX, and supported transfer corridors.
- Production identity, onboarding, provider reconciliation, and deployment operations.

See `docs/ROADMAP.md` for the broader product direction. This brainstorm does not authorize expanding the assistant's permissions or adding live money movement.
