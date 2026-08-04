import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";
import { LibraryService } from "../../../src/main/services/library-service";
import { managedStorePath } from "../../../src/main/services/library-manager";

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
  });
  return { database, service };
}

/** 构造一条存量 managed 资产（store 文件 + DB 记录，模拟退役前的历史数据）。 */
async function seedManagedAsset(
  database: RefCanvasDatabase,
  root: string,
  name: string,
  content: Buffer,
): Promise<{ assetId: string; storePath: string }> {
  const storeDir = managedStorePath(root);
  await mkdir(storeDir, { recursive: true });
  const hash = createHash("sha256").update(content).digest("hex");
  const storePath = path.join(storeDir, `${hash}.png`);
  await writeFile(storePath, content);
  const asset = database.upsertAsset({
    title: name,
    kind: "image",
    path: storePath,
    pathKey: storePath.toLocaleLowerCase("en-US"),
    extension: "png",
    size: content.length,
    mtimeMs: 1,
    fingerprint: `fp-${hash}`,
    linkState: "online",
    notes: "",
    width: 1,
    height: 1,
    duration: null,
    contentHash: hash,
    storageMode: "managed",
    libraryRelativePath: path.basename(storePath),
    originalSourcePath: `C:\\original\\${name}.png`,
  }).asset;
  return { assetId: asset.id, storePath };
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
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      // 构造存量 managed 数据（store 文件 + DB 记录）。
      const { assetId } = await seedManagedAsset(
        database,
        root,
        "source",
        Buffer.alloc(1_024, 7),
      );
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
      const after = database.getAsset(assetId)!;
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
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      await seedManagedAsset(database, root, "source", Buffer.alloc(1_024, 7));
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
    const { database, service } = await createLibraryService(root);
    const targetDir = path.join(root, "disk-library");
    try {
      await seedManagedAsset(database, root, "source", Buffer.alloc(1_024, 7));
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
