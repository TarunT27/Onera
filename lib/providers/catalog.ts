/**
 * Simulated institution catalog. Every institution here is a SIMULATED profile
 * that imitates the shape of a real bank's data. There is no affiliation with
 * the named brands, no real connection and no credentials. All merchants,
 * employers and amounts are fictional.
 *
 * Amounts are integer minor units of the institution's currency (cents, pence).
 */
import type { AccountType, UserId } from "@/lib/types";
import type { Institution } from "./types";

export const disclaimerFor = (brand: string) =>
  `Simulated connector. Not affiliated with ${brand}; no real connection or credentials.`;

function institution(i: Omit<Institution, "simulated" | "disclaimer">): Institution {
  return { ...i, simulated: true, disclaimer: disclaimerFor(i.brand) };
}

// ---------------------------------------------------------------------------
// Profile model
// ---------------------------------------------------------------------------

export interface AccountTemplate {
  /** Stable key within the institution, used in IDs. */
  key: string;
  name: string;
  type: AccountType;
  /** Deposit accounts: balance at the start of the synced history (scaled per user). */
  openingCents?: number;
  /** Credit cards: credit limit. Card opening balances are derived from the statement cycle. */
  creditLimitCents?: number;
}

export type Schedule =
  /** Roughly every N days; each occurrence lands 0..jitter days after its nominal day. */
  | { kind: "every"; days: number; jitter: number }
  /** Same day each month (1..28). */
  | { kind: "monthly"; day: number };

/**
 * Fixed amounts never change (subscriptions keep STABLE prices). Variable
 * amounts are scaled per user; outflows encode the occurrence parity in the
 * last cent so consecutive charges always differ — together with fixed
 * subscription prices this guarantees the generator never fabricates a
 * "subscription price increase".
 */
export type AmountSpec = { fixed: number } | { base: number; spread: number };

export interface TxStream {
  kind: "tx";
  id: string;
  account: string;
  description: string;
  merchant: string | null;
  category: string;
  direction: "in" | "out";
  schedule: Schedule;
  amount: AmountSpec;
  /** posted: appears posted. pending_post: appears pending, posts 24–48h later. */
  lifecycle: "posted" | "pending_post";
  /** Restaurant tip added when the pending charge posts (pending amount excludes it). */
  tipPct?: number;
  /** Fuel-style authorization hold: a pending hold that is later removed. */
  hold?: { chance: number; amountCents: number; description: string };
}

export interface TransferStream {
  kind: "transfer";
  id: string;
  from: string;
  to: string;
  schedule: Schedule;
  amountCents: number;
  /** "{toMask}" / "{fromMask}" are replaced with the account masks. */
  outDescription: string;
  inDescription: string;
}

/** Monthly autopay of the previous statement cycle, from a checking account at the same institution. */
export interface CardPaymentStream {
  kind: "card_payment";
  id: string;
  card: string;
  payer: string;
  day: number;
}

export type Stream = TxStream | TransferStream | CardPaymentStream;

export interface InstitutionProfile {
  institution: Institution;
  accounts: AccountTemplate[];
  streams: Stream[];
}

/** Per-user world overrides: which accounts a user holds and cross-institution autopay. */
export interface WorldOverride {
  /** Subset of template keys this user holds at the institution. Default: all. */
  accounts?: string[];
  /** A card at this institution autopaid from another institution's account. */
  cardPayer?: { card: string; institutionId: string; account: string; day: number; lagDays: number };
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

const every = (days: number, jitter: number): Schedule => ({ kind: "every", days, jitter });
const monthly = (day: number): Schedule => ({ kind: "monthly", day });

const TD: InstitutionProfile = {
  institution: institution({
    id: "ins_td",
    name: "TD Bank (simulated)",
    brand: "TD Bank",
    country: "US",
    currency: "USD",
    kind: "bank",
    products: ["checking", "savings", "credit"],
    supportsTransfers: true,
  }),
  accounts: [
    { key: "checking", name: "Checking", type: "checking", openingCents: 980_000 },
    { key: "savings", name: "Savings", type: "savings", openingCents: 6_200_000 },
    { key: "card", name: "Cash Back Credit Card", type: "credit", creditLimitCents: 500_000 },
  ],
  streams: [
    { kind: "tx", id: "pay", account: "checking", description: "RIVERSIDE TUTORING CO DIR DEP",
      merchant: "Riverside Tutoring Co.", category: "income", direction: "in", schedule: every(14, 0),
      amount: { base: 72_000, spread: 0 }, lifecycle: "posted" },
    { kind: "tx", id: "water", account: "checking", description: "HARBOR WATER & SEWER AUTOPAY",
      merchant: "Harbor Water & Sewer", category: "utilities", direction: "out", schedule: monthly(8),
      amount: { base: 4_200, spread: 1_600 }, lifecycle: "posted" },
    { kind: "tx", id: "mobile", account: "checking", description: "LUMEN MOBILE WIRELESS",
      merchant: "Lumen Mobile", category: "utilities", direction: "out", schedule: monthly(18),
      amount: { fixed: 6_500 }, lifecycle: "posted" },
    { kind: "tx", id: "grocery", account: "checking", description: "CORNER MARKET #212",
      merchant: "Corner Market", category: "groceries", direction: "out", schedule: every(9, 2),
      amount: { base: 3_200, spread: 2_800 }, lifecycle: "pending_post" },
    { kind: "transfer", id: "save", from: "checking", to: "savings", schedule: monthly(3), amountCents: 20_000,
      outDescription: "Transfer to TD Savings ••{toMask}", inDescription: "Transfer from TD Checking ••{fromMask}" },
    { kind: "card_payment", id: "cardpay", card: "card", payer: "checking", day: 25 },
    { kind: "tx", id: "interest", account: "savings", description: "INTEREST PAID", merchant: null,
      category: "interest", direction: "in", schedule: monthly(28), amount: { base: 520, spread: 60 },
      lifecycle: "posted" },
    { kind: "tx", id: "fuel", account: "card", description: "QUICKFUEL #4471", merchant: "QuickFuel",
      category: "gas", direction: "out", schedule: every(8, 3), amount: { base: 3_600, spread: 2_200 },
      lifecycle: "pending_post",
      hold: { chance: 0.5, amountCents: 7_500, description: "QUICKFUEL #4471 PRE-AUTHORIZATION HOLD" } },
    { kind: "tx", id: "coffee", account: "card", description: "DAILY GRIND COFFEE", merchant: "Daily Grind Coffee",
      category: "dining", direction: "out", schedule: every(4, 2), amount: { base: 480, spread: 420 },
      lifecycle: "pending_post" },
    { kind: "tx", id: "music", account: "card", description: "TUNESTREAM PREMIUM", merchant: "TuneStream",
      category: "subscriptions", direction: "out", schedule: monthly(12), amount: { fixed: 1_099 },
      lifecycle: "posted" },
    { kind: "tx", id: "pharmacy", account: "card", description: "NORTHSIDE PHARMACY", merchant: "Northside Pharmacy",
      category: "health", direction: "out", schedule: every(16, 4), amount: { base: 1_400, spread: 2_200 },
      lifecycle: "pending_post" },
  ],
};

const BOA: InstitutionProfile = {
  institution: institution({
    id: "ins_boa",
    name: "Bank of America (simulated)",
    brand: "Bank of America",
    country: "US",
    currency: "USD",
    kind: "bank",
    products: ["checking", "savings", "credit"],
    supportsTransfers: true,
  }),
  accounts: [
    { key: "checking", name: "Checking", type: "checking", openingCents: 165_000 },
    { key: "savings", name: "Savings", type: "savings", openingCents: 420_000 },
    { key: "card", name: "Rewards Credit Card", type: "credit", creditLimitCents: 400_000 },
  ],
  streams: [
    { kind: "tx", id: "pay", account: "checking", description: "HARBOR LOGISTICS DIR DEP",
      merchant: "Harbor Logistics", category: "income", direction: "in", schedule: every(14, 0),
      amount: { base: 46_000, spread: 0 }, lifecycle: "posted" },
    { kind: "tx", id: "power", account: "checking", description: "CITYWIDE GAS & ELECTRIC",
      merchant: "Citywide Gas & Electric", category: "utilities", direction: "out", schedule: monthly(10),
      amount: { base: 6_800, spread: 3_000 }, lifecycle: "posted" },
    { kind: "tx", id: "mobile", account: "checking", description: "LUMEN MOBILE WIRELESS",
      merchant: "Lumen Mobile", category: "utilities", direction: "out", schedule: monthly(20),
      amount: { fixed: 5_500 }, lifecycle: "posted" },
    { kind: "tx", id: "grocery", account: "checking", description: "GREEN BASKET GROCERY",
      merchant: "Green Basket Grocery", category: "groceries", direction: "out", schedule: every(8, 2),
      amount: { base: 3_600, spread: 2_800 }, lifecycle: "pending_post" },
    { kind: "transfer", id: "save", from: "checking", to: "savings", schedule: monthly(2), amountCents: 15_000,
      outDescription: "Online transfer to Savings ••{toMask}", inDescription: "Online transfer from Checking ••{fromMask}" },
    { kind: "card_payment", id: "cardpay", card: "card", payer: "checking", day: 24 },
    { kind: "tx", id: "interest", account: "savings", description: "INTEREST EARNED", merchant: null,
      category: "interest", direction: "in", schedule: monthly(28), amount: { base: 310, spread: 40 },
      lifecycle: "posted" },
    { kind: "tx", id: "fuel", account: "card", description: "QUICKFUEL #2290", merchant: "QuickFuel",
      category: "gas", direction: "out", schedule: every(9, 3), amount: { base: 3_400, spread: 2_000 },
      lifecycle: "pending_post",
      hold: { chance: 0.5, amountCents: 7_500, description: "QUICKFUEL #2290 PRE-AUTHORIZATION HOLD" } },
    { kind: "tx", id: "tacos", account: "card", description: "TAQUERIA SOL", merchant: "Taqueria Sol",
      category: "dining", direction: "out", schedule: every(7, 2), amount: { base: 1_800, spread: 1_600 },
      lifecycle: "pending_post", tipPct: 0.18 },
    { kind: "tx", id: "fitstream", account: "card", description: "FITSTREAM WORKOUTS", merchant: "FitStream",
      category: "subscriptions", direction: "out", schedule: monthly(14), amount: { fixed: 1_499 },
      lifecycle: "posted" },
    { kind: "tx", id: "games", account: "card", description: "GAMEVAULT PLUS", merchant: "GameVault",
      category: "subscriptions", direction: "out", schedule: monthly(27), amount: { fixed: 999 },
      lifecycle: "posted" },
    { kind: "tx", id: "shop", account: "card", description: "SHOPWELL ONLINE", merchant: "Shopwell",
      category: "shopping", direction: "out", schedule: every(13, 3), amount: { base: 2_000, spread: 5_000 },
      lifecycle: "pending_post" },
  ],
};

const CHASE: InstitutionProfile = {
  institution: institution({
    id: "ins_chase",
    name: "JPMorgan Chase (simulated)",
    brand: "JPMorgan Chase",
    country: "US",
    currency: "USD",
    kind: "bank",
    products: ["checking", "credit"],
    supportsTransfers: true,
  }),
  accounts: [
    { key: "checking", name: "Checking", type: "checking", openingCents: 190_000 },
    { key: "card", name: "Rewards Credit Card", type: "credit", creditLimitCents: 1_200_000 },
  ],
  streams: [
    { kind: "tx", id: "pay", account: "checking", description: "BRIGHTLINE STUDIO PAYROLL",
      merchant: "Brightline Studio", category: "income", direction: "in", schedule: every(14, 0),
      amount: { base: 40_000, spread: 0 }, lifecycle: "posted" },
    { kind: "tx", id: "internet", account: "checking", description: "METRO FIBER INTERNET",
      merchant: "Metro Fiber", category: "utilities", direction: "out", schedule: monthly(6),
      amount: { fixed: 6_999 }, lifecycle: "posted" },
    { kind: "tx", id: "grocery", account: "checking", description: "GREEN BASKET GROCERY",
      merchant: "Green Basket Grocery", category: "groceries", direction: "out", schedule: every(7, 2),
      amount: { base: 3_800, spread: 3_000 }, lifecycle: "pending_post" },
    { kind: "card_payment", id: "cardpay", card: "card", payer: "checking", day: 22 },
    { kind: "tx", id: "dining", account: "card", description: "LITTLE SAIGON KITCHEN",
      merchant: "Little Saigon Kitchen", category: "dining", direction: "out", schedule: every(6, 2),
      amount: { base: 2_600, spread: 2_400 }, lifecycle: "pending_post", tipPct: 0.18 },
    { kind: "tx", id: "shop", account: "card", description: "SHOPWELL ONLINE", merchant: "Shopwell",
      category: "shopping", direction: "out", schedule: every(11, 3), amount: { base: 2_500, spread: 7_500 },
      lifecycle: "pending_post" },
    { kind: "tx", id: "news", account: "card", description: "NEWSDAILY+ DIGITAL", merchant: "NewsDaily+",
      category: "subscriptions", direction: "out", schedule: monthly(5), amount: { fixed: 1_200 },
      lifecycle: "posted" },
    { kind: "tx", id: "rides", account: "card", description: "METRO RIDESHARE", merchant: "Metro Rideshare",
      category: "transportation", direction: "out", schedule: every(5, 2), amount: { base: 1_200, spread: 1_600 },
      lifecycle: "pending_post" },
  ],
};

const BARCLAYS_UK: InstitutionProfile = {
  institution: institution({
    id: "ins_barclays_uk",
    name: "Barclays UK (simulated)",
    brand: "Barclays",
    country: "GB",
    currency: "GBP",
    kind: "international",
    products: ["checking", "savings"],
    supportsTransfers: false,
  }),
  accounts: [
    { key: "current", name: "Current Account", type: "checking", openingCents: 850_000 },
    { key: "savings", name: "Savings Account", type: "savings", openingCents: 6_000_000 },
  ],
  streams: [
    { kind: "tx", id: "income", account: "current", description: "NORTHBRIDGE DESIGN LTD",
      merchant: "Northbridge Design Ltd", category: "income", direction: "in", schedule: monthly(27),
      amount: { base: 62_000, spread: 0 }, lifecycle: "posted" },
    { kind: "tx", id: "grocery", account: "current", description: "THAMES GROCERS", merchant: "Thames Grocers",
      category: "groceries", direction: "out", schedule: every(6, 2), amount: { base: 1_800, spread: 2_000 },
      lifecycle: "pending_post" },
    { kind: "tx", id: "transit", account: "current", description: "CITY TRANSIT LONDON",
      merchant: "City Transit London", category: "transportation", direction: "out", schedule: every(3, 1),
      amount: { base: 280, spread: 260 }, lifecycle: "posted" },
    { kind: "tx", id: "cafe", account: "current", description: "KINGS ROW CAFE", merchant: "Kings Row Cafe",
      category: "dining", direction: "out", schedule: every(5, 2), amount: { base: 450, spread: 500 },
      lifecycle: "pending_post" },
    { kind: "tx", id: "mobile", account: "current", description: "LUMEN UK MOBILE", merchant: "Lumen UK",
      category: "utilities", direction: "out", schedule: monthly(15), amount: { fixed: 1_200 },
      lifecycle: "posted" },
    { kind: "tx", id: "counciltax", account: "current", description: "BOROUGH COUNCIL TAX DD",
      merchant: "Borough Council", category: "taxes", direction: "out", schedule: monthly(1),
      amount: { fixed: 12_800 }, lifecycle: "posted" },
    { kind: "transfer", id: "save", from: "current", to: "savings", schedule: monthly(2), amountCents: 10_000,
      outDescription: "Transfer to Savings ••{toMask}", inDescription: "Transfer from Current Account ••{fromMask}" },
    { kind: "tx", id: "interest", account: "savings", description: "INTEREST", merchant: null,
      category: "interest", direction: "in", schedule: monthly(28), amount: { base: 410, spread: 50 },
      lifecycle: "posted" },
  ],
};

const RBC: InstitutionProfile = {
  institution: institution({
    id: "ins_rbc",
    name: "RBC Royal Bank (simulated)",
    brand: "RBC Royal Bank",
    country: "CA",
    currency: "CAD",
    kind: "international",
    products: ["checking", "savings"],
    supportsTransfers: false,
  }),
  accounts: [
    { key: "chequing", name: "Chequing Account", type: "checking", openingCents: 240_000 },
    { key: "savings", name: "Savings Account", type: "savings", openingCents: 510_000 },
  ],
  streams: [
    { kind: "tx", id: "pay", account: "chequing", description: "MAPLE LEAF ANALYTICS PAYROLL",
      merchant: "Maple Leaf Analytics", category: "income", direction: "in", schedule: every(14, 0),
      amount: { base: 50_000, spread: 0 }, lifecycle: "posted" },
    { kind: "tx", id: "grocery", account: "chequing", description: "NORTHERN GROCER", merchant: "Northern Grocer",
      category: "groceries", direction: "out", schedule: every(7, 2), amount: { base: 4_200, spread: 3_600 },
      lifecycle: "pending_post" },
    { kind: "tx", id: "hydro", account: "chequing", description: "LAKESHORE HYDRO", merchant: "Lakeshore Hydro",
      category: "utilities", direction: "out", schedule: monthly(12), amount: { base: 7_400, spread: 2_600 },
      lifecycle: "posted" },
    { kind: "tx", id: "transit", account: "chequing", description: "METRO TRANSIT MONTHLY PASS",
      merchant: "Metro Transit", category: "transportation", direction: "out", schedule: monthly(1),
      amount: { fixed: 15_600 }, lifecycle: "posted" },
    { kind: "tx", id: "phone", account: "chequing", description: "LUMEN CANADA MOBILE", merchant: "Lumen Canada",
      category: "utilities", direction: "out", schedule: monthly(19), amount: { fixed: 6_500 },
      lifecycle: "posted" },
    { kind: "tx", id: "dining", account: "chequing", description: "MAPLE DINER", merchant: "Maple Diner",
      category: "dining", direction: "out", schedule: every(6, 2), amount: { base: 2_200, spread: 1_800 },
      lifecycle: "pending_post", tipPct: 0.15 },
    { kind: "transfer", id: "save", from: "chequing", to: "savings", schedule: monthly(3), amountCents: 30_000,
      outDescription: "Online transfer to Savings ••{toMask}", inDescription: "Online transfer from Chequing ••{fromMask}" },
    { kind: "tx", id: "interest", account: "savings", description: "INTEREST", merchant: null,
      category: "interest", direction: "in", schedule: monthly(28), amount: { base: 640, spread: 80 },
      lifecycle: "posted" },
  ],
};

export const PROFILES: InstitutionProfile[] = [TD, BOA, CHASE, BARCLAYS_UK, RBC];

const BY_ID = new Map(PROFILES.map((p) => [p.institution.id, p]));

export function findProfile(institutionId: string): InstitutionProfile | undefined {
  return BY_ID.get(institutionId);
}

/**
 * Per-user simulated "world". Alice's JPMorgan Chase card is autopaid from her
 * TD Bank checking account, which exercises cross-institution transfer matching.
 */
export const USER_WORLD: Partial<Record<UserId, Record<string, WorldOverride>>> = {
  alice: {
    ins_chase: {
      accounts: ["card"],
      cardPayer: { card: "card", institutionId: "ins_td", account: "checking", day: 21, lagDays: 2 },
    },
  },
};

/** Institutions pre-linked (and synced up to the seed date) for each demo user. */
export const SEED_LINKS: { userId: UserId; institutionIds: string[] }[] = [
  { userId: "alice", institutionIds: ["ins_td", "ins_chase", "ins_barclays_uk"] },
  { userId: "bob", institutionIds: ["ins_boa"] },
];

export const slugOf = (institutionId: string) => institutionId.replace(/^ins_/, "");
export const connectionIdFor = (userId: UserId, institutionId: string) => `conn_${userId}_${slugOf(institutionId)}`;
export const accountIdFor = (userId: UserId, institutionId: string, key: string) =>
  `acct_${userId}_${slugOf(institutionId)}_${key}`;
export const recipientIdFor = (userId: UserId, institutionId: string, key: string) =>
  `rcp_${userId}_${slugOf(institutionId)}_${key}`;
