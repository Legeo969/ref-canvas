import { afterEach, describe, expect, it } from "vitest";
import type { NewAsset } from "../../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

let database: RefCanvasDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createAsset(overrides: Partial<NewAsset> = {}): NewAsset {
  return {
    title: "Temple Reference",
    kind: "image",
    path: "D:\\references\\temple.png",
    pathKey: "d:\\references\\temple.png",
    extension: "png",
    size: 1024,
    mtimeMs: 1234,
    fingerprint: "fingerprint",
    linkState: "online",
    notes: "misty architecture",
    width: 1920,
    height: 1080,
    duration: null,
    ...overrides,
  };
}

describe("RefCanvasDatabase", () => {
  it("stores general, timecode, and frame-linked notes for every asset", () => {
    database = new RefCanvasDatabase(":memory:");
    const asset = database.upsertAsset(createAsset()).asset;
    const general = database.createMediaNote(asset.id, {
      positionKind: "general",
      position: 0,
      text: "General review",
    });
    const frame = database.createMediaNote(asset.id, {
      positionKind: "frame",
      position: 120,
      text: "Fix edge",
    });

    expect(general).toMatchObject({ positionKind: "general", position: 0 });
    expect(frame).toMatchObject({ positionKind: "frame", position: 120 });
    expect(database.listMediaNotes(asset.id)).toEqual([
      expect.objectContaining({ id: general.id, positionKind: "general" }),
      expect.objectContaining({ id: frame.id, positionKind: "frame", position: 120 }),
    ]);
  });

  describe("visual signature identity", () => {
    const signature = {
      visualHash: "0123456789abcdef",
      colorSignature: "1020304050607080",
      dominantColor: { r: 16, g: 32, b: 48 },
    };

    it("preserves a signature for metadata refreshes and same-path renames", () => {
      database = new RefCanvasDatabase(":memory:");
      const original = database.upsertAsset(createAsset()).asset;
      database.setVisualSignature(
        original.id,
        signature.visualHash,
        signature.colorSignature,
        signature.dominantColor,
      );

      database.upsertAsset(createAsset({
        title: "Renamed without changing content",
        notes: "metadata refreshed",
        mtimeMs: 9999,
        width: 2048,
      }));

      expect(database.getVisualSignature(original.id)).toEqual({
        visualHash: signature.visualHash,
        colorSignature: signature.colorSignature,
      });
      expect(database.listImagesMissingVisualIndex()).toEqual([]);
    });

    it.each([
      ["size", { size: 2048 }],
      ["fingerprint", { fingerprint: "changed" }],
    ])("clears a signature when %s changes", (_label, change) => {
      database = new RefCanvasDatabase(":memory:");
      const original = database.upsertAsset(createAsset()).asset;
      database.setVisualSignature(
        original.id,
        signature.visualHash,
        signature.colorSignature,
        signature.dominantColor,
      );

      database.upsertAsset(createAsset(change));

      expect(database.getVisualSignature(original.id)).toBeNull();
      expect(database.listImagesMissingVisualIndex()).toEqual([
        { id: original.id, path: original.path },
      ]);
    });

    it("preserves same-content relinks and invalidates changed-content relinks", () => {
      database = new RefCanvasDatabase(":memory:");
      const original = database.upsertAsset(createAsset()).asset;
      database.setVisualSignature(
        original.id,
        signature.visualHash,
        signature.colorSignature,
        signature.dominantColor,
      );

      database.relinkAsset(original.id, createAsset({
        path: "E:\\moved\\temple.png",
        pathKey: "e:\\moved\\temple.png",
      }));
      expect(database.getVisualSignature(original.id)?.visualHash).toBe(
        signature.visualHash,
      );

      database.relinkAsset(original.id, createAsset({
        path: "F:\\replaced\\temple.png",
        pathKey: "f:\\replaced\\temple.png",
        fingerprint: "replacement",
      }));
      expect(database.getVisualSignature(original.id)).toBeNull();
    });

    it("applies identity rules atomically in bulk upserts", () => {
      database = new RefCanvasDatabase(":memory:");
      const firstInput = createAsset();
      const secondInput = createAsset({
        path: "D:\\references\\second.png",
        pathKey: "d:\\references\\second.png",
      });
      const [first, second] = database.upsertAssets([firstInput, secondInput]);
      for (const result of [first, second]) {
        database.setVisualSignature(
          result.asset.id,
          signature.visualHash,
          signature.colorSignature,
          signature.dominantColor,
        );
      }

      database.upsertAssets([
        { ...firstInput, title: "Metadata only" },
        { ...secondInput, size: secondInput.size + 1 },
      ]);

      expect(database.getVisualSignature(first.asset.id)).not.toBeNull();
      expect(database.getVisualSignature(second.asset.id)).toBeNull();
    });

    it("uses a supplied fresh signature instead of clearing it", () => {
      database = new RefCanvasDatabase(":memory:");
      const original = database.upsertAsset(createAsset()).asset;
      database.setVisualSignature(original.id, "old", "old", { r: 1, g: 2, b: 3 });

      database.upsertAsset(createAsset({
        fingerprint: "new-content",
        ...signature,
      }));

      expect(database.getVisualSignature(original.id)).toEqual({
        visualHash: signature.visualHash,
        colorSignature: signature.colorSignature,
      });
      expect(database.listImagesMissingVisualIndex()).toEqual([]);
    });
  });

  it("reuses an asset imported from the same normalized path", () => {
    database = new RefCanvasDatabase(":memory:");
    const first = database.upsertAsset(createAsset());
    const second = database.upsertAsset(
      createAsset({ title: "Updated title" }),
    );

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.title).toBe("Updated title");
  });

  it("searches indexed titles and notes", () => {
    database = new RefCanvasDatabase(":memory:");
    database.upsertAsset(createAsset());

    expect(database.searchAssets({ query: "Temple" }).items).toHaveLength(1);
    expect(database.searchAssets({ query: "misty" }).items).toHaveLength(1);
    expect(database.searchAssets({ query: "spaceship" }).items).toHaveLength(0);
  });

  it("searches offset windows and batch-hydrates page relations", () => {
    database = new RefCanvasDatabase(":memory:");
    const first = database.upsertAsset(createAsset({ title: "A" })).asset;
    const second = database.upsertAsset(createAsset({
      title: "B",
      path: "D:\\references\\b.png",
      pathKey: "d:\\references\\b.png",
    })).asset;
    database.upsertAsset(createAsset({
      title: "C",
      path: "D:\\references\\c.png",
      pathKey: "d:\\references\\c.png",
    }));
    database.setAssetTags(second.id, ["hydrated"]);

    const firstWindow = database.searchAssetWindow({
      query: { sort: "title", direction: "asc" },
      offset: 1,
      pageSize: 2,
      includeTotal: true,
    });
    expect(firstWindow.total).toBe(3);
    expect(firstWindow.items.map((asset) => asset.title)).toEqual(["B", "C"]);
    expect(firstWindow.items[0]).toMatchObject({
      tags: ["hydrated"],
    });

    expect(database.searchAssetWindow({
      query: {},
      offset: 0,
      pageSize: 1,
      includeTotal: false,
    }).total).toBeNull();
    expect(database.getAsset(first.id)?.title).toBe("A");
  });

  it("persists spatial image annotations and includes their text in search", () => {
    database = new RefCanvasDatabase(":memory:");
    const asset = database.upsertAsset(createAsset()).asset;
    const annotation = database.createAssetAnnotation(asset.id, {
      x: 0.25,
      y: 0.75,
      text: "屋檐的青色反光",
    });

    expect(database.listAssetAnnotations(asset.id)).toEqual([annotation]);
    expect(database.searchAssets({ query: "青色反光" }).items[0]?.id).toBe(
      asset.id,
    );

    const updated = database.updateAssetAnnotation(annotation.id, {
      text: "塔楼需要降低对比度",
    });
    expect(updated).toMatchObject({
      x: 0.25,
      y: 0.75,
      text: "塔楼需要降低对比度",
    });
    expect(database.searchAssets({ query: "青色反光" }).items).toHaveLength(0);
    expect(database.searchAssets({ query: "降低对比度" }).items[0]?.id).toBe(
      asset.id,
    );

    database.deleteAssetAnnotation(annotation.id);
    expect(database.listAssetAnnotations(asset.id)).toEqual([]);
    expect(database.searchAssets({ query: "降低对比度" }).items).toHaveLength(0);
  });

  it("combines file size, dimensions, and media duration filters", () => {
    database = new RefCanvasDatabase(":memory:");
    database.upsertAsset(
      createAsset({
        title: "Short clip",
        path: "D:\\references\\short.mp4",
        pathKey: "d:\\references\\short.mp4",
        kind: "video",
        extension: "mp4",
        size: 5 * 1024 * 1024,
        width: 1920,
        height: 1080,
        duration: 12,
      }),
    );
    database.upsertAsset(
      createAsset({
        title: "Long clip",
        path: "D:\\references\\long.mp4",
        pathKey: "d:\\references\\long.mp4",
        kind: "video",
        extension: "mp4",
        size: 50 * 1024 * 1024,
        width: 3840,
        height: 2160,
        duration: 180,
      }),
    );

    expect(
      database.searchAssets({
        kind: "video",
        minSize: 4 * 1024 * 1024,
        maxSize: 10 * 1024 * 1024,
        minWidth: 1280,
        maxWidth: 2560,
        minDuration: 10,
        maxDuration: 30,
      }).items.map((asset) => asset.title),
    ).toEqual(["Short clip"]);
  });

  it("filters by extension, orientation, and file modification time", () => {
    database = new RefCanvasDatabase(":memory:");
    const changedAt = Date.parse("2026-06-15T12:00:00.000Z");
    database.upsertAsset(
      createAsset({
        title: "Square PNG",
        mtimeMs: changedAt,
        width: 1000,
        height: 990,
      }),
    );
    database.upsertAsset(
      createAsset({
        title: "Portrait JPG",
        path: "D:\\references\\portrait.jpg",
        pathKey: "d:\\references\\portrait.jpg",
        extension: "jpg",
        fingerprint: "portrait",
        mtimeMs: Date.parse("2025-01-01T00:00:00.000Z"),
        width: 900,
        height: 1600,
      }),
    );

    expect(
      database.searchAssets({
        extension: "PNG",
        orientation: "square",
        modifiedAfter: "2026-06-01T00:00:00.000Z",
        modifiedBefore: "2026-06-30T23:59:59.000Z",
      }).items.map((asset) => asset.title),
    ).toEqual(["Square PNG"]);
    expect(
      database.searchAssets({ orientation: "portrait" }).items.map(
        (asset) => asset.title,
      ),
    ).toEqual(["Portrait JPG"]);
  });

  it("creates and persists a versioned board document", () => {
    database = new RefCanvasDatabase(":memory:");
    const board = database.createBoard("Moodboard");
    const saved = database.saveBoard(board.id, {
      schemaVersion: 1,
      canvas: { version: "7.4.0", objects: [{ type: "rect" }] },
    });
    const loaded = database.loadBoard(board.id);
    const objects = loaded?.document.canvas.objects as unknown[];

    expect(saved.title).toBe("Moodboard");
    expect(loaded?.document.schemaVersion).toBe(3);
    expect(loaded?.document.windowMode).toBe("normal");
    expect(loaded?.document.canvasMode).toEqual({
      locked: false,
      grayscale: false,
      gridStyle: "line",
    });
    expect(loaded?.document.sampling).toBe("bilinear");
    expect(objects).toHaveLength(1);
    expect(loaded?.document.appearance).toEqual({
      backgroundColor: "#202426",
      gridVisible: true,
      gridSize: 24,
    });

    database.saveBoard(board.id, {
      ...loaded!.document,
      appearance: {
        backgroundColor: "#142033",
        gridVisible: false,
        gridSize: 36,
      },
    });
    expect(database.loadBoard(board.id)?.document.appearance).toEqual({
      backgroundColor: "#142033",
      gridVisible: false,
      gridSize: 36,
    });

    const second = database.createBoard("Second board");
    expect(database.renameBoard(second.id, "Renamed board").title).toBe(
      "Renamed board",
    );
    database.deleteBoard(second.id);
    expect(database.listBoards()).toHaveLength(1);
    expect(() => database!.deleteBoard(board.id)).toThrow(
      "LAST_BOARD_REQUIRED",
    );
  });

  it("rejects a stale board save instead of overwriting a newer document", () => {
    database = new RefCanvasDatabase(":memory:");
    const board = database.createBoard("Shared board");
    const firstWindow = database.loadBoard(board.id)!;
    const secondWindow = database.loadBoard(board.id)!;

    database.saveBoard(
      board.id,
      {
        ...firstWindow.document,
        canvas: { version: "7.4.0", objects: [{ type: "rect", left: 10 }] },
      },
      firstWindow.summary.revision,
    );

    expect(() => database!.saveBoard(
      board.id,
      {
        ...secondWindow.document,
        canvas: { version: "7.4.0", objects: [{ type: "circle", left: 20 }] },
      },
      secondWindow.summary.revision,
    )).toThrow("BOARD_CONFLICT");
    expect(database.loadBoard(board.id)?.document.canvas.objects).toEqual([
      { type: "rect", left: 10 },
    ]);
  });

  it("keeps monitored roots unique and relinks without changing asset identity", () => {
    database = new RefCanvasDatabase(":memory:");
    const original = database.upsertAsset(createAsset()).asset;
    const firstRoot = database.addWatchRoot("D:\\references");
    const secondRoot = database.addWatchRoot("D:\\references");
    const relinked = database.relinkAsset(
      original.id,
      createAsset({
        path: "E:\\moved\\temple.png",
        pathKey: "e:\\moved\\temple.png",
        fingerprint: "moved-fingerprint",
      }),
    );

    expect(secondRoot.id).toBe(firstRoot.id);
    expect(database.listWatchRoots()).toHaveLength(1);
    expect(database.removeWatchRoot(firstRoot.id)).toEqual(firstRoot);
    expect(database.listWatchRoots()).toHaveLength(0);
    expect(() => database!.removeWatchRoot(firstRoot.id)).toThrow(
      "WATCH_ROOT_NOT_FOUND",
    );
    expect(relinked.id).toBe(original.id);
    expect(relinked.title).toBe(original.title);
    expect(relinked.path).toBe("E:\\moved\\temple.png");
  });

  it("persists tags and reports global counts", () => {
    database = new RefCanvasDatabase(":memory:");
    const asset = database.upsertAsset(createAsset()).asset;
    database.setAssetTags(asset.id, ["mist", "temple", "mist"]);
    const updated = database.getAsset(asset.id)!;

    expect(updated.tags).toEqual(["mist", "temple"]);
    const mistTag = database.listTags().find((tag) => tag.name === "mist")!;
    expect(mistTag.assetCount).toBe(1);
    database.renameTag(mistTag.id, "fog");
    expect(database.getAsset(asset.id)?.tags).toContain("fog");
    database.deleteTag(mistTag.id);
    expect(database.getAsset(asset.id)?.tags).not.toContain("fog");
    expect(database.searchAssets({ tag: "temple" }).items).toHaveLength(1);
    expect(database.getLibraryStats()).toMatchObject({
      total: 1,
      missing: 0,
      byKind: { image: 1 },
    });
  });

  it("organizes flat tags into management groups without changing search", () => {
    database = new RefCanvasDatabase(":memory:");
    const asset = database.upsertAsset(createAsset()).asset;
    database.setAssetTags(asset.id, ["architecture", "lighting"]);
    const group = database.createTagGroup("Subject");
    const tag = database.listTags().find((item) => item.name === "architecture")!;

    const grouped = database.moveTagToGroup(tag.id, group.id);

    expect(grouped.groupId).toBe(group.id);
    expect(database.listTagGroups()).toContainEqual(
      expect.objectContaining({ id: group.id, title: "Subject", tagCount: 1 }),
    );
    expect(database.searchAssets({ tag: "architecture" }).items).toHaveLength(1);
    expect(() => database!.deleteTagGroup(group.id)).toThrow(
      "TAG_GROUP_NOT_EMPTY",
    );

    database.moveTagToGroup(tag.id, null);
    database.deleteTagGroup(group.id);
    expect(database.listTagGroups()).toEqual([]);
  });

  it("combines dominant color distance with tags and stable pagination", () => {
    database = new RefCanvasDatabase(":memory:");
    const red = database.upsertAsset(createAsset()).asset;
    const warm = database.upsertAsset(
      createAsset({
        title: "Warm",
        path: "D:\\references\\warm.png",
        pathKey: "d:\\references\\warm.png",
        fingerprint: "warm",
      }),
    ).asset;
    const blue = database.upsertAsset(
      createAsset({
        title: "Blue",
        path: "D:\\references\\blue.png",
        pathKey: "d:\\references\\blue.png",
        fingerprint: "blue",
      }),
    ).asset;
    const signature = Buffer.alloc(48, 0).toString("base64");
    database.setVisualSignature(red.id, "0".repeat(16), signature, {
      r: 250,
      g: 20,
      b: 20,
    });
    database.setVisualSignature(warm.id, "1".repeat(16), signature, {
      r: 225,
      g: 65,
      b: 35,
    });
    database.setVisualSignature(blue.id, "2".repeat(16), signature, {
      r: 30,
      g: 60,
      b: 230,
    });
    database.setAssetTags(red.id, ["approved"]);

    const first = database.searchAssets({
      dominantColor: "#ff0000",
      colorTolerance: 20,
      sort: "title",
      direction: "asc",
      pageSize: 1,
    });
    const second = database.searchAssets({
      dominantColor: "#ff0000",
      colorTolerance: 20,
      sort: "title",
      direction: "asc",
      pageSize: 1,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.total).toBe(2);
    expect([...first.items, ...second.items].map((asset) => asset.id)).toEqual(
      expect.arrayContaining([red.id, warm.id]),
    );
    expect(
      database.searchAssets({
        dominantColor: "#ff0000",
        colorTolerance: 20,
        tag: "approved",
      }).items.map((asset) => asset.id),
    ).toEqual([red.id]);
  });

  it("paginates with stable cursors and deterministic tie breaking", () => {
    database = new RefCanvasDatabase(":memory:");
    for (let index = 0; index < 7; index += 1) {
      database.upsertAsset(
        createAsset({
          title: `Asset ${index}`,
          path: `D:\\references\\asset-${index}.png`,
          pathKey: `d:\\references\\asset-${index}.png`,
          fingerprint: `fingerprint-${index}`,
        }),
      );
    }

    const first = database.searchAssets({
      sort: "title",
      direction: "asc",
      pageSize: 3,
    });
    const second = database.searchAssets({
      sort: "title",
      direction: "asc",
      pageSize: 3,
      cursor: first.nextCursor ?? undefined,
    });
    const third = database.searchAssets({
      sort: "title",
      direction: "asc",
      pageSize: 3,
      cursor: second.nextCursor ?? undefined,
    });

    expect(first.total).toBe(7);
    expect([
      ...first.items,
      ...second.items,
      ...third.items,
    ].map((asset) => asset.title)).toEqual([
      "Asset 0",
      "Asset 1",
      "Asset 2",
      "Asset 3",
      "Asset 4",
      "Asset 5",
      "Asset 6",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("applies a batch operation to all matching assets with exclusions", () => {
    database = new RefCanvasDatabase(":memory:");
    const first = database.upsertAsset(createAsset()).asset;
    const second = database.upsertAsset(
      createAsset({
        path: "D:\\references\\second.png",
        pathKey: "d:\\references\\second.png",
        fingerprint: "second",
      }),
    ).asset;

    const changed = database.batchUpdate(
      {
        mode: "query",
        query: { kind: "image" },
        excludedIds: [second.id],
      },
      { favorite: true, rating: 4, addTags: ["batch"] },
    );

    expect(changed).toBe(1);
    expect(database.getAsset(first.id)).toMatchObject({
      favorite: true,
      rating: 4,
      tags: ["batch"],
    });
    expect(database.getAsset(second.id)?.favorite).toBe(false);

    database.batchRename(
      { mode: "ids", ids: [first.id, second.id] },
      "Reference {index} — {name}",
    );
    database.batchUpdate(
      { mode: "ids", ids: [first.id] },
      { notes: "Shared review note", replaceTags: ["reviewed", "approved"] },
    );
    expect(database.getAsset(first.id)).toMatchObject({
      title: "Reference 001 — Temple Reference",
      notes: "Shared review note",
      tags: ["approved", "reviewed"],
    });
    expect(database.getAsset(second.id)?.title).toBe(
      "Reference 002 — Temple Reference",
    );
  });

  it("indexes board references and rewrites them during record merge", () => {
    database = new RefCanvasDatabase(":memory:");
    const keep = database.upsertAsset(createAsset()).asset;
    const removed = database.upsertAsset(
      createAsset({
        path: "D:\\references\\duplicate.png",
        pathKey: "d:\\references\\duplicate.png",
        fingerprint: "duplicate",
      }),
    ).asset;
    const board = database.createBoard("References");
    database.saveBoard(board.id, {
      schemaVersion: 1,
      canvas: {
        objects: [
          {
            type: "image",
            src: `refasset://asset/${removed.id}`,
            data: { type: "asset", assetId: removed.id },
          },
        ],
      },
    });

    database.mergeAssetRecords(keep.id, [removed.id]);
    const loaded = database.loadBoard(board.id)!;
    const object = (loaded.document.canvas.objects as Array<{
      src: string;
      data: { assetId: string };
    }>)[0];

    expect(database.getAssetReferences(keep.id)).toEqual([
      { boardId: board.id, boardTitle: "References" },
    ]);
    expect(object.data.assetId).toBe(keep.id);
    expect(object.src).toBe(`refasset://asset/${keep.id}`);
  });

  it("returns recent boards with a lazy local thumbnail and open time", () => {
    database = new RefCanvasDatabase(":memory:");
    const asset = database.upsertAsset(createAsset()).asset;
    const board = database.createBoard("Recent references");
    database.saveBoard(board.id, {
      schemaVersion: 1,
      canvas: {
        objects: [{
          type: "image",
          data: { type: "asset", assetId: asset.id },
        }],
      },
    });
    database.touchBoard(board.id);

    expect(database.recentBoards()).toEqual([
      expect.objectContaining({
        id: board.id,
        thumbnailUrl: `refasset://thumbnail/${asset.id}`,
        lastOpenedAt: expect.any(String),
      }),
    ]);
  });

  it("persists smart folders", () => {
    database = new RefCanvasDatabase(":memory:");
    const view = database.saveView("Large favorites", {
      favorite: true,
      minWidth: 2048,
      sort: "rating",
    });

    expect(database.listSavedViews()).toEqual([view]);
    database.deleteSavedView(view.id);
    expect(database.listSavedViews()).toEqual([]);
  });
});
