import { z } from "zod";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { idSchema, pathSchema } from "./schemas";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";

interface LibraryManagementIpcDependencies {
  getLibrary(): LibraryService;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess: WriteAccessController;
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
  ipc.handleWithEvent("libraries:managed-migrate", async (event, targetDirectory) => {
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window, "move", [
        { path: dependencies.getLibrary().managedStorePathForAuthorization(), mode: "destination" },
        { path: assertAbsoluteLocalPath(pathSchema.parse(targetDirectory)), mode: "destination" },
      ],
    );
    const [, target] = await dependencies.writeAccess.authorize(
      window, "move", canonical.map((filename) => ({ path: filename, mode: "destination" })),
    );
    return dependencies.getLibrary().migrateManagedToDisk(target);
  });
}
