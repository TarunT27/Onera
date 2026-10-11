import { describe, expect, it, vi } from "vitest";
import { createDisplayCache } from "../app/components/readCache";

describe("session-scoped display snapshots", () => {
  it("expires after 30 seconds but still revalidates warm reads", async () => {
    let now = 0;
    const cache = createDisplayCache(() => now);
    cache.setSession("alice");
    await cache.load("/api/accounts", async () => ({ balance: 100 }));
    now = 29_999;
    expect(cache.peek("/api/accounts")).toEqual({ balance: 100 });
    const refresh = vi.fn(async () => ({ balance: 200 }));
    await cache.load("/api/accounts", refresh);
    expect(refresh).toHaveBeenCalledOnce();
    now += 30_000;
    expect(cache.peek("/api/accounts")).toBeNull();
  });

  it("deduplicates concurrent GETs, not subsequent refreshes", async () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    const read = vi.fn(async () => [1]);
    const first = cache.load("/api/accounts", read);
    const second = cache.load("/api/accounts", read);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    await cache.load("/api/accounts", read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("separates accounts and batch sizes by the full request path", () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    cache.save("/api/transactions?accountId=a&limit=16", ["a"]);
    expect(cache.peek("/api/transactions?accountId=b&limit=16")).toBeNull();
    expect(cache.peek("/api/transactions?accountId=a&limit=32")).toBeNull();
  });

  it("does not retain data before server identity is known or cache governance state", () => {
    const cache = createDisplayCache();
    cache.save("/api/accounts", ["a"]);
    expect(cache.peek("/api/accounts")).toBeNull();
    cache.setSession("alice");
    for (const path of ["/api/actions", "/api/actions/a", "/api/controls", "/api/recipients", "/api/audit", "/api/session"]) {
      cache.save(path, { approved: true });
      expect(cache.peek(path)).toBeNull();
    }
  });

  it("clears private snapshots and mounted views on a server session change", () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    cache.save("/api/accounts", ["alice account"]);
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.setSession("bob");
    expect(cache.peek("/api/accounts")).toBeNull();
    expect(listener).toHaveBeenCalledWith(true);
  });

  it("a write invalidation prevents old in-flight reads from repopulating the cache", async () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    let resolve!: (value: string[]) => void;
    const oldRead = cache.load("/api/accounts", () => new Promise<string[]>((done) => { resolve = done; }));
    await Promise.resolve();
    cache.invalidate();
    resolve(["old balance"]);
    await oldRead;
    expect(cache.peek("/api/accounts")).toBeNull();
    await cache.load("/api/accounts", async () => ["new balance"]);
    expect(cache.peek("/api/accounts")).toEqual(["new balance"]);
  });

  it("does not cache errors or leave rejected GETs stuck", async () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    await expect(cache.load("/api/accounts", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(cache.peek("/api/accounts")).toBeNull();
    await expect(cache.load("/api/accounts", async () => ["recovered"])).resolves.toEqual(["recovered"]);
  });

  it("bounds memory to 64 snapshots", () => {
    const cache = createDisplayCache();
    cache.setSession("alice");
    for (let i = 0; i < 65; i++) cache.save(`/api/transactions?accountId=${i}`, [i]);
    expect(cache.peek("/api/transactions?accountId=0")).toBeNull();
    expect(cache.peek("/api/transactions?accountId=64")).toEqual([64]);
  });
});
