import { afterEach, describe, expect, it } from "vitest";
import type { NewAsset } from "../../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

let database: RefCanvasDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createAsset(index: number): NewAsset {
  return {
    title: `Asset ${index}`,
    kind: "image",
    path: `D:\\references\\asset-${index}.png`,
    pathKey: `d:\\references\\asset-${index}.png`,
    extension: "png",
    size: 1024,
    mtimeMs: index,
    fingerprint: `fingerprint-${index}`,
    linkState: "online",
    notes: "",
    width: 1920,
    height: 1080,
    duration: null,
  };
}

describe("SPEC-4 bounded memory iteration", () => {
  it("forEachActiveAsset visits every active asset in small batches", async () => {
    database = new RefCanvasDatabase(":memory:");
    for (let index = 0; index < 25; index += 1) {
      database.upsertAsset(createAsset(index));
    }
    const batches: number[] = [];
    let total = 0;
    await database.forEachActiveAsset(7, (assets) => {
      batches.push(assets.length);
      total += assets.length;
    });
    expect(total).toBe(25);
    // 每批不超过 7 条（最后一批可少）。
    expect(Math.max(...batches)).toBeLessThanOrEqual(7);
    expect(batches.length).toBeGreaterThan(1);
  });

  it("forEachSelectionId visits all ids in query mode without materializing", async () => {
    database = new RefCanvasDatabase(":memory:");
    for (let index = 0; index < 20; index += 1) {
      database.upsertAsset(createAsset(index));
    }
    const seen: string[] = [];
    await database.forEachSelectionId(
      { mode: "query", query: { lifecycle: "active" }, excludedIds: [] },
      6,
      (ids) => { seen.push(...ids); },
    );
    expect(seen.length).toBe(20);
    // 去重且唯一。
    expect(new Set(seen).size).toBe(20);
  });

  it("forEachSelectionId honors excludedIds", async () => {
    database = new RefCanvasDatabase(":memory:");
    const created: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      created.push(database.upsertAsset(createAsset(index)).asset.id);
    }
    const excluded = new Set(created.slice(0, 3));
    const seen: string[] = [];
    await database.forEachSelectionId(
      { mode: "query", query: { lifecycle: "active" }, excludedIds: [...excluded] },
      4,
      (ids) => { seen.push(...ids); },
    );
    expect(seen.length).toBe(7);
    for (const id of seen) expect(excluded.has(id)).toBe(false);
  });

  it("batchRenamePaged renames every selected asset", async () => {
    database = new RefCanvasDatabase(":memory:");
    for (let index = 0; index < 12; index += 1) {
      database.upsertAsset(createAsset(index));
    }
    const count = await database.batchRenamePaged(
      { mode: "query", query: { lifecycle: "active" }, excludedIds: [] },
      "Renamed {index}",
    );
    expect(count).toBe(12);
    const titles = database.searchAssets({
      lifecycle: "active",
      pageSize: 50,
    }).items.map((item) => item.title);
    expect(titles.every((title) => title.startsWith("Renamed "))).toBe(true);
  });
});
