import { describe, expect, it } from "vitest";
import { LruCache } from "../../../src/shared/lru-cache";

describe("LruCache", () => {
  it("evicts the least recently used entry at capacity", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("first", 1);
    cache.set("second", 2);

    expect(cache.get("first")).toBe(1);
    cache.set("third", 3);

    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(1);
    expect(cache.get("third")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("refreshes recency for membership checks and updates", () => {
    const cache = new LruCache<string, boolean>(2);
    cache.set("first", true);
    cache.set("second", true);
    expect(cache.has("first")).toBe(true);
    cache.set("second", false);
    cache.set("third", true);

    expect(cache.has("first")).toBe(false);
    expect(cache.get("second")).toBe(false);
  });

  it("rejects invalid capacities", () => {
    expect(() => new LruCache(0)).toThrow("LRU_CACHE_CAPACITY_INVALID");
    expect(() => new LruCache(1.5)).toThrow("LRU_CACHE_CAPACITY_INVALID");
  });
});
