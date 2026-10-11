"use client";
/* eslint-disable @next/next/no-img-element -- small static mascot PNGs, no optimisation needed */

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ArrowUpRight, Sparkle, X } from "@phosphor-icons/react";
import type { AssistantAgentId, ChatRequest, ChatResponse } from "@/lib/types";
import { api } from "../components/api";
import { Badge } from "../components/Badge";
import { ErrorBox } from "../components/ErrorBox";
import { useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";

type TradeAgent = Exclude<AssistantAgentId, "general">;

interface AgentStyle {
  id: TradeAgent;
  /** Tab label. */
  label: string;
  /** Name used in replies and screen-reader text. */
  name: string;
  /** Lower-case form of the name for use inside a sentence. */
  noun: string;
  tagline: string;
  /** English templates with a `{symbol}` placeholder. */
  headline: string;
  ask: string;
  /** Accent: the mascot's own colour. */
  color: string;
  mascot: string;
}

const AGENTS: AgentStyle[] = [
  {
    id: "research", label: msg("Research"), name: msg("Research analyst"), noun: msg("research analyst"), tagline: msg("Companies, explained."),
    headline: msg("A clearer view of {symbol}."), ask: msg("What is {symbol} and how has it done lately?"),
    color: "#72c6fa", mascot: "/agents/research.png",
  },
  {
    id: "chart", label: msg("Charts"), name: msg("Chart reader"), noun: msg("chart reader"), tagline: msg("Trend, range and volatility."),
    headline: msg("How {symbol} has moved."), ask: msg("Read the {symbol} chart over the last 3 months."),
    color: "#b6abf9", mascot: "/agents/charts.png",
  },
  {
    id: "risk", label: msg("Risk"), name: msg("Risk checker"), noun: msg("risk checker"), tagline: msg("Concentration and your limits."),
    headline: msg("How {symbol} fits your portfolio."), ask: msg("Would $250 more of {symbol} make my paper portfolio lopsided?"),
    color: "#9be5bf", mascot: "/agents/risk.png",
  },
  {
    id: "drafter", label: msg("Trade"), name: msg("Trade drafter"), noun: msg("trade drafter"), tagline: msg("Drafts orders you approve."),
    headline: msg("Draft an order for {symbol}."), ask: msg("Buy $250 of {symbol} in my paper account."),
    color: "#fcb18e", mascot: "/agents/trade.png",
  },
];
const agentById = (id: TradeAgent) => AGENTS.find((a) => a.id === id)!;
const accent = (a: AgentStyle) => ({ "--agent": a.color }) as CSSProperties;

type Msg =
  | { id: number; role: "user"; content: string; agent: TradeAgent }
  | { id: number; role: "assistant"; content: string; agent: TradeAgent; response: ChatResponse };

const MAX_MESSAGES = 30;

function toRequest(agent: TradeAgent, history: Msg[]): ChatRequest {
  let messages = history.map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) || "(empty reply)" })).slice(-MAX_MESSAGES);
  while (messages.length > 1 && messages[0].role !== "user") messages = messages.slice(1);
  return { agent, messages };
}

export function TradeAssistant({
  symbol,
  onReviewOrder,
  onClose,
}: {
  symbol: string;
  onReviewOrder: (orderId: string) => void;
  /** Shown as a Close button when the assistant is a slide-over (below 1200px). */
  onClose?: () => void;
}) {
  const t = useT();
  const [agent, setAgent] = useState<TradeAgent>("research");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const current = agentById(agent);
  const index = AGENTS.indexOf(current);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  // Radio group: arrow keys move the selection (and focus), like native radios.
  function onTabsKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = AGENTS[(index + step + AGENTS.length) % AGENTS.length];
    setAgent(next.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-agent="${next.id}"]`)?.focus();
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const userMsg: Msg = { id: nextId.current++, role: "user", content, agent };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setPending(true);
    setError(null);
    try {
      const response = await api.post<ChatResponse>("/api/chat", toRequest(agent, history));
      setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: response.reply, agent, response }]);
      // Bring the newest proposal into view; approval still happens on the review card.
      const proposed = response.proposedOrderIds?.at(-1);
      if (proposed) onReviewOrder(proposed);
    } catch (err) {
      setError(err);
      setMessages((m) => m.filter((x) => x.id !== userMsg.id));
      setInput(content);
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="trade-assistant glass" aria-label={t("Assistant")} style={accent(current)}>
      <header className="assistant-head">
        <Sparkle className="assistant-spark" size={18} weight="fill" aria-hidden />
        <h2>{t("Ask Onera")}</h2>
        <span className="row-meta">{t("Not financial advice")}</span>
        {onClose && (
          <button type="button" className="icon-btn assistant-close" onClick={onClose} aria-label={t("Close assistant")}>
            <X size={16} aria-hidden />
          </button>
        )}
      </header>

      <div
        ref={tabsRef}
        className="agent-tabs"
        role="radiogroup"
        aria-label={t("Choose an agent")}
        onKeyDown={onTabsKey}
        style={{ "--idx": index } as CSSProperties}
      >
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={agent === a.id}
            tabIndex={agent === a.id ? 0 : -1}
            data-agent={a.id}
            className="agent-tab"
            onClick={() => setAgent(a.id)}
          >
            <img src={a.mascot} alt="" width={40} height={40} />
            <span>{t(a.label)}</span>
          </button>
        ))}
        <span className="agent-bar" aria-hidden />
      </div>

      <p className="agent-line" key={`line-${agent}`}>
        <strong>{t(current.label)}</strong> · {t(current.tagline)}
      </p>

      <div className="assistant-thread" ref={listRef} aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="agent-hello" key={`hello-${agent}`}>
            <img className="agent-hero" src={current.mascot} alt="" width={72} height={72} />
            <h3>{t(current.headline, { symbol })}</h3>
            <p>{t("Ask a question to get started.")}</p>
            <button type="button" className="agent-suggest" onClick={() => void send(t(current.ask, { symbol }))}>
              <span>{t(current.ask, { symbol })}</span>
              <ArrowUpRight size={16} weight="bold" aria-hidden />
            </button>
          </div>
        )}
        {messages.map((m) => {
          const who = agentById(m.agent);
          return m.role === "user" ? (
            <p key={m.id} className="bubble user">
              {m.content}
            </p>
          ) : (
            <div key={m.id} className="agent-reply" style={accent(who)}>
              <img src={who.mascot} alt="" width={28} height={28} />
              <div className="agent-reply-body">
                <span className="bubble-agent">
                  {t(who.name)}
                  {m.response.mode === "fallback" && <Badge tone="amber">{t("Fallback · no model")}</Badge>}
                </span>
                <p>{m.content}</p>
                {m.response.notice && <p className="bubble-notice">{t(m.response.notice)}</p>}
                {m.response.trace.length > 0 && (
                  <p className="bubble-tools">{t("Used {tools}", { tools: [...new Set(m.response.trace.map((step) => step.tool))].join(" · ") })}</p>
                )}
                {(m.response.proposedOrderIds ?? []).map((id) => (
                  <button key={id} type="button" className="agent-review" onClick={() => onReviewOrder(id)}>
                    {t("Review proposed order")}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="agent-typing" role="status">
            <img src={current.mascot} alt="" width={22} height={22} />
            <span className="sr-only">{t("The {name} is working…", { name: t(current.noun) })}</span>
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <form
        className="assistant-input"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="trade-ask" className="sr-only">
          {t("Message the {name}", { name: t(current.noun) })}
        </label>
        <input
          id="trade-ask"
          value={input}
          maxLength={4000}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length ? t("Ask a follow-up…") : t("Ask about {symbol}…", { symbol })}
        />
        <button type="submit" aria-label={t("Send")} disabled={pending || !input.trim()}>
          <ArrowUp size={17} weight="bold" aria-hidden />
        </button>
      </form>
      <p className="assistant-foot">
        {t("Agents read your synthetic data. Only Trade can propose orders, and only you can approve them.")}
      </p>
    </aside>
  );
}
