/**
 * Tiny typed fetch helper for the Onera HTTP API (see docs/API.md).
 *
 * The UI talks to the server ONLY through these calls. Failures throw an
 * ApiRequestError whose message mirrors the server's refusal exactly, e.g.
 * "409 INVALID_STATE: Action is HELD".
 */
import type {
  Account,
  ApiErrorCode,
  AuditEvent,
  ChatRequest,
  ChatResponse,
  CreateTransferInput,
  EditTransferInput,
  ExecutionReceipt,
  NetWorth,
  Recipient,
  RecipientStatus,
  SpendingSummary,
  SubscriptionIncrease,
  Transaction,
  TransferAction,
  UpdateControlsInput,
  UserControls,
  UserId,
} from "@/lib/types";
// Type-only: erased at build time, so no server code reaches the client bundle.
import type {
  AgentDefinition,
  AgentRun,
  AgentsLive,
  Insight,
  PermissionRow,
  RunReport,
  ScheduleReport,
} from "@/lib/agents";
import type { CardCharge, FamilyCard, FamilyOverview, SimulatePurchaseInput, UpdateCardInput } from "@/lib/family";
import { displayCache } from "./readCache";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ClientErrorCode = ApiErrorCode | "NETWORK" | "BAD_RESPONSE";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly serverMessage: string;
  readonly details?: unknown;

  constructor(status: number, code: ClientErrorCode, serverMessage: string, details?: unknown) {
    super(status > 0 ? `${status} ${code}: ${serverMessage}` : `${code}: ${serverMessage}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
    this.details = details;
  }
}

function isErrorEnvelope(v: unknown): v is { error: { code: ApiErrorCode; message: string; details?: unknown } } {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e = (v as { error: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PATCH";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (method === "GET") {
    const result = await fetchJson<T>(method, path, body);
    if (path === "/api/session") {
      displayCache.setSession((result as SessionResponse).user.id);
    }
    return result;
  }
  // A failed write may still change state (e.g. a refusal can hold a transfer).
  displayCache.invalidate(false);
  try {
    return await fetchJson<T>(method, path, body);
  } finally {
    displayCache.invalidate(true, path === "/api/session" || path === "/api/demo/reset");
  }
}

async function fetchJson<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiRequestError(0, "NETWORK", err instanceof Error ? err.message : "Network request failed");
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    if (isErrorEnvelope(json)) {
      throw new ApiRequestError(res.status, json.error.code, json.error.message, json.error.details);
    }
    const fallbackCode: ClientErrorCode = res.status === 404 ? "NOT_FOUND" : res.status === 400 ? "BAD_REQUEST" : "INTERNAL";
    throw new ApiRequestError(
      res.status,
      fallbackCode,
      json === undefined ? `${method} ${path} returned a non-JSON response (${res.statusText || "error"})` : res.statusText || "Request failed",
    );
  }

  if (json === undefined) {
    throw new ApiRequestError(res.status, "BAD_RESPONSE", `${method} ${path} returned an empty or non-JSON body`);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};

// ---------------------------------------------------------------------------
// Response shapes (mirrors docs/API.md)
// ---------------------------------------------------------------------------

export interface DemoUser {
  id: UserId;
  name: string;
}
export interface SessionResponse {
  user: DemoUser;
  users: DemoUser[];
}
export interface AccountsResponse {
  accounts: Account[];
  netWorthCents: number;
  /** Dated demo FX metadata already returned by the server. */
  netWorth?: NetWorth;
  asOf: string;
}
export interface TransactionsResponse {
  transactions: Transaction[];
}
export interface InsightsResponse {
  spending: SpendingSummary;
  subscriptions: SubscriptionIncrease[];
  evidence: Record<string, Transaction>;
}
export type RecipientWithStatus = Recipient & { status: RecipientStatus };
export interface RecipientsResponse {
  recipients: RecipientWithStatus[];
}
export interface ResearchDocument {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  synthetic: true;
  untrusted: true;
}
export interface ResearchResponse {
  documents: ResearchDocument[];
}
export interface ControlsResponse {
  controls: UserControls;
  usage: { executedTodayCents: number };
}
export interface AuditResponse {
  events: AuditEvent[];
}
export interface ActionsResponse {
  actions: TransferAction[];
}
export interface ActionResponse {
  action: TransferAction;
}
export interface ActionDetailResponse {
  action: TransferAction;
  recipient: RecipientWithStatus;
  sourceAccount: Account;
}
export interface AgentsResponse {
  agents: (AgentDefinition & { lastRun: AgentRun | null })[];
  permissions: PermissionRow[];
  notice: string;
}
export interface AgentInsightsResponse {
  insights: Insight[];
}
export interface AgentRunResponse {
  scheduled: ScheduleReport;
  report: RunReport;
  insights: Insight[];
}
export type { Insight as AgentInsight };
export type AgentsLiveResponse = AgentsLive;
export interface ExecuteResponse {
  action: TransferAction;
  receipt: ExecutionReceipt;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export const paths = {
  session: "/api/session",
  accounts: "/api/accounts",
  transactions: (opts: { accountId?: string; limit?: number } = {}) => withQuery("/api/transactions", opts),
  insights: "/api/insights",
  recipients: "/api/recipients",
  research: "/api/research",
  controls: "/api/controls",
  audit: (opts: { actionId?: string; limit?: number } = {}) => withQuery("/api/audit", opts),
  actions: "/api/actions",
  action: (id: string) => `/api/actions/${enc(id)}`,
  agents: "/api/agents",
  agentInsights: "/api/agents/insights",
  agentsLive: "/api/agents/live",
  family: "/api/family",
};

export const clearfi = {
  getSession: () => api.get<SessionResponse>(paths.session),
  setSession: (userId: UserId) => api.post<SessionResponse>(paths.session, { userId }),
  resetDemo: () => api.post<{ ok: true }>("/api/demo/reset"),

  createTransfer: (input: CreateTransferInput) => api.post<ActionResponse>(paths.actions, input),
  getAction: (id: string) => api.get<ActionDetailResponse>(paths.action(id)),
  editAction: (id: string, input: EditTransferInput) => api.patch<ActionResponse>(paths.action(id), input),
  evaluateAction: (id: string) => api.post<ActionResponse>(`${paths.action(id)}/evaluate`),
  approveAction: (id: string, version: number) => api.post<ActionResponse>(`${paths.action(id)}/approve`, { version }),
  executeAction: (id: string) => api.post<ExecuteResponse>(`${paths.action(id)}/execute`),
  verifyRecipient: (id: string) => api.post<{ recipient: RecipientWithStatus }>(`/api/recipients/${enc(id)}/verify`),

  updateControls: (input: UpdateControlsInput) => api.patch<{ controls: UserControls }>(paths.controls, input),

  chat: (req: ChatRequest) => api.post<ChatResponse>("/api/chat", req),

  // Monitoring agents are advisory: these calls only run read-only monitors and
  // mark their findings. Nothing here approves, executes or changes controls.
  runAgents: () => api.post<AgentRunResponse>("/api/agents/run"),
  setInsightStatus: (id: string, status: "seen" | "dismissed") =>
    api.patch<{ insight: Insight }>(`/api/agents/insights/${enc(id)}`, { status }),

  // Family cards: parent-only controls and simulated purchases.
  updateFamilyCard: (id: string, input: UpdateCardInput) =>
    api.patch<{ card: FamilyCard }>(`/api/family/cards/${enc(id)}`, input),
  simulateFamilyPurchase: (id: string, input: SimulatePurchaseInput) =>
    api.post<{ charge: CardCharge; card: FamilyCard }>(`/api/family/cards/${enc(id)}/simulate`, input),
};

export type { CardCharge, FamilyCard, FamilyOverview };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong";
}
