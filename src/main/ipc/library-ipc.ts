import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { assetColorLabels } from "../../shared/contracts";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { LibraryManager } from "../services/library-manager";
import { BundleService } from "../services/bundle-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";
import {
  idSchema,
  pathsSchema,
  searchWindowSchema,
} from "./schemas";

interface LibraryIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  getLibrary(): LibraryService;
  getLibraryManager(): LibraryManager;
  getThumbnailCacheDirectory(): string;
  getPreviewCacheIndexFilenames(): string[];
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
  ipc.handle("library:update", (id, patch) => {
    const parsedPatch = z
      .object({
        title: z.string().trim().min(1).max(256).optional(),
        notes: z.string().max(10_000).optional(),
        favorite: z.boolean().optional(),
        rating: z.number().int().min(0).max(5).optional(),
        colorLabel: z.enum(assetColorLabels).optional(),
        // 浏览器捕获回写来源信息（sourceUrl/pageTitle/alt）等本地自定义
        // 键值：整体替换写入，缺省 = 保持不变。
        customFields: z
          .record(z.string().trim().min(1).max(64), z.string().max(2_000))
          .optional(),
      })
      .parse(patch);
    return database().updateAsset(idSchema.parse(id), parsedPatch);
  });
  ipc.handle("library:set-tags", (assetId, tags) =>
    database().setAssetTags(
      idSchema.parse(assetId),
      z.array(z.string().trim().min(1).max(64)).max(64).parse(tags),
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
  ipc.handle("library:preview-auto-tag-rule", (rule) =>
    library().previewAutoTagRule(
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
  ipc.handle("library:apply-auto-tag-rules", () =>
    library().applyAutoTagRules(),
  );
  ipc.handle("library:get-preferences", () => library().getPreferences());
  ipc.handle("library:set-preferences", (prefs) =>
    library().setPreferences(
      z
        .object({
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
  ipc.handle("library:find-similar", (id, options) =>
    library().findSimilar(
      idSchema.parse(id),
      z.object({
        limit: z.number().int().min(1).max(500).optional(),
        minScore: z.number().min(0).max(100).optional(),
      }).optional().parse(options),
    ),
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
  // library:collect-project 已移除：导出统一为 boards:export-package 自包含单文件包

  // SPEC-2：库可移植性 —— 整机库打包导出 / 导入。
  ipc.handleWithEvent("library:export-bundle", async (event) => {
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: "选择库导出目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const [targetDirectory] = await dependencies.writeAccess.authorizePickerSelection(
      [{ path: result.filePaths[0], mode: "destination" }],
    );
    const bundle = new BundleService({
      getDatabase: dependencies.getDatabase,
      getLibraryManager: dependencies.getLibraryManager,
      getThumbnailCacheDirectory: dependencies.getThumbnailCacheDirectory,
      getPreviewCacheIndexFilenames: dependencies.getPreviewCacheIndexFilenames,
    });
    return bundle.exportBundle(
      targetDirectory,
      `RefCanvas-库-${new Date().toISOString().slice(0, 10)}`,
    );
  });
  ipc.handle("library:import-bundle", async (options) => {
    const parsed = z
      .object({
        bundlePath: z.string().min(1).max(32_768),
        rootRules: z
          .array(
            z.object({
              from: z.string().min(1).max(32_768),
              to: z.string().min(1).max(32_768),
            }),
          )
          .max(128)
          .default([]),
      })
      .parse(options);
    const bundle = new BundleService({
      getDatabase: dependencies.getDatabase,
      getLibraryManager: dependencies.getLibraryManager,
      getThumbnailCacheDirectory: dependencies.getThumbnailCacheDirectory,
      getPreviewCacheIndexFilenames: dependencies.getPreviewCacheIndexFilenames,
    });
    const result = await bundle.importBundle(
      assertAbsoluteLocalPath(parsed.bundlePath),
      parsed.rootRules,
    );
    // 导入后自动重启以应用新库与路径重映射（仿备份恢复）。
    const { app } = await import("electron");
    app.relaunch();
    app.exit(0);
    return { ...result, requiresRestart: true };
  });
}
