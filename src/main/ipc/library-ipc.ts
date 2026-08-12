import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assetColorLabels } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import type { WriteAccessController } from "../platform/write-access-controller";
import {
  idSchema,
  idsSchema,
  pathsSchema,
  searchObjectSchema,
  searchSchema,
  searchWindowSchema,
  selectionSchema,
} from "./schemas";

interface LibraryIpcDependencies {
  copyProjectAsset(assetId: string, destination: string): Promise<unknown>;
  getDatabase(): RefCanvasDatabase;
  getLibrary(): LibraryService;
  safeFilename(value: string): string;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess: WriteAccessController;
}

export function registerLibraryIpc(
  ipc: SecureIpcRegistrar,
  dependencies: LibraryIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();
  const library = () => dependencies.getLibrary();

  ipc.handle("library:search", (input) =>
    database().searchAssets(searchSchema.parse(input)),
  );
  ipc.handle("library:search-window", (input) =>
    database().searchAssetWindow(searchWindowSchema.parse(input)),
  );
  ipc.handle("library:get", (id) => database().getAsset(idSchema.parse(id)));
  ipc.handle("library:get-by-path", (filename) =>
    database().getAssetByPath(
      z.string().min(1).max(32_768).parse(filename),
    ),
  );
  ipc.handle("library:import-paths", (paths) =>
    library().importPaths(pathsSchema.parse(paths)),
  );
  ipc.handle("library:start-import", (paths) =>
    library().startImport(pathsSchema.parse(paths)),
  );
  ipc.handle("library:get-import-job", (id) =>
    library().getImportJob(idSchema.parse(id)),
  );
  ipc.handle("library:cancel-import", (id) =>
    library().cancelImport(idSchema.parse(id)),
  );
  ipc.handle("library:retry-import", (id) =>
    library().retryImport(idSchema.parse(id)),
  );
  ipc.handleWithEvent("library:pick-import", async (event, mode: unknown) => {
    const parsedMode = z.enum(["files", "folder"]).parse(mode);
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: parsedMode === "files" ? "选择要建立索引的文件" : "选择磁盘文件夹",
      properties:
        parsedMode === "files"
          ? ["openFile", "multiSelections"]
          : ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return library().importPaths(result.filePaths);
  });
  ipc.handle("library:update", (id, patch) => {
    const parsedPatch = z
      .object({
        title: z.string().trim().min(1).max(256).optional(),
        notes: z.string().max(10_000).optional(),
        favorite: z.boolean().optional(),
        rating: z.number().int().min(0).max(5).optional(),
        colorLabel: z.enum(assetColorLabels).optional(),
      })
      .parse(patch);
    return database().updateAsset(idSchema.parse(id), parsedPatch);
  });
  ipc.handle("library:list-annotations", (assetId) =>
    database().listAssetAnnotations(idSchema.parse(assetId)),
  );
  ipc.handle("library:create-annotation", (assetId, input) =>
    database().createAssetAnnotation(
      idSchema.parse(assetId),
      z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        text: z.string().trim().min(1).max(2_000),
      }).parse(input),
    ),
  );
  ipc.handle("library:update-annotation", (id, patch) =>
    database().updateAssetAnnotation(
      idSchema.parse(id),
      z.object({
        x: z.number().finite().min(0).max(1).optional(),
        y: z.number().finite().min(0).max(1).optional(),
        text: z.string().trim().min(1).max(2_000).optional(),
      }).parse(patch),
    ),
  );
  ipc.handle("library:delete-annotation", (id) =>
    database().deleteAssetAnnotation(idSchema.parse(id)),
  );
  ipc.handle("library:batch-update", (scope, patch) =>
    database().batchUpdate(
      selectionSchema.parse(scope),
      z.object({
        addTags: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
        removeTags: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
        replaceTags: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
        favorite: z.boolean().optional(),
        rating: z.number().int().min(0).max(5).optional(),
        colorLabel: z.enum(assetColorLabels).optional(),
        notes: z.string().max(10_000).optional(),
      }).parse(patch),
    ),
  );
  ipc.handle("library:batch-rename", (scope, pattern) =>
    database().batchRename(
      selectionSchema.parse(scope),
      z.string().trim().min(1).max(256).parse(pattern),
    ),
  );
  ipc.handleWithEvent("library:trash", async (event, scope) => {
    const parsedScope = selectionSchema.parse(scope);
    const assets = database().resolveSelection(parsedScope)
      .map((id) => database().getAsset(id))
      .filter((asset): asset is NonNullable<typeof asset> => asset?.lifecycle === "active");
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window, "trash",
      assets.map((asset) => ({ path: asset.path, mode: "existing" })),
    );
    const finalPaths = await dependencies.writeAccess.authorize(
      window, "trash",
      canonical.map((filename) => ({ path: filename, mode: "existing" })),
    );
    return library().trashAssetsByAuthorizedPaths(
      assets.map((asset, index) => ({ id: asset.id, sourcePath: finalPaths[index] })),
    );
  });
  ipc.handle("library:remove-from-library", (scope) =>
    library().removeFromLibrary(selectionSchema.parse(scope)),
  );
  ipc.handleWithEvent("library:restore", async (event, ids) => {
    const parsedIds = idsSchema.parse(ids);
    const plans = await library().planRestoreAssets(parsedIds);
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window, "move",
      plans.flatMap((plan) => [
        { path: plan.sourcePath, mode: "existing" as const },
        { path: plan.targetPath, mode: "destination" as const },
      ]),
    );
    const finalPaths = await dependencies.writeAccess.authorize(
      window, "move",
      canonical.map((filename, index) => ({
        path: filename,
        mode: index % 2 === 0 ? "existing" as const : "destination" as const,
      })),
    );
    return library().restoreAssetsFromPlan(plans.map((plan, index) => ({
      id: plan.id,
      sourcePath: finalPaths[index * 2],
      targetPath: finalPaths[index * 2 + 1],
    })));
  });
  ipc.handleWithEvent("library:purge", async (event, ids) => {
    const parsedIds = idsSchema.parse(ids);
    const entries = parsedIds.map((id) => ({ id, asset: database().getAsset(id) }))
      .filter((entry) => entry.asset?.lifecycle === "trashed" && entry.asset.trashPath);
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window, "trash",
      entries.map((entry) => ({ path: entry.asset!.trashPath!, mode: "existing" })),
    );
    const finalPaths = await dependencies.writeAccess.authorize(
      window, "trash",
      canonical.map((filename) => ({ path: filename, mode: "existing" })),
    );
    return library().purgeAssetsByAuthorizedPaths(entries.map((entry, index) => ({
      id: entry.id,
      trashPath: finalPaths[index],
    })));
  });
  ipc.handle("library:forget-trash", (ids) =>
    library().forgetTrashedAssets(idsSchema.parse(ids)),
  );
  ipc.handle("library:list-trash", (input) =>
    database().searchAssets({
      ...(searchSchema.parse(input) ?? {}),
      lifecycle: "trashed",
    }),
  );
  ipc.handle("library:refresh-links", () => library().refreshLinkStates());
  ipc.handleWithEvent("library:pick-relink", async (event, id) => {
    const assetId = idSchema.parse(id);
    const asset = database().getAsset(assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: `重新定位：${asset.title}`,
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return library().relinkAsset(assetId, result.filePaths[0]);
  });
  ipc.handleWithEvent("library:search-relink", async (event, id) => {
    const assetId = idSchema.parse(id);
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: "选择搜索文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return library().searchAndRelink(assetId, result.filePaths[0]);
  });
  ipc.handleWithEvent("library:add-watch-folder", async (event) => {
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: "添加监控素材文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return library().addWatchRoot(result.filePaths[0]);
  });
  ipc.handle("library:list-watch-roots", () => database().listWatchRoots());
  ipc.handle("library:remove-watch-root", (id) =>
    library().removeWatchRoot(idSchema.parse(id)),
  );
  ipc.handle("library:set-tags", (assetId, tags) =>
    database().setAssetTags(
      idSchema.parse(assetId),
      z.array(z.string().trim().min(1).max(64)).max(64).parse(tags),
    ),
  );
  ipc.handle("library:list-tags", () => database().listTags());
  ipc.handle("library:list-tag-groups", () => database().listTagGroups());
  ipc.handle("library:create-tag-group", (title) =>
    database().createTagGroup(
      z.string().trim().min(1).max(64).parse(title),
    ),
  );
  ipc.handle("library:rename-tag-group", (id, title) =>
    database().renameTagGroup(
      idSchema.parse(id),
      z.string().trim().min(1).max(64).parse(title),
    ),
  );
  ipc.handle("library:delete-tag-group", (id) =>
    database().deleteTagGroup(idSchema.parse(id)),
  );
  ipc.handle("library:move-tag-to-group", (id, groupId) =>
    database().moveTagToGroup(
      idSchema.parse(id),
      groupId === null ? null : idSchema.parse(groupId),
    ),
  );
  ipc.handle("library:rename-tag", (id, name) =>
    database().renameTag(
      idSchema.parse(id),
      z.string().trim().min(1).max(64).parse(name),
    ),
  );
  ipc.handle("library:update-tag-meta", (id, patch) =>
    database().updateTagMeta(
      idSchema.parse(id),
      z
        .object({
          name: z.string().trim().min(1).max(64).optional(),
          alias: z.string().trim().max(64).nullable().optional(),
          shortcutKey: z.string().trim().max(16).nullable().optional(),
        })
        .parse(patch),
    ),
  );
  ipc.handle("library:list-auto-tag-rules", () =>
    database().listAutoTagRules(),
  );
  ipc.handle("library:create-auto-tag-rule", (rule) =>
    database().createAutoTagRule(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          filenamePattern: z.string().max(256).nullable().default(null),
          pathPattern: z.string().max(512).nullable().default(null),
          extension: z.string().regex(/^[a-z0-9]{1,16}$/i).nullable().default(null),
          tags: z.array(z.string().trim().min(1).max(64)).max(64),
          enabled: z.boolean().default(true),
        })
        .parse(rule),
    ),
  );
  ipc.handle("library:update-auto-tag-rule", (id, patch) =>
    database().updateAutoTagRule(
      z.string().min(1).max(64).parse(id),
      z
        .object({
          name: z.string().trim().min(1).max(120).optional(),
          filenamePattern: z.string().max(256).nullable().optional(),
          pathPattern: z.string().max(512).nullable().optional(),
          extension: z.string().regex(/^[a-z0-9]{1,16}$/i).nullable().optional(),
          tags: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
          enabled: z.boolean().optional(),
        })
        .parse(patch),
    ),
  );
  ipc.handle("library:delete-auto-tag-rule", (id) =>
    database().deleteAutoTagRule(z.string().min(1).max(64).parse(id)),
  );
  ipc.handle("library:apply-auto-tag-rules", () =>
    library().applyAutoTagRules(),
  );
  ipc.handle("library:set-custom-thumbnail", (id, thumbnailPath) =>
    library().setCustomThumbnail(
      idSchema.parse(id),
      thumbnailPath === null
        ? null
        : z.string().min(1).max(32_768).parse(thumbnailPath),
    ),
  );
  ipc.handle("library:get-preferences", () => library().getPreferences());
  ipc.handle("library:set-preferences", (prefs) =>
    library().setPreferences(
      z
        .object({
          layoutMode: z.enum(["grid", "waterfall", "detail", "random"]).optional(),
          cardSize: z.enum(["small", "medium", "large"]).optional(),
          thumbnailBackground: z.enum(["checker", "black", "white", "auto"]).optional(),
          includeSubfolderAssets: z.boolean().optional(),
          panelLayout: z
            .object({
              sidebarWidth: z.number().min(180).max(480),
              assetWidth: z.number().min(280).max(720),
              detailsWidth: z.number().min(320).max(1200),
              collapsed: z.array(
                z.enum(["sidebar", "asset", "details"]),
              ).max(3),
            })
            .optional(),
        })
        .parse(prefs),
    ),
  );
  ipc.handle("library:delete-tag", (id) =>
    database().deleteTag(idSchema.parse(id)),
  );
  ipc.handle("library:list-saved-views", () => database().listSavedViews());
  ipc.handle("library:save-view", (title, search) =>
    database().saveView(
      z.string().trim().min(1).max(120).parse(title),
      searchObjectSchema.parse(search),
    ),
  );
  ipc.handle("library:update-saved-view", (id, patch) =>
    database().updateSavedView(
      idSchema.parse(id),
      z
        .object({
          title: z.string().trim().min(1).max(120).optional(),
          search: searchObjectSchema.optional(),
        })
        .parse(patch),
    ),
  );
  ipc.handle("library:duplicate-saved-view", (id) =>
    database().duplicateSavedView(idSchema.parse(id)),
  );
  ipc.handle("library:delete-saved-view", (id) => {
    database().deleteSavedView(idSchema.parse(id));
  });
  ipc.handle("library:list-duplicates", () => library().findDuplicates());
  ipc.handleWithEvent("library:merge-duplicates", async (event, keepId, removeIds) => {
    const parsedRemoveIds = idsSchema.parse(removeIds);
    const assets = parsedRemoveIds.map((id) => database().getAsset(id));
    if (assets.some((asset) => !asset)) throw new Error("ASSET_NOT_FOUND");
    const window = dependencies.windowForSender(event);
    const canonical = await dependencies.writeAccess.authorize(
      window, "trash", assets.map((asset) => ({ path: asset!.path, mode: "existing" })),
    );
    const finalPaths = await dependencies.writeAccess.authorize(
      window, "trash", canonical.map((filename) => ({ path: filename, mode: "existing" })),
    );
    return library().mergeDuplicates(
      idSchema.parse(keepId), parsedRemoveIds,
      new Map(parsedRemoveIds.map((id, index) => [id, finalPaths[index]])),
    );
  });
  ipc.handle("library:find-similar", (id, options) =>
    library().findSimilar(
      idSchema.parse(id),
      z.object({
        limit: z.number().int().min(1).max(500).optional(),
        minScore: z.number().min(0).max(100).optional(),
      }).optional().parse(options),
    ),
  );
  ipc.handle("library:start-similarity-index", () =>
    library().startSimilarityIndex(),
  );
  ipc.handle("library:get-similarity-index", () =>
    library().getSimilarityIndex(),
  );
  ipc.handle("library:cancel-similarity-index", () =>
    library().cancelSimilarityIndex(),
  );
  ipc.handle("library:start-media-metadata-rebuild", () =>
    library().startMediaMetadataRebuild(),
  );
  ipc.handle("library:get-media-metadata-rebuild", () =>
    library().getMediaMetadataRebuild(),
  );
  ipc.handle("library:cancel-media-metadata-rebuild", () =>
    library().cancelMediaMetadataRebuild(),
  );
  ipc.handle("library:references", (id) =>
    database().getAssetReferences(idSchema.parse(id)),
  );
  ipc.handle("library:migrate-paths", (fromRoot, toRoot) =>
    library().migratePaths(
      z.string().min(1).max(32_768).parse(fromRoot),
      z.string().min(1).max(32_768).parse(toRoot),
    ),
  );
  ipc.handleWithEvent("library:collect-project", async (event, boardId) => {
    const parsedId = idSchema.parse(boardId);
    const board = database().loadBoard(parsedId);
    if (!board) throw new Error("BOARD_NOT_FOUND");
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: "选择项目收集目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const requestedDestination = path.join(
      result.filePaths[0],
      `${dependencies.safeFilename(board.summary.title)}.refcanvas-project`,
    );
    const [destination] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [
        { path: requestedDestination, mode: "destination" },
      ],
    );
    await mkdir(destination, { recursive: true });
    const assets = [];
    for (const assetId of database().getBoardAssetIds(parsedId)) {
      assets.push(await dependencies.copyProjectAsset(assetId, destination));
    }
    await writeFile(
      path.join(destination, "board.json"),
      JSON.stringify(board.document, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(destination, "manifest.json"),
      JSON.stringify(
        {
          format: "refcanvas-project",
          version: 1,
          board: board.summary,
          assets,
          collectedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
    return destination;
  });
  ipc.handle("library:stats", () => database().getLibraryStats());
}
