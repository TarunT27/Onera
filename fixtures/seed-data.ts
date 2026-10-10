/**
 * Synthetic demo data. Everything here is fictional: people, institutions,
 * balances and history. Dates are generated relative to `asOf` so the demo
 * always has "recent" activity.
 *
 * Demo scenarios baked in for Alice (the pitch user):
 *  - StreamFlix went from $15.49 to $22.99 on the latest charge (subscription insight).
 *  - $500 monthly checking → savings moves are internal transfers (excluded from spending).
 *  - Landlord "Oak Street Properties" bank details changed after verification (transfer hold).
 *  - Own-account transfer to savings is verified (happy path).
 */
import type {
  AccountCapability,
  AccountType,
  RecipientDetails,
  RecipientKind,
  UserId,
} from "@/lib/types";

export interface SeedUser {
  id: UserId;
  name: string;
  email: string;
}

export interface SeedAccount {
  id: string;
  userId: UserId;
  institution: string;
  name: string;
  type: AccountType;
  mask: string;
  /** Brokerage accounts: cash only; positions live in the markets module. */
  balanceCents: number;
  capabilities: AccountCapability[];
  paper?: boolean;
}

export interface SeedTransaction {
  accountId: string;
  daysAgo: number;
  description: string;
  merchant: string | null;
  category: string;
  amountCents: number;
  transferGroupId?: string;
}

export interface SeedRecipient {
  id: string;
  userId: UserId;
  displayName: string;
  kind: RecipientKind;
  accountId: string | null;
  details: RecipientDetails;
  version: number;
  verifiedVersion: number | null;
  previousDetails: RecipientDetails | null;
  changeNote: string | null;
}

export interface SeedControls {
  userId: UserId;
  perTransferLimitCents: number;
  dailyLimitCents: number;
}

export interface SeedData {
  users: SeedUser[];
  accounts: SeedAccount[];
  transactions: { userId: UserId; items: SeedTransaction[] }[];
  recipients: SeedRecipient[];
  controls: SeedControls[];
}

const DEMO_BANK = "Onera Demo Bank";

export function buildSeedData(asOf: Date): SeedData {
  // Keep the latest subscription charge inside the current calendar month.
  const recent = Math.min(2, asOf.getUTCDate() - 1);

  const users: SeedUser[] = [
    { id: "alice", name: "Alice Chen", email: "alice@example.test" },
    { id: "bob", name: "Bob Okafor", email: "bob@example.test" },
  ];

  const accounts: SeedAccount[] = [
    {
      id: "acct_alice_checking",
      userId: "alice",
      institution: DEMO_BANK,
      name: "Everyday Checking",
      type: "checking",
      mask: "4410",
      balanceCents: 425_000,
      capabilities: ["view", "transfer_source", "transfer_destination"],
    },
    {
      id: "acct_alice_savings",
      userId: "alice",
      institution: DEMO_BANK,
      name: "High-Yield Savings",
      type: "savings",
      mask: "7702",
      balanceCents: 5_560_000,
      capabilities: ["view", "transfer_source", "transfer_destination"],
    },
    {
      // Imported holdings: view-only. Positions are seeded by lib/markets.
      id: "acct_alice_brokerage",
      userId: "alice",
      institution: "Northwind Brokerage (demo import)",
      name: "Individual Brokerage",
      type: "brokerage",
      mask: "3091",
      balanceCents: 42_015,
      capabilities: ["view"],
    },
    {
      // Paper trading account: the only place orders can execute. Excluded from net worth.
      id: "acct_alice_paper",
      userId: "alice",
      institution: "Onera Paper Trading (simulated)",
      name: "Paper Portfolio",
      type: "brokerage",
      mask: "0001",
      balanceCents: 500_000,
      capabilities: ["view", "trade"],
      paper: true,
    },
    {
      id: "acct_bob_checking",
      userId: "bob",
      institution: DEMO_BANK,
      name: "Checking",
      type: "checking",
      mask: "5528",
      balanceCents: 214_055,
      capabilities: ["view", "transfer_source", "transfer_destination"],
    },
    {
      id: "acct_bob_savings",
      userId: "bob",
      institution: DEMO_BANK,
      name: "Savings",
      type: "savings",
      mask: "6634",
      balanceCents: 500_000,
      capabilities: ["view", "transfer_source", "transfer_destination"],
    },
    {
      id: "acct_bob_paper",
      userId: "bob",
      institution: "Onera Paper Trading (simulated)",
      name: "Paper Portfolio",
      type: "brokerage",
      mask: "0002",
      balanceCents: 100_000,
      capabilities: ["view", "trade"],
      paper: true,
    },
  ];

  const ac = "acct_alice_checking";
  const as = "acct_alice_savings";
  const alice: SeedTransaction[] = [
    // Income
    ...[5, 19, 33, 47, 61, 75, 89].map((d) => ({
      accountId: ac, daysAgo: d, description: "ACME Corp Payroll", merchant: "ACME Corp",
      category: "income", amountCents: 320_000,
    })),
    ...[28, 58, 88].map((d) => ({
      accountId: as, daysAgo: d, description: "Interest payment", merchant: null,
      category: "interest", amountCents: 3_120,
    })),
    // Housing — paid to the previously verified landlord account (••4821)
    ...[31, 61, 91].map((d) => ({
      accountId: ac, daysAgo: d, description: "Rent — Oak Street Properties ••4821",
      merchant: "Oak Street Properties", category: "housing", amountCents: -185_000,
    })),
    // Subscriptions — StreamFlix price increase on the latest charge
    ...[recent + 90, recent + 60, recent + 30].map((d) => ({
      accountId: ac, daysAgo: d, description: "STREAMFLIX.COM MONTHLY", merchant: "StreamFlix",
      category: "subscriptions", amountCents: -1_549,
    })),
    {
      accountId: ac, daysAgo: recent, description: "STREAMFLIX.COM MONTHLY", merchant: "StreamFlix",
      category: "subscriptions", amountCents: -2_299,
    },
    ...[12, 42, 72, 102].map((d) => ({
      accountId: ac, daysAgo: d, description: "CloudBox Storage 200GB", merchant: "CloudBox",
      category: "subscriptions", amountCents: -299,
    })),
    ...[15, 45, 75].map((d) => ({
      accountId: ac, daysAgo: d, description: "FitLife Gym membership", merchant: "FitLife Gym",
      category: "fitness", amountCents: -4_000,
    })),
    // Everyday spending
    ...([
      [3, -8_412], [10, -6_240], [17, -9_105], [24, -5_877],
      [38, -7_730], [45, -6_610], [52, -8_825], [66, -7_190],
    ] as const).map(([d, amt]) => ({
      accountId: ac, daysAgo: d, description: "FreshMart Groceries", merchant: "FreshMart",
      category: "groceries", amountCents: amt,
    })),
    ...[1, 4, 8, 13, 22, 36, 41].map((d) => ({
      accountId: ac, daysAgo: d, description: "Bean There Coffee", merchant: "Bean There",
      category: "dining", amountCents: -575,
    })),
    ...[6, 27, 49].map((d) => ({
      accountId: ac, daysAgo: d, description: "Nori Sushi", merchant: "Nori Sushi",
      category: "dining", amountCents: -4_620,
    })),
    ...[14, 44, 74].map((d) => ({
      accountId: ac, daysAgo: d, description: "Metro Power & Light", merchant: "Metro Power & Light",
      category: "utilities", amountCents: -9_640,
    })),
    // Internal transfers: both legs share a transfer group and never count as spending.
    ...[20, 50, 80].flatMap((d) => [
      {
        accountId: ac, daysAgo: d, description: "Transfer to High-Yield Savings ••7702",
        merchant: null, category: "transfer", amountCents: -50_000, transferGroupId: `tg_alice_${d}`,
      },
      {
        accountId: as, daysAgo: d, description: "Transfer from Everyday Checking ••4410",
        merchant: null, category: "transfer", amountCents: 50_000, transferGroupId: `tg_alice_${d}`,
      },
    ]),
  ];

  const bc = "acct_bob_checking";
  const bob: SeedTransaction[] = [
    ...[7, 21, 35, 49].map((d) => ({
      accountId: bc, daysAgo: d, description: "Globex Payroll", merchant: "Globex",
      category: "income", amountCents: 260_000,
    })),
    ...[9, 39].map((d) => ({
      accountId: bc, daysAgo: d, description: "Maple Court Apartments", merchant: "Maple Court Apartments",
      category: "housing", amountCents: -145_000,
    })),
    ...[11, 41, 71].map((d) => ({
      accountId: bc, daysAgo: d, description: "STREAMFLIX.COM MONTHLY", merchant: "StreamFlix",
      category: "subscriptions", amountCents: -1_549,
    })),
    ...([[2, -5_410], [16, -7_220], [30, -6_015]] as const).map(([d, amt]) => ({
      accountId: bc, daysAgo: d, description: "FreshMart Groceries", merchant: "FreshMart",
      category: "groceries", amountCents: amt,
    })),
  ];

  const recipients: SeedRecipient[] = [
    {
      id: "rcp_alice_savings",
      userId: "alice",
      displayName: "My High-Yield Savings",
      kind: "own_account",
      accountId: as,
      details: { institution: DEMO_BANK, accountMask: "7702", routingMask: null },
      version: 1,
      verifiedVersion: 1,
      previousDetails: null,
      changeNote: null,
    },
    {
      id: "rcp_alice_checking",
      userId: "alice",
      displayName: "My Everyday Checking",
      kind: "own_account",
      accountId: ac,
      details: { institution: DEMO_BANK, accountMask: "4410", routingMask: null },
      version: 1,
      verifiedVersion: 1,
      previousDetails: null,
      changeNote: null,
    },
    {
      // The signature scenario: details changed after the last verification.
      id: "rcp_alice_landlord",
      userId: "alice",
      displayName: "Oak Street Properties (landlord)",
      kind: "external",
      accountId: null,
      details: { institution: "Harborview Credit Union", accountMask: "9930", routingMask: "••0417" },
      version: 2,
      verifiedVersion: 1,
      previousDetails: { institution: "Summit Community Bank", accountMask: "4821", routingMask: "••2210" },
      changeNote:
        "Bank details replaced 2 hours ago after an emailed \"new payment instructions\" request (synthetic scenario).",
    },
    {
      id: "rcp_alice_sam",
      userId: "alice",
      displayName: "Sam Rivera",
      kind: "external",
      accountId: null,
      details: { institution: DEMO_BANK, accountMask: "1177", routingMask: "••5531" },
      version: 1,
      verifiedVersion: 1,
      previousDetails: null,
      changeNote: null,
    },
    {
      id: "rcp_bob_savings",
      userId: "bob",
      displayName: "My Savings",
      kind: "own_account",
      accountId: "acct_bob_savings",
      details: { institution: DEMO_BANK, accountMask: "6634", routingMask: null },
      version: 1,
      verifiedVersion: 1,
      previousDetails: null,
      changeNote: null,
    },
  ];

  const controls: SeedControls[] = [
    { userId: "alice", perTransferLimitCents: 200_000, dailyLimitCents: 300_000 },
    { userId: "bob", perTransferLimitCents: 100_000, dailyLimitCents: 150_000 },
  ];

  return {
    users,
    accounts,
    transactions: [
      { userId: "alice", items: alice },
      { userId: "bob", items: bob },
    ],
    recipients,
    controls,
  };
}
