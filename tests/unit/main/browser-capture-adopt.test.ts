import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createLibraryService(root: string) {
  const database = new RefCanvasDatabase(":memory:");
  const service = new LibraryService(database, path.join(root, "trash", "files"), {
    libraryRoot: root,
  });
  return { database, service };
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M8AAAMBAQDJZIgAAAAASUVORK5CYII=",
  "base64",
);

/** 构造一条已导入的捕获资产（browser-captures 文件 + linked 记录）。 */
async function seedCapturedAsset(
  database: RefCanvasDatabase,
  capturesRoot: string,
  filename: string,
): Promise<{ assetId: string; capturePath: string }> {
  await mkdir(capturesRoot, { recursive: true });
  const capturePath = path.join(capturesRoot, filename);
  await writeFile(capturePath, PNG_BYTES);
  const hash = createHash("sha256").update(PNG_BYTES).digest("hex");
  const asset = database.upsertAsset({
    title: filename,
    kind: "image",
    path: capturePath,
    pathKey: capturePath.toLocaleLowerCase("en-US"),
    extension: "png",
    size: PNG_BYTES.length,
    mtimeMs: 1,
    fingerprint: `fp-${hash.slice(0, 16)}`,
    linkState: "online",
    notes: "",
    width: 1,
    height: 1,
    duration: null,
    contentHash: hash,
  }).asset;
  return { assetId: asset.id, capturePath };
}

describe("adoptBrowserCaptures (路线一：捕获认领)", () => {
  it("copies the capture into the target folder, relinks asset & collection refs, removes original", async () => {
    const root = await createTempDir("refcanvas-adopt-");
    const targetDir = path.join(root, "my-library");
    await mkdir(targetDir, { recursive: true });
    const { database, service } = await createLibraryService(root);
    try {
      const capturesRoot = await service.browserCapturesDirectory();
      const { assetId, capturePath } = await seedCapturedAsset(
        database,
        capturesRoot,
        "image.png",
      );
      // 集合引用旧路径（模拟捕获自动归档）。
      const [collection] = [
        database.collections().create({ name: "网页捕获" }),
      ];
      const [item] = database.collections().addPaths(collection.id, [capturePath]);
      expect(item.lastResolvedPath).toBe(capturePath);

      const report = await service.adoptBrowserCaptures([capturePath], targetDir);
      expect(report.failed).toHaveLength(0);
      expect(report.adopted).toHaveLength(1);

      const adoptedTo = report.adopted[0].to;
      expect(path.dirname(adoptedTo)).toBe(targetDir);
      // 副本内容一致。
      const copiedHash = createHash("sha256").update(PNG_BYTES).digest("hex");
      expect(
        createHash("sha256").update(await readFile(adoptedTo)).digest("hex"),
      ).toBe(copiedHash);
      // 原件已删除。
      await expect(stat(capturePath)).rejects.toThrow();
      // 资产重链到新路径，仍为 linked（storage_mode 列恒为 linked）。
      const after = database.getAsset(assetId)!;
      expect(after.path).toBe(adoptedTo);
      expect(after.contentHash).toBe(copiedHash);
      // 集合条目重定向到新路径且状态 resolved。
      const updatedItem = database.collections().getItem(item.id)!;
      expect(updatedItem.lastResolvedPath).toBe(adoptedTo);
      expect(updatedItem.state).toBe("resolved");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("refuses paths outside browser-captures and missing assets", async () => {
    const root = await createTempDir("refcanvas-adopt-");
    const targetDir = path.join(root, "target");
    await mkdir(targetDir, { recursive: true });
    const outsideDir = path.join(root, "outside");
    await mkdir(outsideDir, { recursive: true });
    const { database, service } = await createLibraryService(root);
    try {
      const outsideFile = path.join(outsideDir, "not-a-capture.png");
      await writeFile(outsideFile, PNG_BYTES);

      const notCapture = await service.adoptBrowserCaptures(
        [outsideFile],
        targetDir,
      );
      expect(notCapture.adopted).toHaveLength(0);
      expect(notCapture.failed[0].reason).toBe("NOT_A_BROWSER_CAPTURE");

      const capturesRoot = await service.browserCapturesDirectory();
      await mkdir(capturesRoot, { recursive: true });
      const orphanCapture = path.join(capturesRoot, "orphan.png");
      await writeFile(orphanCapture, PNG_BYTES);
      const notImported = await service.adoptBrowserCaptures(
        [orphanCapture],
        targetDir,
      );
      expect(notImported.adopted).toHaveLength(0);
      expect(notImported.failed[0].reason).toBe("CAPTURE_NOT_IMPORTED");
      // 失败的文件不动。
      await expect(stat(orphanCapture)).resolves.toBeTruthy();
    } finally {
      await service.close();
      database.close();
    }
  });

  it("rejects a non-directory target", async () => {
    const root = await createTempDir("refcanvas-adopt-");
    const { database, service } = await createLibraryService(root);
    try {
      await expect(
        service.adoptBrowserCaptures([path.join(root, "x.png")], root),
      ).rejects.toThrow();
    } finally {
      await service.close();
      database.close();
    }
  });
});
