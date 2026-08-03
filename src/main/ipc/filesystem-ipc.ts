import { app, dialog, nativeImage, shell, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DirectoryBatchService } from "../directory-batch-service";
import type { FilesystemService } from "../filesystem-service";
import type { LibraryService } from "../library-service";
import type { PreviewTokenRegistry } from "../refbrowse";
import type { SecureIpcRegistrar } from "../secure-ipc";
import {
  directoryPathsSchema,
  idSchema,
  pathSchema,
} from "./schemas";

const directorySelectionSchema = z.union([
  z.object({
    mode: z.literal("explicit"),
    paths: directoryPathsSchema,
  }),
  z.object({
    mode: z.literal("all"),
    directoryPath: pathSchema,
    revision: z.string().min(1).max(128),
    excludedPaths: directoryPathsSchema,
  }),
  z.object({
    mode: z.literal("search"),
    searchId: z.string().min(1).max(128),
    revision: z.string().min(1).max(128),
    excludedPaths: directoryPathsSchema,
  }),
]);
const directoryBatchActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("materialize") }),
  z.object({ type: z.literal("addCollection"), collectionId: idSchema }),
  z.object({
    type: z.literal("tag"),
    tags: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
  }),
  z.object({ type: z.literal("trash") }),
]);

interface FilesystemIpcDependencies {
  getDirectoryBatches(): DirectoryBatchService;
  getDirectoryService(): FilesystemService;
  getLibrary(): LibraryService;
  previewTokens: PreviewTokenRegistry;
  trashDirectoryPath(filename: string): Promise<void>;
  windowForSender(event: IpcMainInvokeEvent): Electron.BrowserWindow;
}

export function registerFilesystemIpc(
  ipc: SecureIpcRegistrar,
  dependencies: FilesystemIpcDependencies,
): void {
  const service = () => dependencies.getDirectoryService();
  const library = () => dependencies.getLibrary();
  const batches = () => dependencies.getDirectoryBatches();

  ipc.handle("filesystem:list-roots", () => service().listRoots());
  ipc.handle("filesystem:list-directory", (filename, options) =>
    service().listDirectory(
      path.resolve(pathSchema.parse(filename)),
      z
        .object({
          cursor: z.string().max(64).optional(),
          offset: z.number().int().min(0).max(10_000_000).optional(),
          pageSize: z.number().int().min(1).max(512).optional(),
        })
        .optional()
        .parse(options),
    ),
  );
  ipc.handle("filesystem:locate-entry", (filename, entryPath, revision) =>
    service().locateEntry(
      path.resolve(pathSchema.parse(filename)),
      path.resolve(pathSchema.parse(entryPath)),
      z.string().min(1).max(128).parse(revision),
    ),
  );
  ipc.handle("filesystem:start-search", (filename, query) =>
    service().startSearch(
      path.resolve(pathSchema.parse(filename)),
      z.string().max(1_000).parse(query),
    ),
  );
  ipc.handle("filesystem:cancel-search", (id) =>
    service().cancelSearch(z.string().min(1).max(128).parse(id)),
  );
  ipc.handle("filesystem:get-search", (id) =>
    service().getSearch(z.string().min(1).max(128).parse(id)),
  );
  ipc.handle("filesystem:get-search-page", (id, options) =>
    service().getSearchPage(
      z.string().min(1).max(128).parse(id),
      z
        .object({
          offset: z.number().int().min(0).optional(),
          pageSize: z.number().int().min(1).max(512).optional(),
        })
        .optional()
        .parse(options),
    ),
  );
  ipc.handle("filesystem:add-quick-access", (filename, name) =>
    service().addQuickAccess(
      path.resolve(pathSchema.parse(filename)),
      name === undefined
        ? undefined
        : z.string().trim().min(1).max(120).parse(name),
    ),
  );
  ipc.handle("filesystem:update-quick-access", (id, patch) =>
    service().updateQuickAccess(
      z.string().min(1).max(128).parse(id),
      z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          expanded: z.boolean().optional(),
        })
        .parse(patch),
    ),
  );
  ipc.handle("filesystem:remove-quick-access", (id) =>
    service().removeQuickAccess(z.string().min(1).max(128).parse(id)),
  );
  ipc.handle("filesystem:list-quick-access", () => service().listQuickAccess());
  ipc.handle("filesystem:materialize", (filename, options) =>
    library().materializePath(
      path.resolve(pathSchema.parse(filename)),
      z
        .object({
          collectionIds: z.array(idSchema).max(500).optional(),
          tags: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
          targetFolderId: idSchema.nullable().optional(),
          storageMode: z.enum(["linked", "managed", "library-default"]).optional(),
        })
        .optional()
        .parse(options),
    ),
  );
  ipc.handle("filesystem:rename", (filename, newName) =>
    library().renameSourceFile(
      path.resolve(pathSchema.parse(filename)),
      z.string().trim().min(1).max(255).parse(newName),
    ),
  );
  ipc.handle("filesystem:trash", async (filenames) => {
    for (const filename of directoryPathsSchema.parse(filenames)) {
      await dependencies.trashDirectoryPath(path.resolve(filename));
    }
  });
  ipc.handle("filesystem:open", (filename) =>
    shell.openPath(path.resolve(pathSchema.parse(filename))),
  );
  ipc.handle("filesystem:reveal", (filename) =>
    shell.showItemInFolder(path.resolve(pathSchema.parse(filename))),
  );
  ipc.handle("filesystem:preview-token", (filename) =>
    dependencies.previewTokens.tokenFor(path.resolve(pathSchema.parse(filename))),
  );
  ipc.handle("filesystem:preview-tokens", (filenames) =>
    z.array(pathSchema).max(256).parse(filenames).map((filename) => {
      const resolved = path.resolve(filename);
      return {
        path: resolved,
        token: dependencies.previewTokens.tokenFor(resolved),
      };
    }),
  );
  ipc.handle("filesystem:start-batch", (selection, action) =>
    batches().start(
      directorySelectionSchema.parse(selection),
      directoryBatchActionSchema.parse(action),
    ),
  );
  ipc.handleWithEvent("filesystem:export-paths", async (event, selection) => {
    const parsedSelection = directorySelectionSchema.parse(selection);
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出路径清单",
      defaultPath: path.join(app.getPath("documents"), "RefCanvas-paths.txt"),
      filters: [{ name: "UTF-8 文本", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, "\uFEFF", "utf8");
    return batches().start(parsedSelection, {
      type: "exportPaths",
      destination: result.filePath,
    });
  });
  ipc.handle("filesystem:get-batch", (id) =>
    batches().get(z.string().uuid().parse(id)),
  );
  ipc.handle("filesystem:cancel-batch", (id) =>
    batches().cancel(z.string().uuid().parse(id)),
  );
  ipc.on("system:start-native-drag-paths", (event, filenames) => {
    const resolved = directoryPathsSchema
      .parse(filenames)
      .map((filename) => path.resolve(filename))
      .filter((filename) => existsSync(filename));
    if (!resolved.length) return;
    const icon = nativeImage.createFromPath(resolved[0]);
    const ready =
      icon.isEmpty() || icon.getSize().width
        ? Promise.resolve()
        : new Promise<void>((resolve) => setTimeout(resolve, 50));
    void ready.then(() => {
      event.sender.startDrag({
        file: resolved[0],
        files: resolved,
        icon,
      });
    });
  });
}
