# Onera implementation QA

October 10, 2026

final result: passed

## Findings

No actionable P0/P1/P2 findings remain in the reviewed implementation. This is acceptance of the implemented demo scope, not production banking certification.

- **P3 — Decorative texture variation.** The generated azure wave is more luminous and textured than the reference. It preserves the selected art direction, crop and readable dark text area. Optional future refinement: soften the highlight in the source asset, retaining the existing card dimensions.
- **P3 — Final identity (resolved).** The project is now Onera. The header, favicon and Apple touch icon use the supplied Onera logo (`public/brand/`, `app/icon.png`, `app/apple-icon.png`).

## Comparison evidence

- Source visual truth: `/Users/taruntt/.codex/generated_images/01a126fd-9deb-74e2-b451-5a56bd17da31/exec-18397e82-af38-438f-9ec6-fc154317b149.png`.
- Latest browser capture: `/Users/taruntt/.codex/visualizations/2026/10/10/01a126fd-9deb-74e2-b451-5a56bd17da31/clearfi-overview.png`.
- Mobile capture: `/Users/taruntt/.codex/visualizations/2026/10/10/01a126fd-9deb-74e2-b451-5a56bd17da31/clearfi-mobile.png`.
- Additional saved evidence in the same folder: `clearfi-bank-picker.png` and `clearfi-transfers.png`.
- Source and desktop implementation are both 1487 × 1058 pixels. Browser CSS viewport: 1487 × 1058, deviceScaleFactor: 1. Neither has browser chrome or a device frame. No density scaling was needed. Mobile: 390 × 844 CSS pixels and image pixels, density 1.
- Route/state: `/`, dark theme, Alice, demo data, a real API-created held $1,850 rent proposal. The reference uses an illustrative $25,470.15 total; the implementation derives its changing total from expanded bank data, currency equivalents, cash and simulated holdings. It does not hard-code screenshot balances.
- The source and latest implementation were opened together in one comparison input after the final fixes. Navigation, dominant balance surface, accounts, full-width hold banner and two lower panels were compared. Source and implementation have matching major grid proportions, dark surfaces and action hierarchy.
- Separate focused crops were unnecessary: at the displayed full-size evidence, account labels, amounts, review evidence and controls were readable. These regions were explicitly inspected. Mobile evidence verifies responsive adaptation; the selected source itself contains no mobile design.

## Required fidelity surfaces

| Surface | Assessment |
| --- | --- |
| Fonts and typography | System sans-serif preserves the Apple-like direction, with light oversized balance numerals, medium headings and subdued secondary copy. Weight, line height, tracking, wrapping and small text were reviewed. Exact font identity cannot be established from the raster; this is an intentional system-font implementation. |
| Spacing and layout rhythm | Desktop sidebar and main grid align closely with the source. Card padding, rounded corners, section gaps and row dividers remain consistent. Mobile stacks content with persistent bottom navigation; no horizontal overflow at 320, 390 or 820 CSS pixels in inspected routes. |
| Colors and tokens | Onyx/charcoal surfaces, paper-white foregrounds and supplied azure palette are retained. Amber identifies held transfers with explicit text. Focus, active and disabled states remain distinguishable. |
| Image quality | A generated raster azure asset supplies the main decorative artwork and sidebar treatment, with no visible compression or masking artifacts. Standard Phosphor icons serve controls. The disliked logo was intentionally removed rather than approximated. Merchant brand marks are replaced with neutral category icons. |
| Copy and content | Live demo amounts, mixed-currency labels, source capabilities and real review state supersede illustrative source values. “Previously verified” and “Requested” accurately explain changed recipient details. “Hello, Alice” is a shorter greeting. An Accounts navigation item was added for the user's priority workflow. |

## Comparison and correction history

1. **P2 — Brokerage value understated.** The first overview treated brokerage cash as total account value. Changed it to cash plus holdings from the portfolio API. Loading/error states now show Loading/Unavailable instead of misleading cash-only values. Latest desktop evidence shows the combined value.
2. **P2 — Review evidence ambiguity.** Replaced bank From/To labels with Previously verified/Requested. A later state review found unrelated changed-recipient evidence could appear beside a savings transfer. Evidence is now scoped to the pending proposal's recipient; a browser regression assertion covers this case. Latest rent capture shows the relevant matching recipient evidence.
3. **P2 — Dense audit presentation and tablet layout.** Audit records now use readable event names, expandable details and transfer links. Table layout switches at the larger breakpoint. Subsequent 320px and 820px captures confirmed no horizontal overflow; review details remain accessible.
4. **Post-fix comparison.** Recaptured the desktop overview and mobile page after the final changes, opened them alongside the source, and rechecked all five fidelity surfaces. Remaining differences above are expected product adaptations or P3 polish. Build and test execution are separate verification evidence, not substitutes for this visual comparison.

## Functional verification

- Typecheck passed; final production build passed.
- 118 backend tests across 13 files passed, including 8 added provider tests.
- 16 Playwright scenarios passed across desktop and mobile Chromium projects. Coverage includes five-page navigation, account filters/search, currency and holdings, activity pagination, bank link/sync/reconnect/disconnect/relink, held-transfer verification and execution, duplicate receipts, approval invalidation, pause/limits, assistant fallback, user isolation, API failures and reduced motion.
- Manual browser inspection found no page errors or console errors on initial loads of all five pages. Expected negative-test HTTP errors and missing-key assistant fallback are intentional test states.
- Original database and Claude worktrees were preserved. Browser tests use isolated temporary databases. The displayed preview has a held proposal; no transfer was executed in its database.
- Delegated provider verification completed. The separate Astra reviewer could not run because of its usage limit; the primary agent performed the final code and UI cross-check. No independent review pass is claimed.

## Open questions and limits

Live AI credentials/provider acceptance, real bank connectivity, native Safari/iOS, production authentication and public deployment were not verified. Banking remains explicitly simulated. Recovered market and agent APIs have backend coverage; this scope does not add a trading workspace or continuously running agent worker. Existing version-2 databases are not silently reseeded; see `docs/UI-IMPLEMENTATION.md`.

## Implementation checklist

- [x] Implement selected desktop composition and responsive navigation.
- [x] Connect account/bank and transfer workflows to recovered services.
- [x] Resolve identified P2 issues and capture post-fix evidence.
- [x] Pass backend, browser, type and production-build checks.
- [x] Leave local preview running at http://localhost:3100.
- [ ] Optional follow-up: refine the logo with the user's additional references.

## Person 1 refinement QA — silver / black / blue

October 10, 2026. This section records a separate bounded polish pass on `codex/obsidian-polish`; the original team's evidence above is preserved, not claimed as rerun evidence.

final result: passed

No actionable P0/P1/P2 findings remain in the inspected default-state refinement. This is scoped visual/interaction acceptance, not a full accessibility or banking certification.

### Findings and corrections

1. **P2 — Review priority on mobile.** The original review strip followed the balance and account list. Moved it before both in the DOM; the 360px comparison now shows the bank-change review action before the balance. Recipient matching and proposal handlers are unchanged.
2. **P2 — Title-only balance explanation.** Replaced hover-only `title` content with a native disclosure, a descriptive accessible label and a 44px target. Touch opening and Enter-key closure were verified, with readable synthetic/USD/paper-account explanation.
3. **Palette correction.** Removed the initial refinement's champagne accents at the user's direction. Final navigation, focus, utility labels and overview review banner use silver/icy blue on black. Existing semantic held/error/success colors remain in financial state components, with explicit labels.
4. **Final comparison.** Recaptured the desktop, mobile and loaded neutral Transfers page after this correction. Opened source and implementation together in combined images and inspected all five fidelity surfaces. Build checks are additional evidence, not a substitute for this comparison.

### Comparison evidence

Source is the selected, running Obsidian Flow implementation before this pass, not a new concept image. Left is baseline; right is refinement.

- [Desktop overview comparison](docs/design/obsidian-polish/overview-comparison.png): matching 1280 × 720 CSS/image-pixel captures, density 1, Alice, synthetic demo data, changed landlord details, disclosure closed.
- [Mobile overview comparison](docs/design/obsidian-polish/mobile-comparison.png): matching first 800px of 360px-wide full-page captures, density 1, same route and review state. Full-page originals remain in the local QA artifacts.
- [Transfer form comparison](docs/design/obsidian-polish/form-comparison.png): matching 500 × 680 crops at (280, 200) from 1440 × 900 CSS/image-pixel captures, density 1. Loaded source account; recipient unselected; amount/memo empty; no proposal created.

The local originals and additional page captures are under `/Users/mani/.codex/visualizations/2026/10/10/01a126e0-29be-7052-8568-91f2fda193a5/`. Final comparison inputs use `obsidian-flow-preview.png`, `obsidian-before-mobile.png`, `obsidian-before-transfers.png` and the corresponding final `obsidian-after-desktop/mobile/transfers.png`. An early wrongly sized desktop capture was rejected. Other exploratory after-captures are not the final palette evidence. Balances differ slightly due to synthetic quote refresh; no amount was hard-coded for screenshot fidelity.

| Fidelity surface | Assessment |
| --- | --- |
| Fonts and typography | Existing system sans-serif retained; balance numerals reduced deliberately for a clearer hierarchy. Greeting, secondary labels, wrapping and form labels inspected. |
| Spacing and layout | Original sidebar/grid vocabulary retained; review moved upfront, panel spacing tightened, mobile hero CTAs aligned side by side. Native disclosure remains above the decorative hero artwork. |
| Colors and tokens | Black/charcoal, silver foregrounds and azure image preserved. No gold brand highlights remain. Silver/blue edge, active and focus tokens extend the existing system. |
| Image quality | Existing azure raster and Phosphor icons reused. No replacement artwork, compression or new CSS illustration. |
| Copy and content | Existing API-derived amounts and synthetic/simulated labels retained. New Controls link and balance disclosure explain the existing boundaries; neither changes financial behavior. |

### Checks and limits for this pass

After a non-overlapping fast-forward to main at `3fa9e40`, typecheck and 144 tests across 17 files passed; production build passed with the final silver/blue palette. Manual five-page navigation, Accounts search/clear and touch/keyboard disclosure interaction passed. Overview overflow/order checks passed at 320, 360, 768, 1440 and 1920 CSS px; sampled interactive targets were at least 44px. No console errors/warnings were observed at the end of inspection. No financial write or paid AI request was made.

Not rerun: the original 16-case browser suite. Not verified: native Safari/iOS, 200% browser zoom, actual OS contrast/transparency preferences, complete screen-reader audit, live AI, production auth or deployment. CSS fallbacks exist but are not claimed as OS-tested. Login/register UI and the deferred circling-text reference are outside this checkpoint. See `docs/UI-POLISH.md` for implementation boundaries.
