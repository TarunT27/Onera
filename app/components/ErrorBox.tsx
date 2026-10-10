"use client";

import { ApiRequestError, errorMessage } from "./api";

/**
 * Shows the server's exact refusal. For API errors the status + code is
 * emphasized (e.g. "409 INVALID_STATE") followed by the server message.
 */
export function ErrorBox({
  error,
  title,
  onDismiss,
  onRetry,
  className = "",
}: {
  error: unknown;
  title?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  if (error === null || error === undefined || error === false) return null;
  const isApi = error instanceof ApiRequestError;
  return (
    <div
      role="alert"
      className={`min-w-0 rounded-2xl bg-red-400/10 px-4 py-3 text-sm text-red-100 shadow-[inset_0_0_0_1px_rgb(248_113_113/0.2)] ${className}`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 font-bold">
          ✕
        </span>
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {isApi ? (
            <p className="break-words">
              <code className="mr-1.5 rounded-md bg-red-400/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-red-100">
                {error.status > 0 ? `${error.status} ${error.code}` : error.code}
              </code>
              {error.serverMessage}
            </p>
          ) : (
            <p className="break-words">{errorMessage(error)}</p>
          )}
          {(onRetry || onDismiss) && (
            <div className="mt-2 flex gap-3 text-xs font-medium">
              {onRetry && (
                <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:no-underline">
                  Retry
                </button>
              )}
              {onDismiss && (
                <button type="button" onClick={onDismiss} className="underline underline-offset-2 hover:no-underline">
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
