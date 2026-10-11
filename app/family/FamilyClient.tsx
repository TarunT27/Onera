"use client";

/**
 * Family: kids' secondary cards on a parent credit card. The parent sees what
 * each kid spends, sets limits and blocked categories, and can freeze a card.
 * Only the signed-in parent changes these — the assistant and monitoring
 * agents have no access. Every purchase here is simulated.
 */
import { useState, type ReactNode } from "react";
import {
  Basket,
  BookOpenText,
  Car,
  CheckCircle,
  FilmSlate,
  ForkKnife,
  GameController,
  Info,
  Lock,
  LockOpen,
  Repeat,
  ShoppingBag,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
// Pure data / pure functions — no server code reaches the client bundle.
import { CARD_CATEGORIES, type CardCategory } from "@/lib/family/types";
import { DECLINE_COPY } from "@/lib/family/policy";
import { clearfi, paths, type CardCharge, type FamilyCard, type FamilyOverview } from "../components/api";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { centsToDollarInput, formatCents, formatTxnDate, parseDollarsToCents } from "../components/format";
import { useApiData } from "../components/useApiData";
import { useI18n, useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import "./family-screen.css";

const CATEGORY_META: Record<CardCategory, { label: string; Icon: typeof ForkKnife }> = {
  dining: { label: msg("Dining"), Icon: ForkKnife },
  groceries: { label: msg("Groceries"), Icon: Basket },
  shopping: { label: msg("Shopping"), Icon: ShoppingBag },
  entertainment: { label: msg("Entertainment"), Icon: FilmSlate },
  gaming: { label: msg("Gaming"), Icon: GameController },
  subscriptions: { label: msg("Subscriptions"), Icon: Repeat },
  transport: { label: msg("Transport"), Icon: Car },
  education: { label: msg("Education"), Icon: BookOpenText },
};

const AVATAR: Record<FamilyCard["member"]["color"], string> = {
  teal: "from-teal-300/80 to-cyan-500/70",
  violet: "from-violet-300/80 to-indigo-500/70",
  amber: "from-amber-200/90 to-orange-400/70",
  rose: "from-rose-300/80 to-pink-500/70",
  sky: "from-sky-300/80 to-blue-500/70",
};

export function FamilyClient() {
  const { t, tp } = useI18n();
  const family = useApiData<FamilyOverview>(paths.family);
  const cards = family.data?.cards ?? [];

  const replaceCard = (next: FamilyCard) => {
    if (!family.data) return;
    family.setData({ ...family.data, cards: family.data.cards.map((c) => (c.id === next.id ? next : c)) });
  };

  const totalSpent = cards.reduce((s, c) => s + c.spentThisMonthCents, 0);
  const totalLimit = cards.reduce((s, c) => s + c.monthlyLimitCents, 0);
  const attention = cards.filter((c) => c.alerts.some((a) => a.level !== "info")).length;
  const parent = cards[0]?.parentAccount;

  return (
    <div className="family-screen screen space-y-6">
      <PageHeader
        title={t("Family")}
        description={t("Secondary cards for your kids on your credit card. See what they spend, set limits, and freeze a card in one tap.")}
      />

      <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <Lock size={15} weight="fill" aria-hidden />
        {t("Only you can change these settings. The assistant and monitoring agents can't.")}
      </p>

      <ErrorBox error={family.error} title={t("Couldn't load family cards")} onRetry={() => void family.reload()} />

      {family.loading && !family.data ? (
        <Card><Loading label={t("Loading family cards…")} /></Card>
      ) : cards.length === 0 ? (
        <Card>
          <EmptyState>{t("No family cards yet. In the demo, Alice has secondary cards for Maya and Leo — switch to Alice to see them.")}</EmptyState>
        </Card>
      ) : (
        // Desktop (901px+): one screen. Totals sit in a narrow column beside one
        // column per kid; each column scrolls inside itself.
        <div className="screen-body family-body space-y-6">
          <div className="family-stats screen-pane grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <Stat
              label={t("Spent this month")}
              value={formatCents(totalSpent)}
              detail={t("of {limit} in limits", { limit: formatCents(totalLimit, { whole: true }) })}
            />
            <Stat
              label={parent ? `${parent.name} ••${parent.mask}` : t("Parent card")}
              value={tp(cards.length, "{n} kid", "{n} kids")}
              detail={parent ? `${parent.institution} · ${t("secondary cards")}` : undefined}
              className="col-span-2 sm:col-span-1 sm:order-none order-last"
            />
            <Stat
              label={t("Needs a look")}
              value={attention === 0 ? t("All good") : tp(attention, "{n} card", "{n} cards")}
              tone={attention === 0 ? "text-emerald-200" : "text-amber-200"}
              detail={attention === 0 ? t("No limits running low") : t("Near or over the limit")}
            />
          </div>

          <div className="family-kids grid grid-cols-1 gap-5 xl:grid-cols-2">
            {cards.map((card) => (
              <KidCard key={card.id} card={card} onChange={replaceCard} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, detail, tone = "text-zinc-50", className = "" }: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <section className={`glass min-w-0 !rounded-[24px] px-4 py-4 sm:px-5 ${className}`}>
      <p className="truncate text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-white/45">{detail}</p>}
    </section>
  );
}

function usageTone(card: FamilyCard) {
  if (card.pctUsed >= 100) return { bar: "bg-red-400", text: "text-red-200" };
  if (card.pctUsed >= card.alertThresholdPct) return { bar: "bg-amber-300", text: "text-amber-200" };
  return { bar: "bg-brand-300", text: "text-brand-200" };
}

function KidCard({ card, onChange }: { card: FamilyCard; onChange: (c: FamilyCard) => void }) {
  const t = useT();
  const [error, setError] = useState<unknown>(null);
  const [freezing, setFreezing] = useState(false);
  const frozen = card.status === "frozen";
  const tone = usageTone(card);
  const maxCategory = card.byCategory[0]?.totalCents ?? 0;

  async function toggleFreeze() {
    setFreezing(true);
    setError(null);
    try {
      const { card: next } = await clearfi.updateFamilyCard(card.id, { status: frozen ? "active" : "frozen" });
      onChange(next);
    } catch (e) {
      setError(e);
    } finally {
      setFreezing(false);
    }
  }

  return (
    <section className="family-kid glass min-w-0 !rounded-[28px] p-5 sm:p-6" aria-labelledby={`kid-${card.id}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden
            className={`grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br text-lg font-semibold text-zinc-950 ${AVATAR[card.member.color]} ${frozen ? "opacity-50 grayscale" : ""}`}
          >
            {card.member.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <h2 id={`kid-${card.id}`} className="text-[19px] font-semibold tracking-[-0.015em] text-zinc-50">
              {card.member.name}
            </h2>
            <p className="whitespace-nowrap text-[13px] text-white/50">
              {t("Age {age}", { age: card.member.age })} · {t("Card")} ••{card.cardMask}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          {frozen ? <Badge tone="blue"><Lock size={12} weight="fill" aria-hidden />{t("Frozen")}</Badge> : <Badge tone="green">{t("Active")}</Badge>}
          <Button size="sm" variant={frozen ? "secondary" : "ghost"} busy={freezing} onClick={() => void toggleFreeze()}>
            {frozen ? <LockOpen size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
            {frozen ? t("Unfreeze") : t("Freeze card")}
          </Button>
        </div>
      </div>

      <ErrorBox error={error} onDismiss={() => setError(null)} className="mt-4" />

      {/* Spend vs limit */}
      <div className="mt-6">
        <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">{t("Spent this month")}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-zinc-50 tabular-nums">
            {formatCents(card.spentThisMonthCents)}
          </span>
          <span className="text-sm text-white/45">{t("of {limit}", { limit: formatCents(card.monthlyLimitCents) })}</span>
        </div>
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-label={t("{name}'s monthly limit used", { name: card.member.name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(card.pctUsed))}
        >
          <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-500`} style={{ width: `${Math.min(100, card.pctUsed)}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[13px]">
          <span className="text-white/55">{t("{amount} left", { amount: formatCents(card.remainingCents) })}</span>
          <span className={`tabular-nums ${tone.text}`}>{t("{pct}% used", { pct: Math.round(card.pctUsed) })}</span>
        </div>
      </div>

      {/* Alerts, spending and settings scroll inside the card on desktop. */}
      <div className="family-kid-scroll">
      {/* Alerts */}
      {card.alerts.length > 0 && (
        <ul className="mt-4 space-y-2">
          {card.alerts.map((a) => (
            <li
              key={a.message}
              className={`flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] ${
                a.level === "critical" ? "bg-red-400/10 text-red-100" : a.level === "warning" ? "bg-amber-300/10 text-amber-100" : "bg-white/[0.04] text-white/65"
              }`}
            >
              {a.level === "info" ? <Info size={16} className="mt-px shrink-0" aria-hidden /> : <Warning size={16} weight="fill" className="mt-px shrink-0" aria-hidden />}
              {t(a.message)}
            </li>
          ))}
        </ul>
      )}

      {/* Where it went */}
      {card.byCategory.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[13px] font-semibold text-white/70">{t("Where it went")}</h3>
          <ul className="mt-3 space-y-2.5">
            {card.byCategory.slice(0, 4).map(({ category, totalCents }) => {
              const { label, Icon } = CATEGORY_META[category];
              return (
                <li key={category} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="grid size-7 place-items-center rounded-full bg-white/[0.06] text-white/70">
                    <Icon size={15} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-white/80">{t(label)}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-white/35" style={{ width: `${maxCategory ? (totalCents / maxCategory) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <span className="tabular-nums text-white/80">{formatCents(totalCents)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Recent activity */}
      <div className="mt-6">
        <h3 className="text-[13px] font-semibold text-white/70">{t("Recent activity")}</h3>
        {card.recent.length === 0 ? (
          <p className="mt-2 text-[13px] text-white/45">{t("No purchases yet.")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {card.recent.slice(0, 6).map((c) => (
              <ChargeRow key={c.id} charge={c} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <Controls card={card} onChange={onChange} />
        <TryPurchase card={card} onChange={onChange} />
      </div>
      </div>
    </section>
  );
}

function ChargeRow({ charge: c }: { charge: CardCharge }) {
  const t = useT();
  const { label, Icon } = CATEGORY_META[c.category];
  const declined = c.status === "declined";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${declined ? "bg-red-400/10 text-red-200" : "bg-white/[0.06] text-white/70"}`}>
        {declined ? <XCircle size={16} aria-hidden /> : <Icon size={15} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-100">{c.merchant}</p>
        <p className="truncate text-xs text-white/45">
          {formatTxnDate(c.postedAt, { short: true })} · {t(label)}
          {declined && c.declineReason && <span className="text-red-200/90"> · {t("Declined: {reason}", { reason: t(DECLINE_COPY[c.declineReason]).toLowerCase() })}</span>}
        </p>
      </div>
      <span className={`shrink-0 text-sm tabular-nums ${declined ? "text-white/35 line-through" : "text-zinc-100"}`}>
        {formatCents(c.amountCents)}
      </span>
    </li>
  );
}

function Controls({ card, onChange }: { card: FamilyCard; onChange: (c: FamilyCard) => void }) {
  const t = useT();
  const [monthly, setMonthly] = useState(centsToDollarInput(card.monthlyLimitCents));
  const [perPurchase, setPerPurchase] = useState(centsToDollarInput(card.perPurchaseLimitCents));
  const [blocked, setBlocked] = useState<CardCategory[]>(card.blockedCategories);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const toggle = (c: CardCategory) => {
    setSaved(false);
    setBlocked((b) => (b.includes(c) ? b.filter((x) => x !== c) : [...b, c]));
  };

  async function save() {
    const m = parseDollarsToCents(monthly, { allowZero: true, t });
    const p = parseDollarsToCents(perPurchase, { allowZero: true, t });
    if (!m.ok) return setError(new Error(t("Monthly limit: {error}", { error: m.error })));
    if (!p.ok) return setError(new Error(t("Per-purchase limit: {error}", { error: p.error })));
    setSaving(true);
    setError(null);
    try {
      const { card: next } = await clearfi.updateFamilyCard(card.id, {
        monthlyLimitCents: m.cents,
        perPurchaseLimitCents: p.cents,
        blockedCategories: blocked,
      });
      onChange(next);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="group rounded-2xl bg-white/[0.03] px-4 py-3 open:pb-4">
      <summary className="cursor-pointer list-none text-sm font-medium text-white/80 marker:hidden">
        <span className="flex items-center justify-between">
          {t("Limits & blocked categories")}
          <span className="text-xs text-white/40 group-open:hidden">
            {t("{amount} per purchase", { amount: formatCents(card.perPurchaseLimitCents, { whole: true }) })}
            {card.blockedCategories.length > 0 && ` · ${t("{count} blocked", { count: card.blockedCategories.length })}`}
          </span>
        </span>
      </summary>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span className={labelClass}>{t("Monthly limit")}</span>
          <input className={inputClass} inputMode="decimal" value={monthly} onChange={(e) => { setMonthly(e.target.value); setSaved(false); }} />
        </label>
        <label>
          <span className={labelClass}>{t("Per-purchase limit")}</span>
          <input className={inputClass} inputMode="decimal" value={perPurchase} onChange={(e) => { setPerPurchase(e.target.value); setSaved(false); }} />
        </label>
      </div>
      <fieldset className="mt-4">
        <legend className={labelClass}>{t("Block these categories")}</legend>
        <div className="flex flex-wrap gap-2">
          {CARD_CATEGORIES.map((c) => {
            const on = blocked.includes(c);
            const { label, Icon } = CATEGORY_META[c];
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? "bg-red-400/15 text-red-200 shadow-[inset_0_0_0_1px_rgb(248_113_113/0.3)]" : "bg-white/[0.06] text-white/65 hover:bg-white/[0.1]"
                }`}
              >
                <Icon size={13} aria-hidden />
                {t(label)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <ErrorBox error={error} onDismiss={() => setError(null)} className="mt-3" />
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" size="sm" busy={saving} onClick={() => void save()}>{t("Save limits")}</Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-200">
            <CheckCircle size={14} weight="fill" aria-hidden /> {t("Saved")}
          </span>
        )}
      </div>
    </details>
  );
}

function TryPurchase({ card, onChange }: { card: FamilyCard; onChange: (c: FamilyCard) => void }) {
  const t = useT();
  const [merchant, setMerchant] = useState("Roblox");
  const [category, setCategory] = useState<CardCategory>("gaming");
  const [amount, setAmount] = useState("19.99");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CardCharge | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function tryIt() {
    const a = parseDollarsToCents(amount, { t });
    if (!a.ok) return setError(new Error(a.error));
    setBusy(true);
    setError(null);
    try {
      const { charge, card: next } = await clearfi.simulateFamilyPurchase(card.id, { merchant, category, amountCents: a.cents });
      setResult(charge);
      onChange(next);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group rounded-2xl bg-white/[0.03] px-4 py-3 open:pb-4">
      <summary className="cursor-pointer list-none text-sm font-medium text-white/80 marker:hidden">
        <span className="flex items-center justify-between">
          {t("Try a purchase")}
          <span className="text-xs text-white/40">{t("Simulated")}</span>
        </span>
      </summary>
      <p className="mt-2 text-xs text-white/45">
        {t("See what happens when {name} taps their card. Your rules decide; nothing real is charged.", { name: card.member.name })}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr]">
        <label>
          <span className={labelClass}>{t("Merchant")}</span>
          <input className={inputClass} value={merchant} maxLength={60} onChange={(e) => setMerchant(e.target.value)} />
        </label>
        <label>
          <span className={labelClass}>{t("Category")}</span>
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as CardCategory)}>
            {CARD_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(CATEGORY_META[c].label)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelClass}>{t("Amount")}</span>
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <ErrorBox error={error} onDismiss={() => setError(null)} className="mt-3" />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" busy={busy} disabled={!merchant.trim()} onClick={() => void tryIt()}>{t("Tap card")}</Button>
        {result && (
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              result.status === "approved" ? "bg-emerald-400/15 text-emerald-200" : "bg-red-400/15 text-red-200"
            }`}
          >
            {result.status === "approved" ? <CheckCircle size={14} weight="fill" aria-hidden /> : <XCircle size={14} weight="fill" aria-hidden />}
            {result.status === "approved"
              ? t("Approved · {amount} at {merchant}", { amount: formatCents(result.amountCents), merchant: result.merchant })
              : t("Declined · {reason}", { reason: t(DECLINE_COPY[result.declineReason!]) })}
          </span>
        )}
      </div>
    </details>
  );
}
