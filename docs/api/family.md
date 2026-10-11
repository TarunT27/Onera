# Family cards API

Secondary cards for kids on a parent's credit card. The parent (the signed-in demo user) sees each kid's spending, sets limits and blocked categories, and can freeze a card. **Only the parent's session can change settings** — no assistant tool or monitoring agent can. All purchases are simulated.

Seed: Alice's **Family Rewards Card ••2207** (Onera Demo Bank) has two secondary cards — **Maya (16) ••3318**, $350/month, $75 per purchase; **Leo (12) ••6642**, $150/month, $40 per purchase, gaming blocked. Bob has none.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/family` | – | `{ cards: FamilyCard[], categories, asOf }` |
| GET | `/api/family/cards/:id` | – | `{ card: FamilyCard }` |
| PATCH | `/api/family/cards/:id` | `{ monthlyLimitCents?, perPurchaseLimitCents?, blockedCategories?, status?: "active" \| "frozen", alertThresholdPct? }` (unknown fields rejected) | `{ card }` |
| POST | `/api/family/cards/:id/simulate` | `{ merchant, category, amountCents }` | `{ charge, card }` — a decline is a normal 200 outcome |

Another user's card → `404 NOT_FOUND`. Invalid input → `400 BAD_REQUEST`.

**Purchase rules** (`lib/family/policy.ts`, deterministic, first match wins): `CARD_FROZEN` → `CATEGORY_BLOCKED` → `OVER_PURCHASE_LIMIT` → `OVER_MONTHLY_LIMIT`. Approved charges post a transaction to the parent card and increase what's owed; declined charges move nothing.

**Alerts** on each card: frozen, ≥ alert threshold (default 80%) of the monthly limit, limit reached, and declined purchases this month.

**Audit events:** `family.card_updated`, `family.card_frozen`, `family.card_unfrozen`, `family.charge_approved`, `family.charge_declined`.

Categories: dining, groceries, shopping, entertainment, gaming, subscriptions, transport, education.
