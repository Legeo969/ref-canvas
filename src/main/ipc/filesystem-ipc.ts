import { app, dialog, nativeImage, shell, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DirectoryBatchService } from "../services/directory-batch-service";
import type { FileOperationsService } from "../services/file-operations-service";
import type { FilesystemService } from "../services/filesystem-service";
import type { LibraryService } from "../services/library-service";
import type { ZipArchiveService } from "../services/zip-archive-service";
import type { PreviewTokenRegistry } from "../platform/refbrowse";
import { revealInFileManager } from "../platform/reveal-in-file-manager";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import type { MountRoot } from "../../shared/contracts";
import {
  directoryPathsSchema,
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
  z.object({
    type: z.literal("tag"),
    tags: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
  }),
  z.object({ type: z.literal("trash") }),
]);

interface FilesystemIpcDependencies {
  getDirectoryBatches(): DirectoryBatchService;
  getDirectoryService(): FilesystemService;
  getFileOperations(): FileOperationsService;
  getLibrary(): LibraryService;
  getMountRoots(): MountRoot[];
  previewTokens: PreviewTokenRegistry;
  trashDirectoryPath(filename: string): Promise<void>;
  windowForSender(event: IpcMainInvokeEvent): Electron.BrowserWindow;
  /** FND-007：流式 ZIP 归档服务（可取消）。 */
  getArchiveService(): ZipArchiveService;
}

export function registerFilesystemIpc(
  ipc: SecureIpcRegistrar,
  dependencies: FilesystemIpcDependencies,
): void {
  const service = () => dependencies.getDirectoryService();
  const library = () => dependencies.getLibrary();
  const batches = () => dependencies.getDirectoryBatches();
  const fileOperations = () => dependencies.getFileOperations();
  const isLocalDrivePath = (filename: string): boolean => {
    const root = path.parse(filename).root;
    if (!root) return false;
    if (process.platform !== "win32") {
      return root === path.parse(process.cwd()).root;
    }
    return /^[A-Za-z]:\\$/.test(root);
  };
  const isAllowedPath = (filename: string): boolean => {
    const resolved = path.resolve(filename);
    const inMount = dependencies.getMountRoots().some((mount) => {
      if (mount.state !== "online") return false;
      const relative = path.relative(path.resolve(mount.path), resolved);
      return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
      );
    });
    return inMount || isLocalDrivePath(resolved);
  };
  const assertAllowedPath = (filename: string): string => {
    const resolved = path.resolve(filename);
    if (!isAllowedPath(resolved)) throw new Error("PATH_OUTSIDE_MOUNT_ROOT");
    return resolved;
  };

  const fileOperationOptionsSchema = z
    .object({
      conflictAction: z.enum(["skip", "rename", "replace"]).optional(),
      renameTemplate: z.string().max(256).optional(),
      revision: z.string().max(128).optional(),
      directoryPath: pathSchema.optional(),
    })
    .optional();
  const parseFileOperationOptions = (options: unknown) => {
    const parsed = fileOperationOptionsSchema.parse(options);
    if (parsed?.directoryPath) {
      parsed.directoryPath = assertAllowedPath(parsed.directoryPath);
    }
    return parsed;
  };

  ipc.handle("filesystem:list-roots", () => service().listRoots());
  ipc.handle("filesystem:set-observed-directory", (filename) =>
    service().setObservedDirectory(
      filename === null ? null : assertAllowedPath(pathSchema.parse(filename)),
    ),
  );
  ipc.handle("filesystem:list-directory", (filename, options) =>
    service().listDirectory(
      assertAllowedPath(pathSchema.parse(filename)),
      z
        .object({
          cursor: z.string().max(64).optional(),
          offset: z.number().int().min(0).max(10_000_000).optional(),
          pageSize: z.number().int().min(1).max(512).optional(),
          flattenDepth: z.number().int().min(0).max(8).optional(),
          showHidden: z.boolean().optional(),
          collapseSequences: z.boolean().optional(),
          extensions: z
            .array(z.string().trim().regex(/^\.?[a-z0-9]{1,16}$/i))
            .max(256)
            .optional(),
        })
        .optional()
        .parse(options),
    ),
  );
  ipc.handle("filesystem:locate-entry", (filename, entryPath, revision) =>
    service().locateEntry(
      assertAllowedPath(pathSchema.parse(filename)),
      assertAllowedPath(pathSchema.parse(entryPath)),
      z.string().min(1).max(128).parse(revision),
    ),
  );
  ipc.handle("filesystem:start-search", (filename, query, options) =>
    service().startSearch(
      assertAllowedPath(pathSchema.parse(filename)),
      z.string().max(1_000).parse(query),
      z.object({
        collapseSequences: z.boolean().optional(),
        extensions: z
          .array(z.string().trim().regex(/^\.?[a-z0-9]{1,16}$/i))
          .max(256)
          .optional(),
      }).optional().parse(options),
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
      assertAllowedPath(pathSchema.parse(filename)),
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
  ipc.handle("filesystem:list-quick-access", () =>
      service().listQuickAccess().filter((entry) => isAllowedPath(entry.path)),
  );
  ipc.handle("filesystem:materialize", (filename) =>
    library().materializePath(assertAllowedPath(pathSchema.parse(filename))),
  );
  ipc.handle("filesystem:rename", async (filename, newName, options) => {
    const parsedOptions = parseFileOperationOptions(options);
    const resolved = await fileOperations().assertPath(
      assertAllowedPath(pathSchema.parse(filename)),
      parsedOptions,
    );
    return library().renameSourceFile(
      resolved,
      z.string().trim().min(1).max(255).parse(newName),
    );
  });
  ipc.handle("filesystem:trash", async (filenames, options) => {
    const parsedOptions = parseFileOperationOptions(options);
    for (const filename of directoryPathsSchema.parse(filenames)) {
      const resolved = await fileOperations().assertPath(
        assertAllowedPath(filename),
        parsedOptions,
      );
      await dependencies.trashDirectoryPath(resolved);
    }
  });
  ipc.handle("filesystem:create-folder", (parentPath, name, options) =>
    fileOperations().createFolder(
      assertAllowedPath(pathSchema.parse(parentPath)),
      z.string().trim().min(1).max(120).parse(name),
      parseFileOperationOptions(options),
    ),
  );
  ipc.handle("filesystem:copy", (sources, targetDirectory, options) =>
    fileOperations().copy(
      directoryPathsSchema.parse(sources).map(assertAllowedPath),
      assertAllowedPath(pathSchema.parse(targetDirectory)),
      parseFileOperationOptions(options),
    ),
  );
  ipc.handle("filesystem:move", (sources, targetDirectory, options) =>
    fileOperations().move(
      directoryPathsSchema.parse(sources).map(assertAllowedPath),
      assertAllowedPath(pathSchema.parse(targetDirectory)),
      parseFileOperationOptions(options),
    ),
  );
  ipc.handle("filesystem:open", (filename) =>
    shell.openPath(assertAllowedPath(pathSchema.parse(filename))),
  );
  ipc.handle("filesystem:reveal", async (filename) => {
    const resolved = assertAllowedPath(pathSchema.parse(filename));
    await revealInFileManager(resolved, shell);
  });
  ipc.handle("filesystem:preview-token", (filename) =>
    dependencies.previewTokens.tokenFor(
      assertAllowedPath(pathSchema.parse(filename)),
    ),
  );
  ipc.handle("filesystem:preview-tokens", (filenames) =>
    z.array(pathSchema).max(256).parse(filenames).map((filename) => {
      const resolved = assertAllowedPath(filename);
      return {
        path: resolved,
        token: dependencies.previewTokens.tokenFor(resolved),
      };
    }),
  );
  ipc.handle("filesystem:start-batch", (selection, action) => {
    const parsedSelection = directorySelectionSchema.parse(selection);
    if (parsedSelection.mode === "explicit") {
      parsedSelection.paths.forEach(assertAllowedPath);
    } else if (parsedSelection.mode === "all") {
      assertAllowedPath(parsedSelection.directoryPath);
      parsedSelection.excludedPaths.forEach(assertAllowedPath);
    }
    return batches().start(
      parsedSelection,
      directoryBatchActionSchema.parse(action),
    );
  });
  ipc.handleWithEvent("filesystem:export-paths", async (event, selection) => {
    const parsedSelection = directorySelectionSchema.parse(selection);
    if (parsedSelection.mode === "explicit") {
      parsedSelection.paths.forEach(assertAllowedPath);
    } else if (parsedSelection.mode === "all") {
      assertAllowedPath(parsedSelection.directoryPath);
      parsedSelection.excludedPaths.forEach(assertAllowedPath);
    }
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
  // FND-007 §8.2：流式 ZIP 归档（可取消、冲突编号、临时文件原子移动）。
  ipc.handle("filesystem:archive", async (input) => {
    const parsed = z
      .object({
        sources: directoryPathsSchema,
        targetDirectory: pathSchema,
        baseName: z.string().trim().min(1).max(128),
        jobId: z.string().min(1).max(128),
      })
      .parse(input);
    const sources = parsed.sources
      .map((filename) => path.resolve(filename))
      .filter(isAllowedPath);
    if (sources.length === 0) throw new Error("ARCHIVE_NO_ALLOWED_SOURCE");
    return dependencies.getArchiveService().archive(sources, {
      jobId: parsed.jobId,
      targetDirectory: path.resolve(parsed.targetDirectory),
      baseName: parsed.baseName,
    });
  });
  ipc.handle("filesystem:cancel-archive", (jobId) =>
    dependencies
      .getArchiveService()
      .cancel(z.string().min(1).max(128).parse(jobId)),
  );
  ipc.on("system:start-native-drag-paths", (event, filenames) => {
    const resolved = directoryPathsSchema
      .parse(filenames)
      .map((filename) => path.resolve(filename))
      .filter(isAllowedPath)
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
