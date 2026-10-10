import type { ApiErrorCode } from "@/lib/types";

/** Domain error with an HTTP mapping. Thrown by services, rendered by routes. */
export class ServiceError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what: string) => new ServiceError("NOT_FOUND", `${what} not found`, 404);
export const badRequest = (message: string, details?: unknown) =>
  new ServiceError("BAD_REQUEST", message, 400, details);
export const conflict = (code: ApiErrorCode, message: string, details?: unknown) =>
  new ServiceError(code, message, 409, details);
