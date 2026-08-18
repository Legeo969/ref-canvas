import { app } from "electron";
import { z } from "zod";
import type { BackupService } from "../services/backup-service";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import { copyFileDurable } from "../platform/fsync";

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
    // SPEC-6：回滚副本用原子写 + fsync，防止断电时回滚副本半截。
    await copyFileDurable(databaseFilename, rollback);
    try {
      await copyFileDurable(parsed, databaseFilename);
      app.relaunch();
      app.exit(0);
    } catch (error) {
      await copyFileDurable(rollback, databaseFilename);
      throw error;
    }
  });
}
