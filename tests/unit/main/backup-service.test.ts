import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupService } from "../../../src/main/services/backup-service";
import type { NewAsset } from "../../../src/main/persistence/database";
import { RefCanvasDatabase } from "../../../src/main/persistence/database";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function asset(filename: string): NewAsset {
  return {
    title: "Backup asset",
    kind: "image",
    path: filename,
    pathKey: filename.toLocaleLowerCase("en-US"),
    extension: "png",
    size: 100,
    mtimeMs: 1,
    fingerprint: "backup",
    linkState: "online",
    notes: "",
    width: 10,
    height: 10,
    duration: null,
  };
}

describe("BackupService", () => {
  it("creates, lists, and validates a standalone SQLite backup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-backup-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "refcanvas.db");
    const sourcePath = path.join(directory, "source.png");
    await writeFile(sourcePath, Buffer.alloc(100));
    const database = new RefCanvasDatabase(databasePath);
    const service = new BackupService(database, path.join(directory, "backups"));
    try {
      database.upsertAsset(asset(sourcePath));
      const backup = await service.create();
      const listed = await service.list();

      expect(listed).toHaveLength(1);
      expect(listed[0].path).toBe(backup.path);
      expect(listed[0].automatic).toBe(false);
      expect(listed[0].filename).toMatch(/^refcanvas-manual-/);
      expect(() => service.validate(backup.path)).not.toThrow();
      const restored = new RefCanvasDatabase(backup.path);
      try {
        expect(restored.getLibraryStats().total).toBe(1);
      } finally {
        restored.close();
      }
    } finally {
      database.close();
    }
  });

  it("rejects a corrupt backup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-backup-"));
    temporaryDirectories.push(directory);
    const database = new RefCanvasDatabase(path.join(directory, "refcanvas.db"));
    const service = new BackupService(database, path.join(directory, "backups"));
    const corrupt = path.join(directory, "corrupt.backup");
    await writeFile(corrupt, "not sqlite");
    try {
      expect(() => service.validate(corrupt)).toThrow();
    } finally {
      database.close();
    }
  });
});
