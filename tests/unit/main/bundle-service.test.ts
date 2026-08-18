import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { BundleService } from "../../../src/main/services/bundle-service";
import {
  LibraryManager,
  databasePathFor,
} from "../../../src/main/services/library-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 80));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
});

describe("SPEC-2 BundleService", () => {
  it("exports a bundle containing db + bundle.json and imports with remap", async () => {
    // 库根目录（userData 等价物）。
    const userData = await mkdtemp(path.join(os.tmpdir(), "refcanvas-bundle-"));
    temporaryDirectories.push(userData);
    const thumbnailsRoot = path.join(userData, "cache", "thumbnails");
    await mkdir(thumbnailsRoot, { recursive: true });
    await writeFile(path.join(thumbnailsRoot, "asset.png"), "THUMB");

    // 建库：资产路径在 D:\Assets.library 下。
    const dbPath = path.join(userData, "refcanvas.db");
    const db = new RefCanvasDatabase(dbPath);
    const asset = db.upsertAsset({
      title: "a",
      kind: "image",
      path: "D:\\Assets.library\\shot.png",
      pathKey: "d:\\assets.library\\shot.png",
      extension: "png",
      size: 10,
      mtimeMs: 1,
      fingerprint: "fp",
      linkState: "online",
      notes: "",
      width: 100,
      height: 100,
      duration: null,
    }).asset;
    db.addWatchRoot("D:\\Assets.library");
    db.close();

    const libraryManager = new LibraryManager(userData);
    await libraryManager.bootstrapLegacy();

    // 导出。
    const service = new BundleService({
      getDatabase: () => {
        // 导出时打开库做备份。
        return new RefCanvasDatabase(dbPath);
      },
      getLibraryManager: () => libraryManager,
      getThumbnailCacheDirectory: () => thumbnailsRoot,
      getPreviewCacheIndexFilenames: () => [],
    });
    const exportDir = path.join(userData, "export");
    const exported = await service.exportBundle(exportDir, "lib");
    expect(exported.path.endsWith(".refcanvas-bundle")).toBe(true);
    expect(exported.manifest.format).toBe("refcanvas-bundle");
    expect(exported.manifest.pathRoots).toContain("D:\\Assets.library");

    // 导入到新的 userData（E:\new 根映射）。
    const targetUserData = await mkdtemp(path.join(os.tmpdir(), "refcanvas-import-"));
    temporaryDirectories.push(targetUserData);
    const targetThumbs = path.join(targetUserData, "cache", "thumbnails");
    await mkdir(targetThumbs, { recursive: true });
    const targetManager = new LibraryManager(targetUserData);
    await targetManager.bootstrapLegacy();
    const targetDbPath = databasePathFor((await targetManager.currentEntry())!);

    const importService = new BundleService({
      getDatabase: () => new RefCanvasDatabase(targetDbPath),
      getLibraryManager: () => targetManager,
      getThumbnailCacheDirectory: () => targetThumbs,
      getPreviewCacheIndexFilenames: () => [],
    });
    const imported = await importService.importBundle(exported.path, [
      { from: "D:\\Assets.library", to: "E:\\Assets.library" },
    ]);
    expect(imported.rules).toHaveLength(1);

    // 导入写入了新库文件 + 待重映射标记 + 缩略图。
    const { existsSync } = await import("node:fs");
    expect(existsSync(targetDbPath)).toBe(true);
    expect(existsSync(path.join(targetUserData, "pending-bundle-remap.json"))).toBe(true);
    expect(existsSync(path.join(targetThumbs, "asset.png"))).toBe(true);

    // 模拟重启：打开新库执行 remapPaths。
    const importedDb = new RefCanvasDatabase(targetDbPath);
    const remapped = importedDb.remapPaths([{ from: "D:\\Assets.library", to: "E:\\Assets.library" }]);
    expect(remapped.some((r) => r.table === "assets" && r.updated > 0)).toBe(true);
    const loaded = importedDb.getAsset(asset.id);
    expect(loaded?.path).toBe("E:\\Assets.library\\shot.png");
    importedDb.close();
  });
});
