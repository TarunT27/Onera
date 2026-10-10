import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/session";
import type { ApiError, ApiErrorCode } from "@/lib/types";

export function errorResponse(err: unknown): NextResponse<ApiError> {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid request", details: err.issues } },
      { status: 400 },
    );
  }
  console.error("[clearfi] unhandled error", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

/** Refusals the threat monitor reads from the audit log (lib/agents/monitors/threats.ts). */
export const AUDITED_REFUSALS: ReadonlySet<ApiErrorCode> = new Set([
  "NOT_FOUND", "INVALID_STATE", "STALE_VERSION", "APPROVAL_INVALID", "POLICY_HOLD",
]);

/**
 * Records a refused request as `request.refused` under the caller's own session user. Runs outside any service
 * transaction, so the record survives the rollback. Stores only the caller's method and path: never whether a
 * record exists or who owns it. Best effort — a failure here never changes the response.
 */
async function auditRefusal(req: unknown, err: ServiceError): Promise<void> {
  if (!AUDITED_REFUSALS.has(err.code) || !(req instanceof Request)) return;
  try {
    const userId = await getSessionUserId();
    writeAudit(getDb(), {
      userId, actor: `user:${userId}`, eventType: "request.refused",
      detail: { code: err.code, status: err.status, method: req.method, path: new URL(req.url).pathname },
    });
  } catch (auditErr) {
    console.error("[clearfi] could not audit refused request", auditErr);
  }
}

/** Wraps a route handler so thrown errors become the standard error envelope. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ServiceError) await auditRefusal(args[0], err);
      return errorResponse(err);
    }
  };
}

/** Parses a JSON body; an empty body is treated as {}. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError("BAD_REQUEST", "Body must be valid JSON", 400);
  }
}
