import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ServiceError } from "@/lib/errors";
import type { ApiError } from "@/lib/types";

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

/** Wraps a route handler so thrown errors become the standard error envelope. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
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
