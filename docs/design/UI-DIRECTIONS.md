# ClearFi UI directions — repository-grounded revision

October 10, 2026. Visual mockups only. No application code or financial behavior was changed, and no visual direction has been selected.

## Source of truth

Repository: `/Users/taruntt/Documents/GitHub/RuHackathon`.

Reviewed the repository instructions, README, package manifest, API contract, seeded account/recipient data, and existing overview, transfer, assistant, control, layout, and theme components. Inspected the running app's Hub and Transfers screens. The running server's working directory was verified as this repository. No transfer, verification, approval, execution, reset, or control changes were performed.

The earlier planning-document mockups in the HackRu project mirror are superseded for implementation by this repository-grounded set. The earlier example balances, recipients, and subscription names were concept fixtures, not this app's records.

## Actual product constraints

- Existing stack: Next.js 16, React 19, Tailwind 4, SQLite, and custom UI components. shadcn/ui and Lucide are not currently listed dependencies.
- Existing routes: Hub `/`, Transfers `/transfers`, Ask ClearFi `/chat`, Control `/control`.
- Existing design language: neutral zinc with a calm teal brand accent and light/dark styling.
- Alice Chen's seeded balances: Everyday Checking ••4410 $4,250.00; High-Yield Savings ••7702 $12,800.00; Individual Brokerage ••3091 $8,420.15. Total $25,470.15. Brokerage is view only and a demo import.
- Subscription evidence: StreamFlix increased from $15.49 to $22.99, a $7.50 monthly increase. Fixture dates derive from the seed date; render the transaction dates returned by the API rather than hard-coding mockup dates.
- Signature proposed scenario: $1,850 rent to Oak Street Properties, with Summit Community Bank ••4821 changed to Harborview Credit Union ••9930.
- Verification is a simulated out-of-band check with its own endpoint. Reevaluate a held proposal after verification; then approve the exact version and separately execute the simulator. The model cannot perform any of those privileged steps.
- The API has no transfer-cancellation endpoint. Use Close or Back to leave a review; do not introduce a Cancel action that implies a persisted cancellation state.
- Preserve visible synthetic-data and simulated-money labels, live/fallback assistant modes, receipts, policy evidence, and audit history.

At inspection, the transfer list was empty. Held-rent and savings-transfer rows in the images illustrate states reached during the demo journey; they were not created in the running database for this design task.

## Latest visual set

The three PNGs appear in this chat in the same order as the files below. Treat this set as replacing the earlier three concepts when the user selects a number.

1. `clearfi-repo-01.png`: light balance-led Hub with compact side navigation, account rows, contextual hold, subscription evidence, and recent activity.
2. `clearfi-repo-02.png`: dark transfer workspace retaining the current zinc/teal appearance, with master/detail navigation and the changed destination as the focal point.
3. `clearfi-repo-03.png`: light assistant workspace with account context, a clear answer, expandable evidence, and compact tool activity.

Built-in image generation was used. The real Hub and Transfers screenshots in `references/` were attached to each generation. Target composition was 1440 × 1024; image dimensions may differ. These are visual explorations, not tested responsive builds or proof of model/provider acceptance. The assistant image labels its content as an illustrative conversation.

## Design decisions

Make the product simpler through hierarchy and progressive disclosure:

- Put the current answer or transfer decision first.
- Use readable rows and separators for account balances and transactions.
- Keep recipient differences explicit: old institution/ending → new institution/ending.
- Show one main action appropriate to the current state. A held transfer cannot expose a normal approval/execute path.
- Keep policy checks, audit evidence, and tool traces available in expandable sections rather than filling the first view with implementation details.
- Retain the blocked-execution demonstration as a clearly labeled tertiary demo test.
- Preserve limits, pause, and exact-action approval behavior. Visual simplification is not removal of enforcement.
- Use consistent teal interaction styling, amber holds, tabular money figures, 14–16 px body text, restrained corners, and generous spacing.

## Library research and recommendation

Official pages were reviewed during this design request. These are candidates, not installed or tested integrations.

| Resource | Useful material | Recommendation for this repository |
|---|---|---|
| [shadcn/ui](https://ui.shadcn.com/) | Customizable components | Selectively adopt after visual selection if accessibility and interaction work warrants it; retain existing API/client logic |
| [shadcn Blocks](https://ui.shadcn.com/blocks) | `sidebar-07`, dashboard and login layouts | Use the sidebar as a structural reference; do not replace ClearFi with a stock analytics dashboard |
| [shadcn Sheet](https://ui.shadcn.com/docs/components/base/sheet) | Contextual review panels | Suitable if the selected direction uses a review drawer or mobile full-width review surface |
| [Lucide](https://lucide.dev/) | Consistent product icons | Optional single icon family to replace mixed text-symbol icons |
| [Mantine UI](https://ui.mantine.dev/) | Premade navigation, fields, tables and app components | Alternative foundation for a new app; switching this repository would add unnecessary migration work |
| [Radix Themes](https://www.radix-ui.com/themes/docs/overview/getting-started) | Cohesive themed components | Another alternative foundation, not an additional theme layer to mix into this app |
| [21st.dev](https://21st.dev/) | React component and template catalog | Use selectively for discovery; inspect candidate dependencies and terms before adoption |
| [TasteSkill](https://www.tasteskill.dev/docs) | Typography, spacing, hierarchy and design-system guidance | Apply its design discipline; it is not a component library |

Best fit: keep **Next.js + Tailwind + the existing ClearFi components**, then add **shadcn/ui and Lucide only where useful**. A complete component-library migration is unnecessary for these mockups. Current shadcn documentation offers multiple primitive variants; select one family consistently rather than assuming every component uses Radix.

## Likely implementation touchpoints after selection

| Surface | Existing files | Intended change |
|---|---|---|
| Theme and shell | `app/globals.css`, `app/layout.tsx`, `app/components/Header.tsx` | Spacing, typography, navigation and selected light/dark treatment |
| Shared UI | `app/components/Card.tsx`, `Button.tsx`, `Badge.tsx`, `AuditList.tsx` | Reduce visual clutter while retaining status, disabled/busy/error behavior |
| Hub | `app/page.tsx` | Account rows, focused attention section, clearer subscription evidence |
| Transfers | `app/transfers/TransfersClient.tsx`, `ActionList.tsx`, `ActionDetail.tsx`, `NewTransferForm.tsx` | Review hierarchy, bank-detail comparison and contextual actions |
| Assistant | `app/chat/ChatClient.tsx` | Answer-first composition, evidence and tool disclosures, preserve actual live/fallback labels |
| Control | `app/control/ControlClient.tsx` | Clear limits and pause controls, accessible audit evidence |

Do not change financial services, policy, approval hashing, session scoping, shared contracts, or fixtures for a purely visual implementation. Review local Next.js documentation before writing code as required by the repository instructions. Validate the selected UI in the browser, run typechecking and relevant tests, and separately report provider/integration limits.

## Prompt record

Common generation brief: realistic production-quality ClearFi desktop product UI; clean, simple, effortless; preserve zinc/teal identity, existing routes and disclosures; date October 10, 2026; actual seeded account balances, StreamFlix increase, landlord account-change scenario; no live banking/trading claims, autonomous approvals, invented cancellation action, confidence scores, or crowded feature inventory. Attach real Hub and Transfers screenshots.

Direction variations: light balance-led sidebar Hub; dark transfer master/detail review with explicit institution/ending comparison; light conversation-led assistant with evidence and persistent account context. Full generation prompts are retained in the chat tool calls.

Next step: choose a direction from the latest displayed set or request refinement before implementation.
