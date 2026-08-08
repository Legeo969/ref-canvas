import { z } from "zod";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { idSchema, pathSchema } from "./schemas";

interface LibraryManagementIpcDependencies {
  getLibrary(): LibraryService;
}

export function registerLibraryManagementIpc(
  ipc: SecureIpcRegistrar,
  dependencies: LibraryManagementIpcDependencies,
): void {
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
