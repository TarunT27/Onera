import { afterEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { fallbackReply } from "@/lib/ai/fallback";
import { runChat } from "@/lib/ai/chat";
import type { ChatRequest } from "@/lib/types";
import { freshDb } from "./helpers";

const question = (content: string): ChatRequest => ({ messages: [{ role: "user", content }] });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chat fallback", () => {
  it("treats historical transfer questions as read-only questions", () => {
    const response = fallbackReply(freshDb(), "alice", question("How much did I send last month?"), "Offline.");

    expect(response.reply).not.toContain("can't draft that transfer");
    expect(response.trace.map((entry) => entry.tool)).toEqual([
      "get_spending_summary",
      "get_subscription_insights",
      "get_agent_insights",
    ]);
  });

  it("writes the fallback reply in the language the UI asked for", async () => {
    vi.stubEnv("CLEARFI_AI_MODE", "fallback");
    const spanish = await runChat(freshDb(), "alice", { ...question("How is my spending?"), locale: "es" });
    const english = await runChat(freshDb(), "alice", question("How is my spending?"));

    expect(english.reply).toContain("Spending in");
    expect(spanish.reply).not.toContain("Spending in");
    expect(spanish.reply).toContain("hasta ahora");
    expect(spanish.notice).not.toContain("Showing a deterministic summary");
    // Amounts and record IDs are not translated.
    expect(spanish.reply).toMatch(/\$[\d,]+\.\d{2}/);
  });

  it("acknowledges proposals created before the model became unavailable", () => {
    const response = fallbackReply(
      freshDb(),
      "alice",
      question("Pay Oak Street Properties $1,850 for rent"),
      "Rate limited.",
      ["act_existing"],
    );

    expect(response.reply).toMatch(/proposal was created/i);
    expect(response.reply).not.toContain("can't draft that transfer");
    expect(response.proposedActionIds).toEqual(["act_existing"]);
  });

  it("audits forced fallback prompts and replies", async () => {
    vi.stubEnv("CLEARFI_AI_MODE", "fallback");
    const db = freshDb();

    const response = await runChat(db, "alice", question("What changed in my spending?"));
    const eventTypes = listAudit(db, "alice").map((event) => event.eventType);

    expect(response.mode).toBe("fallback");
    expect(eventTypes).toContain("assistant.prompt");
    expect(eventTypes).toContain("assistant.reply");
  });
});
