import type { DB } from "./index";
import { buildSeedData } from "@/fixtures/seed-data";

const DAY_MS = 86_400_000;

export function seedDatabase(db: DB, asOf: Date): void {
  const data = buildSeedData(asOf);
  const now = asOf.toISOString();
  // Spread same-day items across the morning so ordering is stable.
  const at = (daysAgo: number, seq: number) =>
    new Date(asOf.getTime() - daysAgo * DAY_MS - (seq % 600) * 60_000).toISOString();

  db.transaction(() => {
    const insUser = db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)");
    for (const u of data.users) insUser.run(u.id, u.name, u.email);

    const insAccount = db.prepare(`INSERT INTO accounts
      (id, user_id, institution, name, type, mask, balance_cents, available_cents, capabilities, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const a of data.accounts) {
      insAccount.run(a.id, a.userId, a.institution, a.name, a.type, a.mask,
        a.balanceCents, a.balanceCents, JSON.stringify(a.capabilities), now);
    }

    const insTx = db.prepare(`INSERT INTO transactions
      (id, account_id, user_id, posted_at, description, merchant, category, amount_cents, transfer_group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const group of data.transactions) {
      group.items.forEach((t, i) => {
        const id = `tx_${group.userId}_${String(i + 1).padStart(4, "0")}`;
        insTx.run(id, t.accountId, group.userId, at(t.daysAgo, i), t.description, t.merchant,
          t.category, t.amountCents, t.transferGroupId ?? null);
      });
    }

    const insRecipient = db.prepare(`INSERT INTO recipients
      (id, user_id, display_name, kind, account_id, details, version, verified_version,
       previous_details, change_note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of data.recipients) {
      insRecipient.run(r.id, r.userId, r.displayName, r.kind, r.accountId, JSON.stringify(r.details),
        r.version, r.verifiedVersion, r.previousDetails ? JSON.stringify(r.previousDetails) : null,
        r.changeNote, now);
    }

    const insControls = db.prepare(`INSERT INTO user_controls
      (user_id, per_transfer_limit_cents, daily_limit_cents, paused, updated_at) VALUES (?, ?, ?, 0, ?)`);
    for (const c of data.controls) insControls.run(c.userId, c.perTransferLimitCents, c.dailyLimitCents, now);

    const insAudit = db.prepare(`INSERT INTO audit_events (user_id, actor, event_type, detail, created_at)
      VALUES (?, 'system', 'demo.seeded', '{}', ?)`);
    for (const u of data.users) insAudit.run(u.id, now);
  })();
}
