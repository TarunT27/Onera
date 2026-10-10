"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Sparkle } from "@phosphor-icons/react";
import type { AssistantAgentId, ChatRequest, ChatResponse } from "@/lib/types";
import { api } from "../components/api";
import { Badge } from "../components/Badge";
import { ErrorBox } from "../components/ErrorBox";

type TradeAgent = Exclude<AssistantAgentId, "general">;

const AGENTS: { id: TradeAgent; name: string; blurb: string; ask: (s: string) => string }[] = [
  { id: "research", name: "Research analyst", blurb: "What a company or fund is", ask: (s) => `What is ${s} and how has it done lately?` },
  { id: "chart", name: "Chart reader", blurb: "Trend, range and volatility", ask: (s) => `Read the ${s} chart over the last 3 months.` },
  { id: "risk", name: "Risk checker", blurb: "Concentration and your limits", ask: (s) => `Would buying $250 more of ${s} make my paper portfolio lopsided?` },
  { id: "drafter", name: "Trade drafter", blurb: "Drafts an order you approve", ask: (s) => `Buy $250 of ${s} in my paper account.` },
];

type Msg =
  | { id: number; role: "user"; content: string; agent: TradeAgent }
  | { id: number; role: "assistant"; content: string; agent: TradeAgent; response: ChatResponse };

const MAX_MESSAGES = 30;

function toRequest(agent: TradeAgent, history: Msg[]): ChatRequest {
  let messages = history.map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) || "(empty reply)" })).slice(-MAX_MESSAGES);
  while (messages.length > 1 && messages[0].role !== "user") messages = messages.slice(1);
  return { agent, messages };
}

export function TradeAssistant({ symbol, onReviewOrder }: { symbol: string; onReviewOrder: (orderId: string) => void }) {
  const [agent, setAgent] = useState<TradeAgent>("research");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const current = AGENTS.find((a) => a.id === agent)!;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

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
    <aside className="trade-assistant glass" aria-label="Assistant">
      <header className="assistant-head">
        <span className="squircle assistant-mark">
          <Sparkle size={16} weight="fill" aria-hidden />
        </span>
        <h2>Ask Onera</h2>
        <span className="row-meta">Not financial advice</span>
      </header>

      <p className="assistant-label" id="agent-label">
        Choose an agent
      </p>
      <div className="agent-grid" role="radiogroup" aria-labelledby="agent-label">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={agent === a.id}
            className="agent-chip"
            onClick={() => setAgent(a.id)}
          >
            <strong>{a.name}</strong>
            <small>{a.blurb}</small>
          </button>
        ))}
      </div>

      <div className="assistant-thread" ref={listRef} aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="assistant-empty">
            <p>Ask the {current.name.toLowerCase()} about {symbol}.</p>
            <button type="button" className="suggestion" onClick={() => void send(current.ask(symbol))}>
              {current.ask(symbol)}
            </button>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="bubble user">
              {m.content}
            </p>
          ) : (
            <div key={m.id} className="bubble assistant">
              <span className="bubble-agent">
                {AGENTS.find((a) => a.id === m.agent)?.name}
                {m.response.mode === "fallback" && <Badge tone="amber">Fallback · no model</Badge>}
              </span>
              <p>{m.content}</p>
              {m.response.notice && <p className="bubble-notice">{m.response.notice}</p>}
              {m.response.trace.length > 0 && (
                <p className="bubble-tools">Used {[...new Set(m.response.trace.map((t) => t.tool))].join(" · ")}</p>
              )}
              {(m.response.proposedOrderIds ?? []).map((id) => (
                <button key={id} type="button" className="pill small bubble-review" onClick={() => onReviewOrder(id)}>
                  Review proposed order
                </button>
              ))}
            </div>
          ),
        )}
        {pending && (
          <div className="bubble assistant typing" role="status">
            <span className="sr-only">The {current.name.toLowerCase()} is working…</span>
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
          Message the {current.name.toLowerCase()}
        </label>
        <input
          id="trade-ask"
          value={input}
          maxLength={4000}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask the ${current.name.toLowerCase()} about ${symbol}…`}
        />
        <button type="submit" aria-label="Send" disabled={pending || !input.trim()}>
          <ArrowUp size={16} weight="bold" aria-hidden />
        </button>
      </form>
      <p className="assistant-foot">
        Agents read your synthetic data. Only the Trade drafter can propose orders, and only you can approve them.
      </p>
    </aside>
  );
}
