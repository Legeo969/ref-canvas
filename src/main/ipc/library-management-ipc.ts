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

  // 浏览器捕获目录（渲染端过滤可认领条目用，只读）。
  ipc.handle("libraries:captures-directory", () =>
    dependencies.getLibrary().browserCapturesDirectory(),
  );

  // 认领捕获：复制进用户目录 → 校验 → 重链资产与集合引用 → 删原件。
  ipc.handleWithEvent(
    "libraries:adopt-captures",
    async (event, input: { paths: unknown; targetDirectory: unknown }) => {
      const window = dependencies.windowForSender(event);
      const payload = z
        .object({
          paths: z.array(pathSchema).min(1).max(1_000),
          targetDirectory: pathSchema,
        })
        .parse(input);
      const canonical = await dependencies.writeAccess.authorize(
        window, "copy", [
          ...payload.paths.map((filePath) => ({
            path: assertAbsoluteLocalPath(filePath),
            mode: "existing" as const,
          })),
          { path: assertAbsoluteLocalPath(payload.targetDirectory), mode: "destination" },
        ],
      );
      const finalPaths = await dependencies.writeAccess.authorize(window, "copy", canonical.map(
        (filename, index) => ({
          path: filename,
          mode: index < payload.paths.length ? ("existing" as const) : ("destination" as const),
        }),
      ));
      const sourceCount = payload.paths.length;
      return dependencies.getLibrary().adoptBrowserCaptures(
        finalPaths.slice(0, sourceCount),
        finalPaths[sourceCount],
      );
    },
  );
}
