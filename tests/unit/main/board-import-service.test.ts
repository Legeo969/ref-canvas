import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importBoardPackage,
} from "../../../src/main/services/board-import-service";
import type { RefCanvasDatabase } from "../../../src/main/persistence/database";
import type { BoardDocument } from "../../../src/shared/contracts";

function makeDatabase() {
  const boards = new Map<string, { document: BoardDocument }>();
  const created: Array<{ id: string; title: string }> = [];
  return {
    created,
    createBoard: vi.fn((title: string) => {
      const summary = { id: crypto.randomUUID(), title };
      created.push(summary);
      boards.set(summary.id, { document: null as unknown as BoardDocument });
      return summary;
    }),
    saveBoard: vi.fn((id: string, document: BoardDocument) => {
      boards.set(id, { document });
      return {
        id,
        title: created.find((item) => item.id === id)?.title ?? "?",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
      };
    }),
    loadBoard: vi.fn((id: string) => boards.get(id) ?? null),
    boards,
  } as unknown as RefCanvasDatabase & {
    created: Array<{ id: string; title: string }>;
    boards: Map<string, { document: BoardDocument }>;
  };
}

const minimalDocument = (assetId?: string) => ({
  schemaVersion: 2,
  canvas: {
    objects: assetId
      ? [
          {
            type: "image",
            left: 10,
            top: 10,
            src: `refasset://asset/${assetId}`,
            data: { objectId: "obj-1", assetId },
          },
        ]
      : [],
  },
  viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
  guides: { x: [], y: [] },
});

describe("importBoardPackage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-import-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  it("imports a self-contained v2 package and rewrites asset ids", async () => {
    const root = await temporaryDirectory();
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const packageFile = path.join(root, "My Board.refcanvas");
    await writeFile(packageFile, JSON.stringify({
      format: "refcanvas-package",
      version: 2,
      board: { title: "My Board" },
      assets: [{ id: "asset-old", relativePath: "assets/asset-old/pixel.png" }],
      document: minimalDocument("asset-old"),
      files: [
        { relativePath: "assets/asset-old/pixel.png", dataBase64: pngBytes.toString("base64") },
      ],
    }), "utf8");

    const database = makeDatabase();
    const materializePath = vi.fn(async () => ({ asset: { id: "asset-new" } }));
    const result = await importBoardPackage(packageFile, { getDatabase: () => database, materializePath });

    expect(result.title).toBe("My Board");
    expect(result.assetsImported).toBe(1);
    expect(materializePath).toHaveBeenCalledWith(
      expect.stringContaining("My Board.assets-"),
    );
    const saved = database.boards.get(result.boardId);
    const image = (saved?.document as unknown as { canvas: { objects: Array<{ src: string; data: { assetId: string } }> } }).canvas.objects[0];
    expect(image.src).toContain("refasset://asset/asset-new");
    expect(image.data.assetId).toBe("asset-new");
  });

  it("imports a plain JSON board document (legacy export-json output)", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "Plain.refcanvas");
    await writeFile(file, JSON.stringify(minimalDocument()), "utf8");

    const database = makeDatabase();
    const materializePath = vi.fn();
    const result = await importBoardPackage(file, { getDatabase: () => database, materializePath });

    expect(result.title).toBe("Plain");
    expect(result.assetsImported).toBe(0);
    expect(materializePath).not.toHaveBeenCalled();
    expect(database.createBoard).toHaveBeenCalledWith("Plain");
  });

  it("imports a .refcanvas-project directory and materializes assets", async () => {
    const root = await temporaryDirectory();
    const projectRoot = path.join(root, "Collected.refcanvas-project");
    await mkdir(path.join(projectRoot, "assets", "asset-a"), { recursive: true });
    await writeFile(path.join(projectRoot, "assets", "asset-a", "pixel.png"), Buffer.from("fake-png"));
    await writeFile(path.join(projectRoot, "board.json"), JSON.stringify(minimalDocument("asset-a")), "utf8");
    await writeFile(path.join(projectRoot, "manifest.json"), JSON.stringify({
      format: "refcanvas-project",
      version: 1,
      board: { title: "Collected" },
      assets: [{ id: "asset-a", relativePath: "assets/asset-a/pixel.png" }],
    }), "utf8");

    const database = makeDatabase();
    const materializePath = vi.fn(async () => ({ asset: { id: "asset-materialized" } }));
    const result = await importBoardPackage(projectRoot, { getDatabase: () => database, materializePath });

    expect(result.title).toBe("Collected");
    expect(result.assetsImported).toBe(1);
    expect(materializePath).toHaveBeenCalledWith(path.join(projectRoot, "assets", "asset-a", "pixel.png"));
    const saved = (database as unknown as ReturnType<typeof makeDatabase>).boards.get(result.boardId);
    const image = (saved?.document as unknown as { canvas: { objects: Array<{ data: { assetId: string } }> } }).canvas.objects[0];
    expect(image.data.assetId).toBe("asset-materialized");
  });

  it("skips missing assets in a project directory instead of failing", async () => {
    const root = await temporaryDirectory();
    const projectRoot = path.join(root, "Partial.refcanvas-project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, "board.json"), JSON.stringify(minimalDocument("asset-gone")), "utf8");
    await writeFile(path.join(projectRoot, "manifest.json"), JSON.stringify({
      format: "refcanvas-project",
      version: 1,
      board: { title: "Partial" },
      assets: [{ id: "asset-gone", relativePath: "assets/asset-gone/missing.png" }],
    }), "utf8");

    const database = makeDatabase();
    const materializePath = vi.fn();
    const result = await importBoardPackage(projectRoot, { getDatabase: () => database, materializePath });

    expect(result.assetsImported).toBe(0);
    expect(materializePath).not.toHaveBeenCalled();
  });

  it("rejects path traversal inside a package", async () => {
    const root = await temporaryDirectory();
    const packageFile = path.join(root, "Evil.refcanvas");
    await writeFile(packageFile, JSON.stringify({
      format: "refcanvas-package",
      version: 2,
      board: { title: "Evil" },
      assets: [{ id: "a", relativePath: "../escape.png" }],
      document: minimalDocument(),
      files: [{ relativePath: "../escape.png", dataBase64: "" }],
    }), "utf8");

    const database = makeDatabase();
    const materializePath = vi.fn();
    await expect(
      importBoardPackage(packageFile, { getDatabase: () => database, materializePath }),
    ).rejects.toThrow("BOARD_PACKAGE_PATH_OUTSIDE_ROOT");
  });

  it("throws on invalid JSON without crashing", async () => {
    const root = await temporaryDirectory();
    const file = path.join(root, "Broken.refcanvas");
    await writeFile(file, "{ not json", "utf8");

    const database = makeDatabase();
    await expect(
      importBoardPackage(file, { getDatabase: () => database, materializePath: vi.fn() }),
    ).rejects.toThrow();
  });

  it("throws on an unknown directory layout", async () => {
    const root = await temporaryDirectory();
    const stranger = path.join(root, "RandomDir");
    await mkdir(stranger, { recursive: true });

    const database = makeDatabase();
    await expect(
      importBoardPackage(stranger, { getDatabase: () => database, materializePath: vi.fn() }),
    ).rejects.toThrow("BOARD_IMPORT_UNKNOWN_DIRECTORY");
  });
});
