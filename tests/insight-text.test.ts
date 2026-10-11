// The monitoring cards show a short lede and keep everything else behind "Details".
import { describe, expect, it } from "vitest";
import { splitInsightBody } from "@/app/components/insightText";

describe("splitInsightBody", () => {
  it("keeps two short sentences and moves the advisory fine print to details", () => {
    const body =
      "You spent $28.75 at Bean There in the last 30 days (typical ticket $5.75). Cutting it by half would save " +
      "about $174.90 a year. Prepared automatically by deterministic rules over synthetic data and simulated " +
      "prices. General information, not financial, tax or investment advice. Your assistant can't move money, " +
      "propose, approve or trade.";
    const { lede, more } = splitInsightBody(body);
    expect(lede).toBe(
      "You spent $28.75 at Bean There in the last 30 days (typical ticket $5.75). Cutting it by half would save about $174.90 a year.",
    );
    expect(more).toMatch(/^Prepared automatically/);
    expect(more).toMatch(/can't move money/);
  });

  it("puts advice and advisory paragraphs in details, in order", () => {
    const body =
      "1 message or document at 02:37 UTC tried to instruct the assistant (asks to follow embedded instructions). " +
      "The assistant drafted no proposal in response.\n\nWhat you can do: Review any assistant proposal carefully." +
      "\n\nAdvisory only: the threat monitor cannot pause, hold, approve or execute anything.";
    const { lede, more } = splitInsightBody(body);
    expect(lede).toMatch(/^1 message or document .* in response\.$/);
    expect(more.split("\n\n")).toEqual([
      "What you can do: Review any assistant proposal carefully.",
      "Advisory only: the threat monitor cannot pause, hold, approve or execute anything.",
    ]);
  });

  it("stops the lede at a sentence that would overflow two lines, keeping reading order", () => {
    const body =
      "Your monthly StreamFlix charge rose by $7.50 on the latest charge after 3 steady charges. Review the " +
      "subscription with the merchant if this wasn't expected; Onera does not cancel subscriptions. Short note.";
    const { lede, more } = splitInsightBody(body);
    expect(lede).toBe("Your monthly StreamFlix charge rose by $7.50 on the latest charge after 3 steady charges.");
    expect(more).toMatch(/^Review the subscription .* Short note\.$/);
  });

  it("summarises bulleted signals by the first one", () => {
    const body = "• New recipient\n• Amount 4× your usual\n\nAdvisory only: the security sentinel cannot hold.";
    const { lede, more } = splitInsightBody(body);
    expect(lede).toBe("New recipient (+1 more)");
    expect(more).toBe("• Amount 4× your usual\n\nAdvisory only: the security sentinel cannot hold.");
  });

  it("never drops text: lede plus details cover every sentence", () => {
    const body = "Informational, not investment advice. VTI moved from $1.00 to $2.00.";
    const { lede, more } = splitInsightBody(body);
    expect(lede).toBe("VTI moved from $1.00 to $2.00.");
    expect(more).toBe("Informational, not investment advice.");
  });
});
