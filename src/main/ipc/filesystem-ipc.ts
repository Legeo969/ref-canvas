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
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";
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
  writeAccess: WriteAccessController;
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
    try {
      assertAbsoluteLocalPath(filename);
      return true;
    } catch {
      return false;
    }
  };
  const isAllowedPath = (filename: string): boolean => {
    const resolved = assertAbsoluteLocalPath(filename);
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
    const resolved = assertAbsoluteLocalPath(filename);
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
  ipc.handleWithEvent("filesystem:rename", async (event, filename, newName, options) => {
    const parsedOptions = parseFileOperationOptions(options);
    const resolved = await fileOperations().assertPath(
      assertAllowedPath(pathSchema.parse(filename)),
      parsedOptions,
    );
    const parsedName = z.string().trim().min(1).max(255).parse(newName);
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window,
      "rename",
      [
        { path: resolved, mode: "existing" },
        { path: path.join(path.dirname(resolved), parsedName), mode: "destination" },
      ],
    );
    return library().renameSourceFile(
      canonical[0],
      path.basename(canonical[1]),
    );
  });
  ipc.handleWithEvent("filesystem:trash", async (event, filenames, options) => {
    const parsedOptions = parseFileOperationOptions(options);
    const resolvedPaths = await Promise.all(directoryPathsSchema.parse(filenames).map(
      (filename) => fileOperations().assertPath(assertAllowedPath(filename), parsedOptions),
    ));
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window,
      "trash",
      resolvedPaths.map((filename) => ({ path: filename, mode: "existing" })),
    );
    const finalPaths = await dependencies.writeAccess.authorize(
      window,
      "trash",
      canonical.map((filename) => ({ path: filename, mode: "existing" })),
    );
    for (const finalPath of finalPaths) {
      await dependencies.trashDirectoryPath(finalPath);
    }
  });
  ipc.handleWithEvent("filesystem:create-folder", async (event, parentPath, name, options) => {
    const parent = assertAllowedPath(pathSchema.parse(parentPath));
    const folderName = z.string().trim().min(1).max(120).parse(name);
    const [canonicalTarget] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "create-folder", [
      { path: path.join(parent, folderName), mode: "destination" },
    ]);
    return fileOperations().createFolder(
      path.dirname(canonicalTarget), path.basename(canonicalTarget), parseFileOperationOptions(options),
    );
  });
  ipc.handleWithEvent("filesystem:copy", async (event, sources, targetDirectory, options) => {
    const parsedSources = directoryPathsSchema.parse(sources).map(assertAllowedPath);
    const target = assertAllowedPath(pathSchema.parse(targetDirectory));
    const [canonicalTarget] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "copy", [
      { path: target, mode: "destination" },
    ]);
    return fileOperations().copy(parsedSources, canonicalTarget, parseFileOperationOptions(options));
  });
  ipc.handleWithEvent("filesystem:move", async (event, sources, targetDirectory, options) => {
    const parsedSources = directoryPathsSchema.parse(sources).map(assertAllowedPath);
    const target = assertAllowedPath(pathSchema.parse(targetDirectory));
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(window, "move", [
      ...parsedSources.map((filename) => ({ path: filename, mode: "existing" as const })),
      { path: target, mode: "destination" },
    ]);
    const finalPaths = await dependencies.writeAccess.authorize(window, "move", canonical.map(
      (filename, index) => ({
        path: filename,
        mode: index < parsedSources.length ? "existing" as const : "destination" as const,
      }),
    ));
    return fileOperations().move(
      finalPaths.slice(0, parsedSources.length), finalPaths.at(-1)!, parseFileOperationOptions(options),
    );
  });
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
  ipc.handleWithEvent("filesystem:start-batch", async (event, selection, action) => {
    const parsedSelection = directorySelectionSchema.parse(selection);
    if (parsedSelection.mode === "explicit") {
      parsedSelection.paths.forEach(assertAllowedPath);
    } else if (parsedSelection.mode === "all") {
      assertAllowedPath(parsedSelection.directoryPath);
      parsedSelection.excludedPaths.forEach(assertAllowedPath);
    }
    const parsedAction = directoryBatchActionSchema.parse(action);
    if (parsedAction.type === "trash") {
      const window = dependencies.windowForSender(event);
      const targets: string[] = [];
      if (parsedSelection.mode === "explicit") {
        targets.push(...parsedSelection.paths.map(assertAllowedPath));
      } else {
        // Freeze every page before authorization. The background job must not
        // resolve a query again after the user grants access.
        let offset = 0;
        while (true) {
          const page = parsedSelection.mode === "all"
            ? await service().resolveSelection(
                parsedSelection.directoryPath,
                parsedSelection.revision,
                parsedSelection.excludedPaths,
                offset,
              )
            : await service().resolveSearchSelection(
                parsedSelection.searchId,
                parsedSelection.revision,
                parsedSelection.excludedPaths,
                 offset,
               );
          targets.push(...page.paths.map(assertAllowedPath));
          if (page.nextOffset === null) break;
          offset = page.nextOffset;
        }
      }
      const canonical = await dependencies.writeAccess.authorize(
        window,
        "trash",
        targets.map((filename) => ({ path: filename, mode: "existing" })),
      );
      // One full-set final canonical check occurs before the batch is started.
      // No authorization prompt can occur after the first mutation.
      const finalPaths = await dependencies.writeAccess.authorize(
        window,
        "trash",
        canonical.map((filename) => ({ path: filename, mode: "existing" })),
      );
      return batches().start(
        { mode: "explicit", paths: finalPaths },
        parsedAction,
      );
    }
    return batches().start(parsedSelection, parsedAction);
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
    const [destination] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "export", [
      { path: result.filePath, mode: "destination" },
    ]);
    await writeFile(destination, "\uFEFF", "utf8");
    return batches().start(parsedSelection, {
      type: "exportPaths",
      destination,
    });
  });
  ipc.handle("filesystem:get-batch", (id) =>
    batches().get(z.string().uuid().parse(id)),
  );
  ipc.handle("filesystem:cancel-batch", (id) =>
    batches().cancel(z.string().uuid().parse(id)),
  );
  // FND-007 §8.2：流式 ZIP 归档（可取消、冲突编号、临时文件原子移动）。
  ipc.handleWithEvent("filesystem:archive", async (event, input) => {
    const parsed = z
      .object({
        sources: directoryPathsSchema,
        targetDirectory: pathSchema,
        baseName: z.string().trim().min(1).max(128),
        jobId: z.string().min(1).max(128),
      })
      .parse(input);
    const sources = parsed.sources.map(assertAllowedPath);
    if (sources.length === 0) throw new Error("ARCHIVE_NO_ALLOWED_SOURCE");
    const targetDirectory = assertAllowedPath(parsed.targetDirectory);
    const [canonicalOutput] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "archive", [
      { path: path.join(targetDirectory, `${parsed.baseName}.zip`), mode: "destination" },
    ]);
    return dependencies.getArchiveService().archive(sources, {
      jobId: parsed.jobId,
      targetDirectory: path.dirname(canonicalOutput),
      baseName: path.basename(canonicalOutput, ".zip"),
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
      .flatMap((filename) => {
        try {
          return [assertAllowedPath(filename)];
        } catch {
          return [];
        }
      })
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
