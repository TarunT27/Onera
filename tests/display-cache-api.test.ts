import { afterEach, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../app/components/api";
import { displayCache } from "../app/components/readCache";

afterEach(() => { vi.unstubAllGlobals(); displayCache.invalidate(false); });

it("keeps HTTP reads no-store while snapshots stay memory-only", async () => {
  const fetchMock = vi.fn(async () => Response.json({ accounts: [] }));
  vi.stubGlobal("fetch", fetchMock);
  await api.get("/api/accounts");
  expect(fetchMock).toHaveBeenCalledWith("/api/accounts", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});

it("invalidates display data even when a state-changing request is refused", async () => {
  displayCache.setSession("alice");
  displayCache.save("/api/accounts", { balance: 1 });
  const fetchMock = vi.fn(async () => Response.json({ error: { code: "INVALID_STATE", message: "Action is HELD" } }, { status: 409 }));
  vi.stubGlobal("fetch", fetchMock);
  const listener = vi.fn();
  const unsubscribe = displayCache.subscribe(listener);
  try {
    await expect(api.post("/api/actions/a/execute")).rejects.toBeInstanceOf(ApiRequestError);
    expect(displayCache.peek("/api/accounts")).toBeNull();
    expect(listener).toHaveBeenCalledWith(false);
  } finally { unsubscribe(); }
});

it("never deduplicates or caches writes", async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  await Promise.all([api.post("/api/actions/a/execute"), api.post("/api/actions/a/execute")]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
