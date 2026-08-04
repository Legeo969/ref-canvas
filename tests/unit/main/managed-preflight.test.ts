import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-migrate-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createLibraryService(root: string) {
  const database = new RefCanvasDatabase(":memory:");
  const service = new LibraryService(database, path.join(root, "trash", "files"), {
    libraryRoot: root,
    defaultStorageMode: "managed",
  });
  return { database, service };
}

describe("managed preflight (plan 13.3)", () => {
  it("reports zero managed data and allows direct migration", async () => {
    const root = await createTempDir();
    const { database, service } = await createLibraryService(root);
    try {
      const report = await service.prepareManagedMigration();
      expect(report.managedAssets).toBe(0);
      expect(report.managedFiles).toBe(0);
      expect(report.canMigrateDirectly).toBe(true);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("migrates managed assets to a disk directory with verification", async () => {
    const root = await createTempDir();
    const source = path.join(root, "source.png");
    await writeFile(source, Buffer.alloc(1_024, 7));
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      // 以 managed 模式入库（runImport 的 managed 分支），产生 managed store 副本。
      const result = await service.importPaths([source]);
      expect(result.copied).toBe(1);
      const managedBefore = database.listManagedAssets();
      expect(managedBefore).toHaveLength(1);
      expect(database.getAsset(managedBefore[0].id)!.storageMode).toBe("managed");
      const preflight = await service.prepareManagedMigration();
      expect(preflight.managedAssets).toBe(1);
      expect(preflight.canMigrateDirectly).toBe(false);

      const migration = await service.migrateManagedToDisk(targetDir);
      expect(migration.migrated).toBe(1);
      expect(migration.failed).toHaveLength(0);
      // managed store 已移除。
      const storeFiles = await readdir(path.join(root, "files")).catch(() => []);
      expect(storeFiles).toHaveLength(0);
      // asset 已转为 linked 指向磁盘目录。
      const after = database.getAsset(managedBefore[0].id)!;
      expect(after.storageMode).toBe("linked");
      expect(after.path.startsWith(targetDir)).toBe(true);
      expect((await stat(after.path)).size).toBe(1_024);
      expect(database.listManagedAssets()).toHaveLength(0);
      // 目标目录已注册为 mount root（§13.3 第 6 条）。
      expect(
        database.listMountRoots().some((mount) => mount.path === targetDir),
      ).toBe(true);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("counts orphan store files so direct migration is not claimed with leftovers", async () => {
    const root = await createTempDir();
    const { database, service } = await createLibraryService(root);
    try {
      // 手动放置孤儿文件（无对应 managed 记录）。
      const filesDir = path.join(root, "files");
      await mkdir(filesDir, { recursive: true });
      await writeFile(path.join(filesDir, "orphan.bin"), "x");
      const report = await service.prepareManagedMigration();
      expect(report.managedAssets).toBe(0);
      expect(report.managedFiles).toBe(1);
      expect(report.canMigrateDirectly).toBe(false);
    } finally {
      await service.close();
      database.close();
    }
  });

  it("does not remove the store while orphan files remain", async () => {
    const root = await createTempDir();
    const source = path.join(root, "source.png");
    await writeFile(source, Buffer.alloc(1_024, 7));
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      const result = await service.importPaths([source]);
      expect(result.copied).toBe(1);
      // 向 store 添加一个孤儿文件。
      const orphanPath = path.join(root, "files", "orphan.bin");
      await writeFile(orphanPath, "x");
      const migration = await service.migrateManagedToDisk(targetDir);
      // 孤儿文件计入失败：store 必须保留。
      expect(migration.failed.some((item) => item.reason === "ORPHAN_STORE_FILE")).toBe(
        true,
      );
      const storeFiles = await readdir(path.join(root, "files")).catch(() => []);
      expect(storeFiles).toContain("orphan.bin");
    } finally {
      await service.close();
      database.close();
    }
  });

  it("creates a mount-scoped identity for a migrated asset", async () => {
    const root = await createTempDir();
    const source = path.join(root, "source.png");
    await writeFile(source, Buffer.alloc(1_024, 7));
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      const result = await service.importPaths([source]);
      expect(result.copied).toBe(1);
      await service.migrateManagedToDisk(targetDir);
      // 目标目录已注册为 mount root，且 identity 关联该 mount。
      const mount = database.listMountRoots().find((item) => item.path === targetDir)!;
      expect(mount.state).toBe("online");
      const identities = database.listFileIdentitiesByRoot(targetDir);
      expect(identities.length).toBe(1);
      expect(identities[0].id).toBeTruthy();
    } finally {
      await service.close();
      database.close();
    }
  });
});
