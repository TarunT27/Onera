import type { Account } from "@/lib/types";
import type { RecipientWithStatus } from "../components/api";

/** "TD Bank (simulated)" → "TD Bank". The full name (with its simulated tag) stays in the title text. */
export function shortInstitution(institution: string): string {
  return institution.replace(/\s*\(.*?\)\s*/g, " ").trim() || institution;
}

/** Drops the "(verified via simulated link)" suffix linked accounts carry; the status badge says the same thing. */
export function shortRecipientName(displayName: string): string {
  return displayName.replace(/\s*\(verified via simulated link\)\s*$/i, "");
}

export const isOnera = (institution: string) => /\bonera\b/i.test(institution);

/** One own-account destination: the recipient record plus the account it points at. */
export type OwnDestination = { recipient: RecipientWithStatus; account: Account | null };

export function ownDestinations(recipients: RecipientWithStatus[], accounts: Account[]): OwnDestination[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return recipients
    .filter((r) => r.kind === "own_account")
    .map((r) => ({ recipient: r, account: r.accountId ? (byId.get(r.accountId) ?? null) : null }));
}

/** Name to show for a destination: the account's own name for linked accounts, else the saved name. */
export function destinationName(d: OwnDestination): string {
  return d.account?.name ?? d.recipient.displayName;
}
