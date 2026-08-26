import {
  app,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  nativeImage,
  screen,
  shell,
  type BrowserWindow,
  type Display,
  type IpcMainInvokeEvent,
} from "electron";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AppLanguage,
  AppPreferences,
  BoardSettings,
  CaptureSource,
  SidebarLayoutPreference,
} from "../../shared/contracts";
import { SIDEBAR_LAYOUT_DEFAULTS } from "../../shared/contracts";
import { mergePreviewSettings, readPreviewSettings } from "./preview-settings";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryManager } from "../services/library-manager";
import type { LibraryService } from "../services/library-service";
import { resolveNativeDragAssets } from "../platform/native-drag";
import { resolveNativeDragIcon } from "../platform/native-drag-icon";
import { assertAbsoluteLocalPath } from "../platform/local-path-security";
import type { PreviewCacheIndex } from "../platform/preview-cache-index";
import type { PreviewQueue } from "../platform/preview-queue";
import { revealInFileManager } from "../platform/reveal-in-file-manager";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import type { WriteAccessController } from "../platform/write-access-controller";
import { ThumbnailWorkerClient } from "../platform/thumbnail-worker-client";
import {
  isWindowsUninstallAvailable,
  launchWindowsUninstaller,
} from "../platform/windows-installer";
import { nativeDragIdsSchema } from "./schemas";

export interface SystemIpcState {
  alwaysOnBottom: boolean;
  captureWasFullScreen: boolean;
  /** 待传给独立覆盖窗口的抓屏快照；覆盖窗口启动后消费并清空。 */
  pendingCaptureSource: CaptureSource | null;
  clickThrough: boolean;
  previewCacheIndex: PreviewCacheIndex | null;
  rendererInteractive: boolean;
  thumbnailCacheDirectory: string;
  thumbnailWorker: ThumbnailWorkerClient | null;
  transparentOverlay: boolean;
}

interface SystemIpcDependencies {
  configureGlobalShortcuts(enabled: boolean): boolean;
  getDatabase(): RefCanvasDatabase;
  getDatabaseFilename(): string;
  getLibrary(): LibraryService;
  getLibraryManager(): LibraryManager;
  /** 启动期迁移失败时的恢复信息；失败时 Renderer 展示恢复页而非主工作区。 */
  getMigrationRecovery(): MigrationRecoveryInfo;
  /** SPEC-1/SPEC-7：启动健康状态（正常 / 只读降级 / 安全模式 / 版本过新）。 */
  getStartupHealth(): {
    mode: "ok" | "degraded" | "safe" | "too-new";
    databasePath: string | null;
    reason: string | null;
    /** 上次是否异常退出（clean-shutdown 标记缺失）。 */
    previousCrash: boolean;
  };
  /** SPEC-1 安全模式：列出最近备份（供"从最近备份恢复"）。 */
  recoverListBackups(): Promise<
    Array<{ filename: string; path: string; createdAt: string }>
  >;
  /** SPEC-1 安全模式：从指定备份恢复主库并重启。 */
  recoverRestoreBackup(filename: string): Promise<void>;
  /** SPEC-1 安全模式：新建空库（删除损坏主库）并重启。 */
  recoverNewDatabase(): Promise<void>;
  getMainWindow(): BrowserWindow | null;
  closeCaptureWindow(): void;
  openCaptureWindow(display: Display): void;
  overlayExitAccelerator: string;
  pngDataUrlToBuffer(dataUrl: string): Buffer;
  registerOverlayEmergencyShortcut(): boolean;
  restoreCaptureWindow(): void;
  saveCapture(buffer: Buffer, directory?: string): Promise<string>;
  scheduleBackgroundServices(): void;
  state: SystemIpcState;
  thumbnailQueue: PreviewQueue<Buffer>;
  thumbnailWorker: ThumbnailWorkerClient | null;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess: WriteAccessController;
}

/**
 * 启动期迁移失败的恢复信息（FND-001）。
 *
 * 迁移失败时应用停留在恢复页，不进入主工作区；Renderer 展示数据库路径、
 * 迁移备份目录与失败步骤，供用户定位备份文件。
 */
export interface MigrationRecoveryInfo {
  failed: boolean;
  databasePath: string | null;
  backupDirectory: string | null;
  entries: Array<{
    stepId: string;
    fromVersion: number;
    toVersion: number;
    error: string | null;
  }>;
}

const sequenceRuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  pattern: z.string().min(1).max(512),
  minFrames: z.number().int().min(1).max(10_000),
});

const mp4PresetSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  enabled: z.boolean(),
  codec: z.enum(["h264", "h265"]),
  quality: z.enum(["medium", "high", "best"]),
  resolution: z.enum(["original", "half", "quarter"]),
});

const previewFormatGroupSchema = z.object({
  id: z.enum(["model3d", "image", "video", "audio", "pdf"]),
  label: z.string().trim().min(1).max(32),
  extensions: z
    .array(z.string().trim().regex(/^\.?[a-z0-9]{1,16}$/i))
    .max(128),
});

const previewSettingsPatchSchema = z.object({
  showHiddenFiles: z.boolean().optional(),
  folderClickMode: z.enum(["single", "double"]).optional(),
  defaultFlattenDepth: z.number().int().min(0).max(8).optional(),
  flattenPerFolder: z
    .record(z.string(), z.number().int().min(0).max(8))
    .optional(),
  formatGroups: z.array(previewFormatGroupSchema).max(5).optional(),
  formatWhitelist: z
    .array(z.string().trim().regex(/^\.?[a-z0-9]{1,16}$/i))
    .max(256)
    .optional(),
  autoplayVideo: z.boolean().optional(),
  autoplaySequence: z.boolean().optional(),
  collapseImageSequences: z.boolean().optional(),
  autoplayModel3d: z.boolean().optional(),
  defaultSequenceFps: z.number().int().min(1).max(240).optional(),
  sequenceFpsPresets: z
    .array(z.number().int().min(1).max(240))
    .min(1)
    .max(10)
    .optional(),
  sequenceMinFrames: z.number().int().min(1).max(10_000).optional(),
  sequenceRules: z.array(sequenceRuleSchema).max(50).optional(),
  alphaBackground: z.enum(["black", "white", "checker", "custom"]).optional(),
  alphaCustomColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  uiScale: z.number().min(0.8).max(1.5).optional(),
  previewConcurrency: z.number().int().min(1).max(16).optional(),
  thumbnailWorkerThreads: z.number().int().min(1).max(8).optional(),
  downscaleMode: z.enum(["suffix", "subdirectory", "backup"]).optional(),
  downscaleSuffix: z
    .string()
    .max(32)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  downscaleSubdirectory: z
    .string()
    .max(128)
    .regex(/^[^\\/:*?"<>|]+$/)
    .optional(),
  defaultMp4PresetId: z.string().min(1).max(64).optional(),
  mp4Presets: z.array(mp4PresetSchema).min(1).max(3).optional(),
  ocioConfigPath: z.string().max(4096).nullable().optional(),
  lutDirectories: z.array(z.string().max(4096)).max(50).optional(),
  activeLut: z.string().max(4096).nullable().optional(),
  debugLogging: z.boolean().optional(),
  closeBehavior: z.enum(["quit", "tray"]).optional(),
});

export function registerSystemIpc(
  ipc: SecureIpcRegistrar,
  dependencies: SystemIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();
  const library = () => dependencies.getLibrary();
  const libraryManager = () => dependencies.getLibraryManager();
  const mainWindow = () => dependencies.getMainWindow();
  const state = dependencies.state;

  ipc.handle("system:open-external", async (filename) => {
    const local = assertAbsoluteLocalPath(z.string().min(1).max(32_768).parse(filename));
    const error = await shell.openPath(local);
    if (error) throw new Error(`OPEN_PATH_FAILED: ${error}`);
  });
  ipc.handle("system:open-url", async (url) => {
    const parsed = z.string().url().max(32_768).parse(url);
    // 仅放行 http(s)：openExternal 会把任意 scheme 交给系统处理，
    // file:/smb:/自定义协议等于开放任意程序的攻击面，必须收窄。
    if (!/^https?:$/.test(new URL(parsed).protocol)) {
      throw new Error("UNSUPPORTED_URL_SCHEME");
    }
    await shell.openExternal(parsed);
  });
  ipc.handle("system:open-recycle-bin", async () => {
    if (process.platform !== "win32") {
      throw new Error("RECYCLE_BIN_UNAVAILABLE");
    }
    await shell.openExternal("shell:RecycleBinFolder");
  });
  ipc.handle("system:open-files-with-default-app", async (paths) => {
    const parsed = z.array(z.string().min(1).max(32_768)).min(1).max(500).parse(paths)
      .map(assertAbsoluteLocalPath);
    const errors = (await Promise.all(parsed.map((filename) => shell.openPath(filename))))
      .filter(Boolean);
    if (errors.length) throw new Error(`OPEN_PATH_FAILED: ${errors.join("; ")}`);
  });
  ipc.handle("system:reveal", async (filename) => {
    await revealInFileManager(
      assertAbsoluteLocalPath(z.string().min(1).max(32_768).parse(filename)),
      shell,
    );
  });
  ipc.handle("system:open-data-folder", async () => {
    await shell.openPath(app.getPath("userData"));
  });
  ipc.handleWithEvent("system:request-uninstall", async (event) => {
    if (dependencies.windowForSender(event) !== mainWindow()) {
      throw new Error("MAIN_WINDOW_ONLY");
    }
    if (!isWindowsUninstallAvailable(process.platform, app.isPackaged)) {
      throw new Error("UNINSTALL_UNAVAILABLE");
    }
    await launchWindowsUninstaller();
    const quitTimer = setTimeout(() => app.quit(), 750);
    quitTimer.unref();
    return true;
  });
  ipc.handleWithEvent("system:pick-directory", async (event, options) => {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(120),
        defaultPath: z.string().min(1).max(32_768).optional(),
      })
      .parse(options);
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: parsed.title,
      defaultPath: parsed.defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipc.handleWithEvent("system:pick-file", async (event, options) => {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(120),
        defaultPath: z.string().min(1).max(32_768).optional(),
        filters: z
          .array(
            z.object({
              name: z.string().max(64),
              extensions: z.array(z.string().max(16)).max(32),
            }),
          )
          .max(8)
          .optional(),
        multiSelections: z.boolean().optional(),
      })
      .parse(options);
    const result = await dialog.showOpenDialog(dependencies.windowForSender(event), {
      title: parsed.title,
      defaultPath: parsed.defaultPath,
      properties: [
        "openFile",
        ...(parsed.multiSelections ? (["multiSelections"] as const) : []),
      ],
      filters: parsed.filters,
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipc.handleWithEvent("system:save-rendered-image", async (event, dataUrl, options) => {
    const parsedData = z.string().max(100_000_000).regex(/^data:image\/png;base64,/).parse(dataUrl);
    const parsed = z.object({
      mode: z.enum(["export", "thumbnail"]),
      assetId: z.string().uuid().optional(),
      defaultName: z.string().min(1).max(128).optional(),
    }).parse(options);
    const png = dependencies.pngDataUrlToBuffer(parsedData);
    if (parsed.mode === "thumbnail") {
      if (!parsed.assetId) throw new Error("MODEL_THUMBNAIL_ASSET_REQUIRED");
      const directory = path.join(app.getPath("userData"), "custom-thumbnails");
      const filename = path.join(directory, `${parsed.assetId}.png`);
      await mkdir(directory, { recursive: true });
      await writeFile(filename, png);
      const asset = dependencies.getLibrary().setCustomThumbnail(parsed.assetId, filename);
      return { mode: "thumbnail" as const, asset };
    }
    const safeName = (parsed.defaultName ?? "RefCanvas-3D")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\.png$/i, "")
      .slice(0, 120);
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "保存 3D 视图",
      defaultPath: path.join(app.getPath("pictures"), `${safeName}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const [destination] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "export", [
      { path: result.filePath, mode: "destination" },
    ]);
    await writeFile(destination, png);
    return { mode: "export" as const, path: destination };
  });
  ipc.handleWithEvent("system:toggle-always-on-top", (event) => {
    const window = dependencies.windowForSender(event);
    const next = !window.isAlwaysOnTop();
    window.setAlwaysOnTop(next);
    return next;
  });
  ipc.handle("system:mark-renderer-interactive", () => {
    state.rendererInteractive = true;
    dependencies.scheduleBackgroundServices();
  });
  ipc.handleWithEvent("system:set-always-on-bottom", (event, enabled) => {
    const next = z.boolean().parse(enabled);
    const window = dependencies.windowForSender(event);
    state.alwaysOnBottom = next;
    if (next) {
      // Electron/Windows has no persistent bottom-most API. Do not call
      // moveTop(), which produces the exact opposite result.
      window.setAlwaysOnTop(false);
      window.blur();
    }
    return next;
  });
  ipc.handleWithEvent("system:set-click-through", (event, enabled) => {
    // 点击穿透/透明与主窗口应急快捷键绑定，仅主窗口可用。
    if (dependencies.windowForSender(event) !== mainWindow()) {
      throw new Error("MAIN_WINDOW_ONLY");
    }
    const next = z.boolean().parse(enabled);
    state.clickThrough = next;
    mainWindow()!.setIgnoreMouseEvents(next);
    return next;
  });
  ipc.handleWithEvent("system:set-window-transparent", (event, enabled) => {
    if (dependencies.windowForSender(event) !== mainWindow()) {
      throw new Error("MAIN_WINDOW_ONLY");
    }
    const next = z.boolean().parse(enabled);
    if (next && !dependencies.registerOverlayEmergencyShortcut()) {
      throw new Error("OVERLAY_EMERGENCY_SHORTCUT_UNAVAILABLE");
    }
    state.transparentOverlay = next;
    mainWindow()!.setFocusable(true);
    mainWindow()!.setOpacity(next ? 0.82 : 1.0);
    if (!next) {
      state.clickThrough = false;
      mainWindow()!.setIgnoreMouseEvents(false);
      globalShortcut.unregister(dependencies.overlayExitAccelerator);
    }
    return next;
  });
  ipc.handleWithEvent("system:get-window-mode-state", (event) => {
    const window = dependencies.windowForSender(event);
    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      alwaysOnBottom: state.alwaysOnBottom,
      clickThrough: state.clickThrough,
    };
  });
  ipc.handleWithEvent("system:set-presentation-mode", async (event, enabled) => {
    const next = z.boolean().parse(enabled);
    const window = dependencies.windowForSender(event);
    window.setFullScreen(next);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.isFullScreen() === next) return next;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.isFullScreen();
  });
  ipc.handleWithEvent("system:capture-clipboard", async (event) => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const [captureDirectory] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "export", [
      { path: path.join(app.getPath("pictures"), "RefCanvas Captures"), mode: "destination" },
    ]);
    const filename = await dependencies.saveCapture(image.toPNG(), captureDirectory);
    await library().importPaths([filename]);
    return database().getAssetByPath(filename);
  });
  ipc.handle("system:prepare-region-capture", async () => {
    const window = mainWindow();
    if (!window) return null;
    // 抓取窗口所在显示器的屏幕快照。用独立覆盖窗口承载框选，主窗口无需
    // 隐藏/全屏切换——这样不再“要关掉 RefCanvas 才能截图”。
    const display = screen.getDisplayMatching(window.getBounds());
    window.hide();
    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor),
        },
      });
      const source =
        sources.find((item) => item.display_id === String(display.id)) ??
        sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        // 拿不到屏幕快照（系统策略/驱动限制等）必须显式抛错：静默返回
        // null 会让渲染端毫无反馈，用户只看到窗口闪一下（“点了没反应”）。
        throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
      }
      const size = source.thumbnail.getSize();
      state.pendingCaptureSource = {
        dataUrl: source.thumbnail.toDataURL(),
        width: size.width,
        height: size.height,
      };
      // 主窗口重新可见，随后打开独立全屏覆盖窗口承载框选。
      window.show();
      window.focus();
      dependencies.openCaptureWindow(display);
      return state.pendingCaptureSource;
    } catch (error) {
      dependencies.restoreCaptureWindow();
      throw error;
    }
  });
  ipc.handle("system:get-capture-source", () => {
    // 独立覆盖窗口启动后消费抓屏快照；一次性读取，避免残留。
    const source = state.pendingCaptureSource;
    state.pendingCaptureSource = null;
    return source;
  });
  ipc.handleWithEvent("system:save-region-capture", async (event, dataUrl) => {
    try {
      const [captureDirectory] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "export", [
        { path: path.join(app.getPath("pictures"), "RefCanvas Captures"), mode: "destination" },
      ]);
      const png = dependencies.pngDataUrlToBuffer(z.string().parse(dataUrl));
      const filename = await dependencies.saveCapture(png, captureDirectory);
      // 截图同时写入系统剪贴板：这样在参考版（或任何应用）里 Ctrl+V
      // 就能直接粘贴刚截的图，无需先去文件管理器复制。
      clipboard.writeImage(nativeImage.createFromBuffer(png));
      await library().importPaths([filename]);
      return database().getAssetByPath(filename);
    } finally {
      dependencies.closeCaptureWindow();
    }
  });
  ipc.handle("system:cancel-region-capture", () => {
    dependencies.closeCaptureWindow();
  });
  ipc.handle("system:rebuild-thumbnail-cache", async () => {
    const resolved = path.resolve(state.thumbnailCacheDirectory);
    const userData = path.resolve(app.getPath("userData"));
    if (!resolved.startsWith(`${userData}${path.sep}`)) {
      throw new Error("INVALID_CACHE_PATH");
    }
    dependencies.thumbnailQueue.clear("THUMBNAIL_CACHE_REBUILD");
    state.thumbnailWorker?.close();
    state.thumbnailWorker = null;
    state.previewCacheIndex?.clear();
    await rm(resolved, { recursive: true, force: true });
    await mkdir(resolved, { recursive: true });
    state.thumbnailWorker = new ThumbnailWorkerClient(
      path.join(__dirname, "thumbnail-worker.js"),
      resolved,
      readPreviewSettings(database()).thumbnailWorkerThreads,
    );
  });
  ipc.handleWithEvent("system:export-diagnostics", async (event) => {
    const result = await dialog.showSaveDialog(dependencies.windowForSender(event), {
      title: "导出诊断信息",
      defaultPath: path.join(
        app.getPath("documents"),
        `RefCanvas-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const [destination] = await dependencies.writeAccess.authorize(dependencies.windowForSender(event), "export", [
      { path: result.filePath, mode: "destination" },
    ]);
    const databaseStat = await stat(dependencies.getDatabaseFilename()).catch(
      () => null,
    );
    const payload = {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      schemaVersion: database().getSchemaVersion(),
      databaseBytes: databaseStat?.size ?? 0,
      databaseIntegrity: database().integrityCheck(),
      library: database().getLibraryStats(),
      generatedAt: new Date().toISOString(),
    };
    await writeFile(destination, JSON.stringify(payload, null, 2), "utf8");
    return destination;
  });
  ipc.handle("system:set-global-shortcuts", (enabled) =>
    dependencies.configureGlobalShortcuts(z.boolean().parse(enabled)),
  );
  const readAppPreferences = (): AppPreferences => ({
    globalShortcuts: database().getSetting("globalShortcuts", false),
    backgroundResidency: database().getSetting("backgroundResidency", false),
    // 历史版本可能存过 zh-TW/ja 等已下线语言：读取时钳制回 en，避免渲染层
    // 拿到 catalog 之外的键。
    language: ["zh-CN", "en"].includes(database().getSetting("language", "en"))
      ? database().getSetting<AppLanguage>("language", "en")
      : "en",
    boardSettings: database().getSetting<BoardSettings>("boardSettings", {
      interactionPreset: "pureref",
      snapEnabled: true,
      bringToFrontOnSelect: false,
      sampling: "bilinear",
      undoLimit: 99,
    }),
    previewSettings: readPreviewSettings(database()),
    // 旧库无该键或字段缺失时回退默认（读取时合并，写入总是完整对象）。
    sidebarLayout: {
      ...SIDEBAR_LAYOUT_DEFAULTS,
      ...database().getSetting<Partial<SidebarLayoutPreference> | null>(
        "sidebarLayout",
        null,
      ),
    },
  });
  ipc.handle("system:get-preferences", readAppPreferences);
  ipc.handle("system:set-preferences", (prefs) => {
    const parsed = z
      .object({
        globalShortcuts: z.boolean().optional(),
        backgroundResidency: z.boolean().optional(),
        language: z
          .enum(["zh-CN", "en"])
          .optional(),
        boardSettings: z
          .object({
            interactionPreset: z.enum(["pureref", "standard"]).optional(),
            snapEnabled: z.boolean().optional(),
            bringToFrontOnSelect: z.boolean().optional(),
            sampling: z.enum(["nearest", "bilinear"]).optional(),
            undoLimit: z.number().int().min(1).max(500).optional(),
          })
          .optional(),
        previewSettings: previewSettingsPatchSchema.optional(),
        sidebarLayout: z
          .object({
            quickAccessHeight: z.number().int().min(80).max(8192).optional(),
            directoryHeight: z.number().int().min(80).max(8192).optional(),
            boardHeight: z.number().int().min(80).max(8192).optional(),
          })
          .optional(),
      })
      .parse(prefs);
    if (parsed.globalShortcuts !== undefined) {
      dependencies.configureGlobalShortcuts(parsed.globalShortcuts);
    }
    if (parsed.backgroundResidency !== undefined) {
      database().setSetting("backgroundResidency", parsed.backgroundResidency);
    }
    if (parsed.language !== undefined) {
      database().setSetting("language", parsed.language);
    }
    if (parsed.boardSettings !== undefined) {
      database().setSetting("boardSettings", {
        ...readAppPreferences().boardSettings,
        ...parsed.boardSettings,
      });
    }
    if (parsed.sidebarLayout !== undefined) {
      database().setSetting("sidebarLayout", {
        ...readAppPreferences().sidebarLayout,
        ...parsed.sidebarLayout,
      });
    }
    if (parsed.previewSettings !== undefined) {
      const current = readPreviewSettings(database());
      const next = mergePreviewSettings(current, parsed.previewSettings);
      database().setSetting("previewSettings", next);
      // 旧键存在则顺带清理（异常忽略，不影响新键写入）。
      try {
        if (database().getSetting<unknown>("foundSettings", null) !== null) {
          database().setSetting("foundSettings", null);
        }
      } catch {
        // 忽略旧键清理失败。
      }
      // 偏好变更即时生效（§10 验收：进入任务参数）。
      if (
        parsed.previewSettings.previewConcurrency !== undefined &&
        parsed.previewSettings.previewConcurrency !== current.previewConcurrency
      ) {
        dependencies.thumbnailQueue.setConcurrency(
          parsed.previewSettings.previewConcurrency,
        );
      }
      if (parsed.previewSettings.thumbnailWorkerThreads !== undefined) {
        dependencies.thumbnailWorker?.setConcurrency(
          parsed.previewSettings.thumbnailWorkerThreads,
        );
      }
      if (parsed.previewSettings.debugLogging !== undefined) {
        database().setSetting("debugLogging", parsed.previewSettings.debugLogging);
      }
      if (parsed.previewSettings.closeBehavior !== undefined) {
        database().setSetting("closeBehavior", parsed.previewSettings.closeBehavior);
      }
    }
    return readAppPreferences();
  });
  ipc.handle("system:get-app-info", () => {
    const entry = libraryManager().currentEntry();
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      databaseSchemaVersion: database().getSchemaVersion(),
      libraryPath: entry?.root ?? null,
      libraryName: entry?.name ?? null,
      installChannel: app.isPackaged ? "signed" : "unsigned",
      platform: process.platform,
      userDataPath: app.getPath("userData"),
      uninstallAvailable: isWindowsUninstallAvailable(
        process.platform,
        app.isPackaged,
      ),
    };
  });
  ipc.handle("system:get-migration-failure", () => {
    // 迁移失败时不依赖 database（可能未打开），恢复信息由启动流程缓存提供。
    return dependencies.getMigrationRecovery();
  });
  ipc.handle("system:get-startup-health", () => {
    return dependencies.getStartupHealth();
  });
  ipc.handle("system:recover-list-backups", () => {
    return dependencies.recoverListBackups();
  });
  ipc.handle("system:recover-restore-backup", async (filename) => {
    const parsed = z.string().min(1).max(32_768).parse(filename);
    await dependencies.recoverRestoreBackup(parsed);
  });
  ipc.handle("system:recover-new-database", async () => {
    await dependencies.recoverNewDatabase();
  });
  ipc.handle("system:write-clipboard", (text) => {
    const value = z.string().max(100_000).parse(text);
    clipboard.writeText(value);
  });
  ipc.handle("system:get-navigation-state", () =>
    database().getSetting<string | null>("navigationState", null),
  );
  ipc.handle("system:set-navigation-state", (value) => {
    database().setSetting(
      "navigationState",
      z.string().max(100_000).parse(value),
    );
  });
  ipc.handle("system:get-board-shortcuts", () =>
    database().getSetting<Record<string, string> | null>(
      "boardShortcuts",
      null,
    ),
  );
  ipc.handle("system:set-board-shortcuts", (value) => {
    const parsed = z
      .record(z.string().min(1).max(64), z.string().max(64))
      .refine((bindings) => Object.keys(bindings).length <= 64)
      .parse(value);
    database().setSetting("boardShortcuts", parsed);
  });
  ipc.on("system:start-native-drag", (event, value) => {
    const parsed = nativeDragIdsSchema.safeParse(value);
    if (!parsed.success) return;
    const assets = resolveNativeDragAssets(
      parsed.data,
      (id) => database().getAsset(id),
    );
    if (!assets.length) return;
    const files = assets.map((asset) => asset.path);
    const first = assets[0];
    // 图标必须非空：Electron 的 startDrag 在图标为空时静默失败，拖拽不会开始。
    // 图片直读、非图片走缩略图缓存，逐级兜底到应用图标/内嵌图标。
    const icon = resolveNativeDragIcon(
      first.path,
      {
        createFromPath: (filePath) => nativeImage.createFromPath(filePath),
        createFromDataUrl: (dataUrl) => nativeImage.createFromDataURL(dataUrl),
      },
      {
        getAssetByPath: (filename) =>
          database().getAssetByPath(filename) ?? null,
        thumbnailCacheDirectory: state.thumbnailCacheDirectory,
      },
      app.getAppPath(),
    );
    if (icon.isEmpty()) return;
    event.sender.startDrag({
      file: files[0],
      files,
      icon,
    });
  });
}
