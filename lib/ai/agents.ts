/**
 * Assistant agents: the same model with a narrower tool set and a short brief.
 *
 * The tool set is enforced twice: only these tools are sent to the model, and
 * runTool refuses anything outside ToolContext.allowedTools. The brief only
 * shapes the answer; it grants nothing.
 *
 * Only the Trade drafter can propose paper orders. No agent can approve,
 * execute, change limits or pause.
 */
import type { AssistantAgentId } from "@/lib/types";
import { TOOL_DEFINITIONS } from "./tools";
import { msg } from "@/lib/i18n/msg";

const ALL_TOOLS = TOOL_DEFINITIONS.map((t) => t.name);

export interface AssistantAgent {
  id: AssistantAgentId;
  name: string;
  tools: readonly string[];
  brief: string;
}

export const ASSISTANT_AGENT_DEFINITIONS: Record<AssistantAgentId, AssistantAgent> = {
  general: {
    id: "general",
    name: msg("Onera assistant"),
    // Everything except paper-order proposals, which belong to the Trade drafter.
    tools: ALL_TOOLS.filter((t) => t !== "propose_order"),
    brief: "You are the general Onera assistant. If the user asks you to place a paper trade, tell them to pick the Trade drafter on the Trade page.",
  },
  research: {
    id: "research",
    name: msg("Research analyst"),
    tools: ["get_quotes", "get_price_history", "get_research_document"],
    brief:
      "You are the Research analyst. Explain what a company or fund is and summarize research documents, citing the document. Separate facts, interpretation and risks. General information, not personal advice. You cannot propose or place orders.",
  },
  chart: {
    id: "chart",
    name: msg("Chart reader"),
    tools: ["get_quotes", "get_price_history"],
    brief:
      "You are the Chart reader. Describe trend, range and volatility from get_price_history with exact numbers. Always say this describes the past and is not a forecast. You cannot propose or place orders.",
  },
  risk: {
    id: "risk",
    name: msg("Risk checker"),
    tools: ["get_portfolio", "get_quotes", "get_trading_controls", "get_agent_insights"],
    brief:
      "You are the Risk checker. Describe concentration (weightPct), what a proposed trade would change, and how it sits against the user's per-order and daily limits. Keep paper and real holdings separate. You cannot propose or place orders.",
  },
  drafter: {
    id: "drafter",
    name: msg("Trade drafter"),
    tools: ["get_portfolio", "get_quotes", "get_trading_controls", "propose_order"],
    brief:
      "You are the Trade drafter. When the user asks for a paper trade, find their tradable paper account with get_portfolio and call propose_order with the exact symbol, side and size they gave. Never pick a trade they did not ask for. After proposing, say whether it is awaiting approval or held (and why), and that they must approve it in the app. You cannot approve or execute.",
  },
};

export function assistantAgent(id: AssistantAgentId | undefined): AssistantAgent {
  return ASSISTANT_AGENT_DEFINITIONS[id ?? "general"];
}
