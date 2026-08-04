import { stat } from "node:fs/promises";
import { z } from "zod";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryEntry, LibraryManager } from "../services/library-manager";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { idSchema, pathSchema } from "./schemas";

const libraryNameSchema = z.string().trim().min(1).max(120);

interface LibraryManagementIpcDependencies {
  closeActiveLibrary(): Promise<void>;
  getActiveLibraryEntry(): LibraryEntry | null;
  getDatabase(): RefCanvasDatabase;
  getDatabaseFilename(): string;
  getLibrary(): LibraryService;
  getLibraryManager(): LibraryManager;
  reloadMainWindow(): void;
  reopenLibrary(entry: LibraryEntry): Promise<void>;
}

export function registerLibraryManagementIpc(
  ipc: SecureIpcRegistrar,
  dependencies: LibraryManagementIpcDependencies,
): void {
  const manager = () => dependencies.getLibraryManager();

  ipc.handle("libraries:list", async () =>
    Promise.all(
      manager().list().map(async (entry) => {
        if (!entry.isActive || !dependencies.getActiveLibraryEntry()) {
          return entry;
        }
        return {
          ...entry,
          assetCount: dependencies.getDatabase().getLibraryStats().total,
          databaseBytes: await stat(dependencies.getDatabaseFilename())
            .then((value) => value.size)
            .catch(() => 0),
        };
      }),
    ),
  );
  ipc.handle("libraries:current", () => manager().current());
  ipc.handle("libraries:create", async (options) => {
    const parsed = z
      .object({ name: libraryNameSchema, directory: pathSchema })
      .parse(options);
    const entry = await manager().create(parsed);
    await dependencies.reopenLibrary(entry);
    dependencies.reloadMainWindow();
    return manager().describe(entry.id);
  });
  ipc.handle("libraries:open", async (directory) => {
    const entry = await manager().open(pathSchema.parse(directory));
    await dependencies.reopenLibrary(entry);
    dependencies.reloadMainWindow();
    return manager().describe(entry.id);
  });
  ipc.handle("libraries:switch-to", async (id) => {
    const entry = await manager().switchTo(idSchema.parse(id));
    if (entry.id !== dependencies.getActiveLibraryEntry()?.id) {
      await dependencies.reopenLibrary(entry);
      dependencies.reloadMainWindow();
    }
    return manager().describe(entry.id);
  });
  ipc.handle("libraries:move", async (id, newDirectory) => {
    const parsedId = idSchema.parse(id);
    const destination = pathSchema.parse(newDirectory);
    const activeEntry = dependencies.getActiveLibraryEntry();
    const wasActive = parsedId === activeEntry?.id;
    const previousEntry = wasActive && activeEntry ? { ...activeEntry } : null;
    if (wasActive) await dependencies.closeActiveLibrary();
    try {
      const entry = await manager().move(parsedId, destination);
      if (wasActive) {
        await dependencies.reopenLibrary(entry);
        dependencies.reloadMainWindow();
      }
      return manager().describe(entry.id);
    } catch (error) {
      if (previousEntry) await dependencies.reopenLibrary(previousEntry);
      throw error;
    }
  });
  ipc.handle("libraries:merge", async (sourceId, targetId) => {
    const parsedSourceId = idSchema.parse(sourceId);
    const parsedTargetId = idSchema.parse(targetId);
    const current = dependencies.getActiveLibraryEntry();
    const activeEntry =
      current &&
      (current.id === parsedSourceId || current.id === parsedTargetId)
        ? { ...current }
        : null;
    if (activeEntry) await dependencies.closeActiveLibrary();
    try {
      const report = await manager().merge(parsedSourceId, parsedTargetId);
      if (activeEntry) {
        await dependencies.reopenLibrary(manager().getEntry(activeEntry.id));
        dependencies.reloadMainWindow();
      }
      return report;
    } catch (error) {
      if (activeEntry) {
        await dependencies.reopenLibrary(manager().getEntry(activeEntry.id));
      }
      throw error;
    }
  });
  ipc.handle("libraries:verify", (id) => manager().verify(idSchema.parse(id)));
  ipc.handle("libraries:export", (id, destination) =>
    manager().exportLibrary(
      idSchema.parse(id),
      pathSchema.parse(destination),
    ),
  );

  ipc.handle("watch-roots:reconcile", (rootId) =>
    dependencies
      .getLibrary()
      .reconcileRoots(rootId === null ? null : idSchema.parse(rootId)),
  );
  ipc.handle("watch-roots:get-report", () =>
    dependencies.getLibrary().getReconcileSnapshot(),
  );
  ipc.handle("watch-roots:resolve-conflict", (entryId, assetId) =>
    dependencies.getLibrary().resolveReconcileConflict(
      z.string().min(1).max(64).parse(entryId),
      idSchema.parse(assetId),
    ),
  );

  // Managed preflight（计划 §13.3）：退役 managed storage 前的检查与迁移。
  ipc.handle("libraries:managed-preflight", () =>
    dependencies.getLibrary().prepareManagedMigration(),
  );
  ipc.handle("libraries:managed-migrate", (targetDirectory) =>
    dependencies.getLibrary().migrateManagedToDisk(pathSchema.parse(targetDirectory)),
  );
}
