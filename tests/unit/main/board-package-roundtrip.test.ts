import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importBoardPackage } from "../../../src/main/services/board-import-service";

describe("board package round trip", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function tempDir(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-roundtrip-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  it("re-imports the exact package shape that export produces", async () => {
    const root = await tempDir();
    const pkg = path.join(root, "Board.refcanvas");
    // 导出端产物形状：format/version/board/assets/document/files(relativePath+base64)
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await writeFile(pkg, JSON.stringify({
      format: "refcanvas-package",
      version: 2,
      board: { id: "b", title: "Round Trip", createdAt: "", updatedAt: "", revision: 1 },
      assets: [{ id: "asset-1", source: "C:/pics/a.png", relativePath: "assets/asset-1/a.png" }],
      document: {
        schemaVersion: 2,
        canvas: {
          objects: [{
            type: "image", left: 0, top: 0,
            src: "refasset://asset/asset-1",
            data: { objectId: "o1", assetId: "asset-1" },
          }],
        },
        viewport: { transform: [1, 0, 0, 1, 0, 0], zoom: 1 },
        guides: { x: [], y: [] },
      },
      files: [{ relativePath: "assets/asset-1/a.png", dataBase64: png.toString("base64") }],
    }), "utf8");

    const created: Array<{ id: string; title: string }> = [];
    const saved = new Map<string, unknown>();
    const database = {
      createBoard: vi.fn((title: string) => {
        const summary = { id: crypto.randomUUID(), title };
        created.push(summary);
        return summary;
      }),
      saveBoard: vi.fn((id: string, document: unknown) => {
        saved.set(id, document);
        return { id, title: created[0].title, createdAt: "", updatedAt: "", revision: 1 };
      }),
    } as never;

    const materializedPaths: string[] = [];
    const result = await importBoardPackage(pkg, {
      getDatabase: () => database,
      materializePath: async (filename: string) => {
        materializedPaths.push(filename);
        const bytes = await readFile(filename);
        expect(bytes.length).toBeGreaterThan(0);
        return { asset: { id: "asset-imported" } };
      },
    });

    expect(result.title).toBe("Round Trip");
    expect(result.assetsImported).toBe(1);
    expect(materializedPaths[0]).toContain("assets-");
    const doc = saved.get(result.boardId) as { canvas: { objects: Array<{ data: { assetId: string }; src: string }> } };
    expect(doc.canvas.objects[0].data.assetId).toBe("asset-imported");
    expect(doc.canvas.objects[0].src).toContain("asset-imported");
  });
});
