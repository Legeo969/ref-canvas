import { app } from "electron";
import { copyFile } from "node:fs/promises";
import { z } from "zod";
import type { BackupService } from "../services/backup-service";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";

interface BackupIpcDependencies {
  getBackups(): BackupService;
  getDatabase(): RefCanvasDatabase;
  getDatabaseFilename(): string;
  getLibrary(): LibraryService;
}

export function registerBackupIpc(
  ipc: SecureIpcRegistrar,
  dependencies: BackupIpcDependencies,
): void {
  ipc.handle("backups:list", () => dependencies.getBackups().list());
  ipc.handle("backups:create", () => dependencies.getBackups().create());
  ipc.handle("backups:restore", async (filename) => {
    const parsed = assertAbsoluteLocalPath(
      z.string().min(1).max(32_768).parse(filename),
    );
    dependencies.getBackups().validate(parsed);
    const databaseFilename = dependencies.getDatabaseFilename();
    const rollback = `${databaseFilename}.before-restore`;
    await dependencies.getLibrary().close();
    dependencies.getDatabase().close();
    await copyFile(databaseFilename, rollback);
    try {
      await copyFile(parsed, databaseFilename);
      app.relaunch();
      app.exit(0);
    } catch (error) {
      await copyFile(rollback, databaseFilename);
      throw error;
    }
  });
}
