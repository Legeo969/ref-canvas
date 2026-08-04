import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
  type WebFrameMain,
} from "electron";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BackupService } from "./services/backup-service";
import { ActionService } from "./services/action-service";
import { RefCanvasDatabase } from "./persistence/database";
import {
  LibraryManager,
  backupDirectoryFor,
  databasePathFor,
  trashPathFor,
  type LibraryEntry,
} from "./services/library-manager";
import { LibraryService } from "./services/library-service";
import { FilesystemService } from "./services/filesystem-service";
import { FileOperationsService } from "./services/file-operations-service";
import { MountService } from "./services/mount-service";
import { DirectoryIndexClient } from "./platform/directory-index-client";
import { ImportEnumeratorClient } from "./platform/import-enumerator-client";
import { DirectoryBatchService } from "./services/directory-batch-service";
import { PreviewTokenRegistry } from "./platform/refbrowse";
import { PreviewQueue } from "./platform/preview-queue";
import { PreviewCacheIndex } from "./platform/preview-cache-index";
import { ThumbnailWorkerClient } from "./platform/thumbnail-worker-client";
import { ProviderRegistry } from "./platform/provider-registry";
import { GenericProvider } from "./providers/generic-provider";
import { HdrProvider } from "./providers/hdr-provider";
import { GeometryProvider } from "./providers/geometry-provider";
import { VideoProvider } from "./providers/video-provider";
import { ImageProvider } from "./providers/image-provider";
import { AudioProvider } from "./providers/audio-provider";
import { FontProvider } from "./providers/font-provider";
import { DocumentProvider } from "./providers/document-provider";
import { DccProvider } from "./providers/dcc-provider";
import { registerProtocols } from "./platform/protocols";
import {
  registerWindowsProjectFormat,
  registerWindowsSendTo,
  removeWindowsIntegration,
  updateSquirrelShortcut,
} from "./platform/windows-integration";
import { SecureIpcRegistrar } from "./platform/secure-ipc";
import { registerActionIpc } from "./ipc/action-ipc";
import { registerBackupIpc } from "./ipc/backup-ipc";
import { registerBoardIpc } from "./ipc/board-ipc";
import { boardDocumentSchema } from "./ipc/board-schema";
import { registerFilesystemIpc } from "./ipc/filesystem-ipc";
import { registerLibraryIpc } from "./ipc/library-ipc";
import { registerLibraryManagementIpc } from "./ipc/library-management-ipc";
import { registerMediaNotesIpc } from "./ipc/media-notes-ipc";
import { registerResourcesIpc } from "./ipc/resources-ipc";
import { registerSystemIpc } from "./ipc/system-ipc";
import { trayIconPaths } from "./platform/tray-icon";
import {
  hardenWindowNavigation,
  secureWebPreferences,
} from "./platform/window-security";
import type { BoardDocument } from "../shared/contracts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "refasset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "refbrowse",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
/** 独立白板窗口：boardId → BrowserWindow（同一白板同时只允许一个窗口）。 */
const boardWindows = new Map<string, BrowserWindow>();
let database: RefCanvasDatabase;
let library: LibraryService;
let backups: BackupService;
let actions: ActionService;
let libraryManager: LibraryManager;
let directoryService: FilesystemService;
let directoryBatches: DirectoryBatchService;
let fileOperations: FileOperationsService;
let mountService: MountService;
let captureWasFullScreen = false;
let thumbnailCacheDirectory = "";
let databaseFilename = "";
let alwaysOnBottom = false;
let clickThrough = false;
let transparentOverlay = false;
let rendererInteractive = false;
let backgroundStartTimer: NodeJS.Timeout | null = null;
let tray: Electron.Tray | null = null;
let trayPaused = false;
let quitting = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;
/** FPS 采集模式：给渲染层加载 URL 追加 ?fps=1，暴露测试钩子。 */
const fpsCheckMode = process.argv.includes("--fps-check");
/** 会话级 refbrowse 预览 token 注册表（URL 永不含绝对路径）。 */
const previewTokens = new PreviewTokenRegistry();
const thumbnailQueue = new PreviewQueue<Buffer>(4, 512);
let previewCacheIndex: PreviewCacheIndex | null = null;
let thumbnailWorker: ThumbnailWorkerClient | null = null;
/** 全局 typed provider registry（计划 §6.1）：Renderer 不加载第三方 DLL。 */
let providerRegistry: ProviderRegistry | null = null;
const overlayExitAccelerator = "CommandOrControl+Alt+Shift+R";
const squirrelEvent = process.argv.find((value) =>
  value.startsWith("--squirrel-"),
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

async function trashDirectoryPath(filename: string): Promise<void> {
  try {
    await shell.trashItem(filename);
  } catch {
    const fallback = directoryService.fallbackTrashRoot;
    await mkdir(fallback, { recursive: true });
    await rename(
      filename,
      path.join(fallback, `${path.basename(filename)}-${Date.now()}`),
    );
  }
  const existing = database.getAssetByPath(filename);
  if (existing && existing.lifecycle === "active") {
    database.setLinkState(existing.id, "missing");
  }
}

/**
 * 修复存量 watch root 与 mount root 的 1:1 关联：为缺少 mount_roots 记录的
 * watch root 补注册挂载根（计划 §7.2 / §7.5）。
 */
function repairMountRoots(): void {
  const mountRoots = new Set(database.listMountRoots().map((item) => item.id));
  for (const watchRoot of database.listWatchRoots()) {
    if (mountRoots.has(watchRoot.id)) continue;
    database.upsertMountRoot({
      id: watchRoot.id,
      path: watchRoot.path,
      displayName: path.basename(watchRoot.path) || watchRoot.path,
      state: "online",
    });
  }
}

function pngDataUrlToBuffer(dataUrl: string): Buffer {
  const parsed = z
    .string()
    .max(100_000_000)
    .regex(/^data:image\/png;base64,/)
    .parse(dataUrl);
  return Buffer.from(parsed.slice(parsed.indexOf(",") + 1), "base64");
}

async function saveCapture(buffer: Buffer): Promise<string> {
  const directory = path.join(app.getPath("pictures"), "RefCanvas Captures");
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const filename = path.join(directory, `RefCanvas-${stamp}.png`);
  await writeFile(filename, buffer);
  return filename;
}

function restoreCaptureWindow(): void {
  if (!mainWindow) return;
  mainWindow.setFullScreen(captureWasFullScreen);
  mainWindow.show();
  mainWindow.focus();
}

function safeFilename(value: string): string {
  // Control chars are stripped deliberately: they are illegal in filenames.
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120);
}

async function copyProjectAsset(
  assetId: string,
  destination: string,
): Promise<{ id: string; source: string; relativePath: string }> {
  const asset = database.getAsset(assetId);
  const source = database.getAssetPath(assetId);
  if (!asset || !source) throw new Error("ASSET_FILE_NOT_FOUND");
  const assetDirectory = path.join(destination, "assets", assetId);
  await mkdir(assetDirectory, { recursive: true });
  const relativePath = path.join("assets", assetId, path.basename(source));
  await copyFile(source, path.join(destination, relativePath));
  if (asset.extension === "gltf") {
    try {
      const gltf = JSON.parse(await readFile(source, "utf8")) as {
        buffers?: Array<{ uri?: string }>;
        images?: Array<{ uri?: string }>;
      };
      const uris = [
        ...(gltf.buffers ?? []).map((item) => item.uri),
        ...(gltf.images ?? []).map((item) => item.uri),
      ].filter(
        (uri): uri is string =>
          typeof uri === "string" &&
          !uri.startsWith("data:") &&
          !path.isAbsolute(uri),
      );
      for (const uri of uris) {
        const dependency = path.resolve(path.dirname(source), uri);
        const sourceRoot = path.resolve(path.dirname(source));
        if (
          dependency !== sourceRoot &&
          !dependency.startsWith(`${sourceRoot}${path.sep}`)
        ) {
          continue;
        }
        const target = path.resolve(assetDirectory, uri);
        if (
          target !== assetDirectory &&
          !target.startsWith(`${assetDirectory}${path.sep}`)
        ) {
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(dependency, target);
      }
    } catch {
      // The main file remains collectible even when optional dependencies fail.
    }
  }
  return { id: assetId, source: asset.path, relativePath };
}

function configureGlobalShortcuts(enabled: boolean): boolean {
  globalShortcut.unregisterAll();
  database.setSetting("globalShortcuts", enabled);
  if (!enabled) {
    return !transparentOverlay || registerOverlayEmergencyShortcut();
  }
  const captureClipboard = globalShortcut.register(
    "CommandOrControl+Shift+C",
    () => {
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        void saveCapture(image.toPNG()).then((filename) =>
          library.importPaths([filename]),
        );
      }
    },
  );
  const focusApp = globalShortcut.register(
    "CommandOrControl+Shift+R",
    () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send("system:request-region-capture");
    },
  );
  if (!captureClipboard || !focusApp) {
    globalShortcut.unregisterAll();
    database.setSetting("globalShortcuts", false);
    if (transparentOverlay && !registerOverlayEmergencyShortcut()) return false;
    return false;
  }
  if (transparentOverlay && !registerOverlayEmergencyShortcut()) return false;
  return true;
}

function restoreSafeWindowMode(): void {
  if (!mainWindow) return;
  transparentOverlay = false;
  clickThrough = false;
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setFocusable(true);
  mainWindow.setOpacity(1);
  mainWindow.show();
  mainWindow.focus();
  globalShortcut.unregister(overlayExitAccelerator);
  mainWindow.webContents.send("system:window-mode-reset");
}

function registerOverlayEmergencyShortcut(): boolean {
  if (globalShortcut.isRegistered(overlayExitAccelerator)) return true;
  return globalShortcut.register(
    overlayExitAccelerator,
    restoreSafeWindowMode,
  );
}

async function importCommandLineEntries(entries: string[]): Promise<boolean> {
  let importedProject = false;
  const assets: string[] = [];
  for (const entry of entries) {
    if (path.extname(entry).toLowerCase() !== ".refcanvas") {
      assets.push(entry);
      continue;
    }
    try {
      const document = boardDocumentSchema.parse(
        JSON.parse(await readFile(entry, "utf8")),
      ) as BoardDocument;
      const summary = database.createBoard(path.basename(entry, ".refcanvas"));
      database.saveBoard(summary.id, document);
      importedProject = true;
    } catch {
      if (mainWindow) {
        void dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "无法打开 RefCanvas 项目",
          message: `${path.basename(entry)} 不是有效的 RefCanvas 项目文件。`,
        });
      }
    }
  }
  if (assets.length) await library.importPaths(assets);
  return importedProject;
}

function validateSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  if (mainWindow && frame.top === mainWindow.webContents.mainFrame) return true;
  for (const window of boardWindows.values()) {
    if (frame.top === window.webContents.mainFrame) return true;
  }
  return false;
}

/** IPC 对话框/窗口操作的目标窗口：优先 sender 所在窗口，回退主窗口。 */
function windowForSender(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow!;
}

/** 向主窗口与全部白板窗口广播进度事件。 */
function broadcastAll(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
  for (const window of boardWindows.values()) {
    window.webContents.send(channel, ...args);
  }
}

/** 后台驻留：关闭窗口后保留主进程、目录监控与托盘（可选设置，默认关闭）。 */
function backgroundResidencyEnabled(): boolean {
  if (quitting) return false;
  return database.getSetting("backgroundResidency", false);
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 RefCanvas",
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
          void library?.resumeWatching();
          trayPaused = false;
          rebuildTrayMenu();
        },
      },
      {
        label: trayPaused ? "恢复目录监控" : "暂停目录监控",
        click: () => {
          trayPaused = !trayPaused;
          if (trayPaused) void library?.pauseWatching();
          else void library?.resumeWatching();
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "完全退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.setToolTip(trayPaused ? "RefCanvas（监控已暂停）" : "RefCanvas");
}

function createTray(): void {
  if (tray || process.platform === "darwin") return;
  let icon: Electron.NativeImage | null = null;
  const candidates = trayIconPaths(app.getAppPath());
  for (const candidate of candidates) {
    icon = nativeImage.createFromPath(candidate);
    if (!icon.isEmpty()) break;
    icon = null;
  }
  if (!icon) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
  rebuildTrayMenu();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * Tears down the currently open library connections and reopens them bound to
 * the given library entry. Used at startup and when switching libraries.
 */
async function reopenLibrary(entry: LibraryEntry): Promise<void> {
  cancelBackgroundServicesStart();
  actions?.close();
  directoryBatches?.close();
  directoryService?.close();
  await library?.close();
  backups?.close();
  database?.close();
  databaseFilename = databasePathFor(entry);
  database = new RefCanvasDatabase(databaseFilename, {
    migrationBackupDirectory: backupDirectoryFor(entry),
  });
  library = new LibraryService(database, trashPathFor(entry), {
    libraryRoot: entry.root,
    importEnumerator: new ImportEnumeratorClient(
      path.join(__dirname, "import-enumerator.js"),
    ),
  });
  backups = new BackupService(database, backupDirectoryFor(entry));
  actions = new ActionService(
    database,
    path.join(app.getPath("pictures"), "RefCanvas Actions"),
  );
  directoryService = new FilesystemService(database, {
    fallbackTrashRoot: path.join(entry.root, "trash", "files"),
    indexClient: new DirectoryIndexClient(
      path.join(__dirname, "directory-index-worker.js"),
      path.join(app.getPath("userData"), "cache", "directory-index.sqlite"),
    ),
  });
  directoryService.onSearchProgress((snapshot) => {
    broadcastAll("filesystem:search-progress", snapshot);
  });
  directoryService.onDirectoryProgress((snapshot) => {
    broadcastAll("filesystem:directory-progress", snapshot);
  });
  directoryBatches = new DirectoryBatchService({
    resolveSelection: (selection, offset) =>
      selection.mode === "all"
        ? directoryService.resolveSelection(
            selection.directoryPath,
            selection.revision,
            selection.excludedPaths,
            offset,
          )
        : directoryService.resolveSearchSelection(
            selection.searchId,
            selection.revision,
            selection.excludedPaths,
            offset,
          ),
    process: async (filename, action) => {
      if (action.type === "exportPaths") {
        await appendFile(action.destination, `${filename}\r\n`, "utf8");
      } else if (action.type === "trash") {
        await trashDirectoryPath(filename);
      } else if (action.type === "addCollection") {
        const result = await library.materializePath(filename);
        database.addAssetToCollection(result.asset.id, action.collectionId);
      } else if (action.type === "tag") {
        const result = await library.materializePath(filename);
        database.setAssetTags(result.asset.id, action.tags);
      } else {
        await library.materializePath(filename);
      }
    },
  });
  directoryBatches.onProgress((snapshot) => {
    broadcastAll("filesystem:batch-progress", snapshot);
  });
  fileOperations = new FileOperationsService({
    allowedRoots: () => [entry.root],
    trash: (filename) => trashDirectoryPath(filename),
    validateRevision: (directoryPath, revision) =>
      directoryService.validateRevision(directoryPath, revision),
  });
  mountService = new MountService(database);
  // mount 恢复（online）：增量 reconcile 修正该挂载根的链接状态。
  mountService.onMountStateChanged(({ mountId, state }) => {
    if (state !== "online") return;
    const root = database.listWatchRoots().find((item) => item.id === mountId);
    if (root) void library.reconcileRoots(root.id);
  });
  await library.recoverPendingOperations();
  library.resumePendingMetadata();
  library.onImportProgress((snapshot) => {
    broadcastAll("library:import-progress", snapshot);
  });
  library.onLibraryChanged((event) => {
    broadcastAll("library:changed", event);
  });
  library.onSimilarityProgress((snapshot) => {
    broadcastAll("library:similarity-progress", snapshot);
  });
  library.onMediaMetadataProgress((snapshot) => {
    broadcastAll("library:media-metadata-progress", snapshot);
  });
  actions.onProgress((snapshot) => {
    broadcastAll("actions:progress", snapshot);
  });
  if (rendererInteractive) scheduleBackgroundServices();
}

function scheduleBackgroundServices(): void {
  cancelBackgroundServicesStart();
  const scheduledLibrary = library;
  backgroundStartTimer = setTimeout(() => {
    backgroundStartTimer = null;
    if (library !== scheduledLibrary) return;
    void scheduledLibrary.startWatching();
  }, 1_200);
}

function cancelBackgroundServicesStart(): void {
  if (!backgroundStartTimer) return;
  clearTimeout(backgroundStartTimer);
  backgroundStartTimer = null;
}

function registerIpc(): void {
  const ipc = new SecureIpcRegistrar(validateSender);

  registerLibraryIpc(ipc, {
    copyProjectAsset,
    getDatabase: () => database,
    getLibrary: () => library,
    safeFilename,
    windowForSender,
  });
  registerLibraryManagementIpc(ipc, {
    getLibrary: () => library,
  });
  registerFilesystemIpc(ipc, {
    getDirectoryBatches: () => directoryBatches,
    getDirectoryService: () => directoryService,
    getFileOperations: () => fileOperations,
    getLibrary: () => library,
    previewTokens,
    trashDirectoryPath,
    windowForSender,
  });
  registerBackupIpc(ipc, {
    getBackups: () => backups,
    getDatabase: () => database,
    getDatabaseFilename: () => databaseFilename,
    getLibrary: () => library,
  });
  registerBoardIpc(ipc, {
    copyProjectAsset,
    getDatabase: () => database,
    getMainWindow: () => mainWindow,
    openBoardWindow,
    pngDataUrlToBuffer,
    relinkBoardAsset: (assetId, filename) =>
      library.relinkAsset(assetId, filename),
    windowForSender,
  });

  registerResourcesIpc(ipc, {
    getDatabase: () => database,
    getLibrary: () => library,
    getMountService: () => mountService,
    getProviderRegistry: () => providerRegistry!,
    getThumbnailWorker: () => thumbnailWorker,
    getThumbnailCacheDirectory: () => thumbnailCacheDirectory,
    previewTokens,
  });

  registerActionIpc(ipc, () => actions);
  registerMediaNotesIpc(ipc, () => database);
  registerSystemIpc(ipc, {
    configureGlobalShortcuts,
    getDatabase: () => database,
    getDatabaseFilename: () => databaseFilename,
    getLibrary: () => library,
    getLibraryManager: () => libraryManager,
    getMainWindow: () => mainWindow,
    overlayExitAccelerator,
    pngDataUrlToBuffer,
    registerOverlayEmergencyShortcut,
    restoreCaptureWindow,
    saveCapture,
    scheduleBackgroundServices,
    state: {
      get alwaysOnBottom() {
        return alwaysOnBottom;
      },
      set alwaysOnBottom(value) {
        alwaysOnBottom = value;
      },
      get captureWasFullScreen() {
        return captureWasFullScreen;
      },
      set captureWasFullScreen(value) {
        captureWasFullScreen = value;
      },
      get clickThrough() {
        return clickThrough;
      },
      set clickThrough(value) {
        clickThrough = value;
      },
      get previewCacheIndex() {
        return previewCacheIndex;
      },
      set previewCacheIndex(value) {
        previewCacheIndex = value;
      },
      get rendererInteractive() {
        return rendererInteractive;
      },
      set rendererInteractive(value) {
        rendererInteractive = value;
      },
      get thumbnailCacheDirectory() {
        return thumbnailCacheDirectory;
      },
      set thumbnailCacheDirectory(value) {
        thumbnailCacheDirectory = value;
      },
      get thumbnailWorker() {
        return thumbnailWorker;
      },
      set thumbnailWorker(value) {
        thumbnailWorker = value;
      },
      get transparentOverlay() {
        return transparentOverlay;
      },
      set transparentOverlay(value) {
        transparentOverlay = value;
      },
    },
    thumbnailQueue,
    windowForSender,
  });
}

function createWindow(): void {
  const savedBounds = database.getSetting<{
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    maximized?: boolean;
  }>("windowBounds", {});
  const visible = screen.getAllDisplays().some((display) => {
    if (savedBounds.x === undefined || savedBounds.y === undefined) return false;
    const right = savedBounds.x + (savedBounds.width ?? 1600);
    const bottom = savedBounds.y + (savedBounds.height ?? 960);
    const area = display.workArea;
    return (
      right > area.x &&
      savedBounds.x < area.x + area.width &&
      bottom > area.y &&
      savedBounds.y < area.y + area.height
    );
  });
  mainWindow = new BrowserWindow({
    width: visible ? savedBounds.width ?? 1600 : 1600,
    height: visible ? savedBounds.height ?? 960 : 960,
    ...(visible ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#171a1c",
    show: false,
    title: "RefCanvas",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#171a1c",
      symbolColor: "#aeb5b2",
      height: 40,
    },
    webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
  });

  hardenWindowNavigation(mainWindow.webContents);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("system:presentation-mode-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("system:presentation-mode-changed", false);
  });
  mainWindow.on("close", (event) => {
    if (!mainWindow) return;
    if (!quitting) saveMainWindowBounds();
    // 后台驻留开启：关窗不退出，销毁 renderer，保留主进程、目录监控与托盘。
    if (!quitting && backgroundResidencyEnabled()) {
      event.preventDefault();
      const window = mainWindow;
      mainWindow = null;
      window.destroy();
      createTray();
      // 驻留模式：白板窗口随主窗口一并关闭，避免失去托管的编辑入口。
      closeAllBoardWindows();
      return;
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    // 窗口关闭即会话结束：清空 refbrowse 预览 token，防止复用。
    previewTokens.clear();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(
      fpsCheckMode
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?fps=1`
        : MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: fpsCheckMode ? { fps: "1" } : undefined },
    );
  }
  if (savedBounds.maximized) mainWindow.maximize();
}

function saveMainWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  database.setSetting("windowBounds", {
    ...mainWindow.getNormalBounds(),
    maximized: mainWindow.isMaximized(),
  });
}

/** 创建独立白板窗口（同一白板只允许一个窗口，重复打开聚焦已有窗口）。 */
function openBoardWindow(boardId: string): void {
  const existing = boardWindows.get(boardId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#171a1c",
    show: false,
    title: "RefCanvas · 白板窗口",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#171a1c",
      symbolColor: "#aeb5b2",
      height: 40,
    },
    webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
  });
  hardenWindowNavigation(window.webContents);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (boardWindows.get(boardId) === window) boardWindows.delete(boardId);
  });
  boardWindows.set(boardId, window);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?board=${encodeURIComponent(boardId)}&mode=window`,
    );
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { board: boardId, mode: "window" } },
    );
  }
}

/** 关闭全部白板窗口（主窗口驻留关闭或应用退出时调用）。 */
function closeAllBoardWindows(): void {
  for (const window of boardWindows.values()) {
    if (!window.isDestroyed()) window.close();
  }
  boardWindows.clear();
}

void app.whenReady().then(async () => {
  if (squirrelEvent) {
    if (squirrelEvent === "--squirrel-uninstall") {
      await updateSquirrelShortcut("--removeShortcut").catch(() => undefined);
      await removeWindowsIntegration();
    } else if (
      squirrelEvent === "--squirrel-install" ||
      squirrelEvent === "--squirrel-updated"
    ) {
      await Promise.all([
        updateSquirrelShortcut("--createShortcut"),
        registerWindowsSendTo(),
        registerWindowsProjectFormat(),
      ]);
    }
    app.quit();
    return;
  }
  const userData = app.getPath("userData");
  libraryManager = new LibraryManager(userData);
  const initialEntry = await libraryManager.bootstrapLegacy();
  await reopenLibrary(initialEntry);
  thumbnailCacheDirectory = path.join(userData, "cache", "thumbnails");
  previewCacheIndex = new PreviewCacheIndex(
    path.join(userData, "cache", "preview-index.sqlite"),
  );
  thumbnailWorker = new ThumbnailWorkerClient(
    path.join(__dirname, "thumbnail-worker.js"),
    thumbnailCacheDirectory,
  );
  providerRegistry = new ProviderRegistry();
  const genericProvider = new GenericProvider();
  providerRegistry.register({
    provider: genericProvider,
    dispose: () => genericProvider.dispose(),
  });
  const hdrProvider = new HdrProvider();
  providerRegistry.register({
    provider: hdrProvider,
    dispose: () => hdrProvider.dispose(),
  });
  const geometryProvider = new GeometryProvider();
  providerRegistry.register({
    provider: geometryProvider,
    dispose: () => geometryProvider.dispose(),
  });
  const videoProvider = new VideoProvider();
  providerRegistry.register({
    provider: videoProvider,
    dispose: () => videoProvider.dispose(),
  });
  const imageProvider = new ImageProvider();
  providerRegistry.register({
    provider: imageProvider,
    dispose: () => imageProvider.dispose(),
  });
  const audioProvider = new AudioProvider();
  providerRegistry.register({
    provider: audioProvider,
    dispose: () => audioProvider.dispose(),
  });
  const fontProvider = new FontProvider();
  providerRegistry.register({
    provider: fontProvider,
    dispose: () => fontProvider.dispose(),
  });
  const documentProvider = new DocumentProvider();
  providerRegistry.register({
    provider: documentProvider,
    dispose: () => documentProvider.dispose(),
  });
  const dccProvider = new DccProvider();
  providerRegistry.register({
    provider: dccProvider,
    dispose: () => dccProvider.dispose(),
  });
  for (const cachedFile of previewCacheIndex.prune()) {
    void rm(cachedFile, { force: true });
  }
  await mkdir(backupDirectoryFor(initialEntry), { recursive: true });
  registerProtocols({
    getDatabase: () => database,
    getPreviewCacheIndex: () => previewCacheIndex,
    getThumbnailCacheDirectory: () => thumbnailCacheDirectory,
    getThumbnailWorker: () => thumbnailWorker,
    getProviderRegistry: () => providerRegistry!,
    previewTokens,
    thumbnailQueue,
  });
  registerIpc();
  if (database.getSetting("globalShortcuts", false)) {
    configureGlobalShortcuts(true);
  }
  // 启动时修复存量 watch root 与 mount root 的 1:1 关联，再刷新挂载状态。
  repairMountRoots();
  const refreshMounts = () => {
    void mountService.refreshAll().then((changes) => {
      for (const change of changes) {
        if (change.state === "online") {
          const root = database
            .listWatchRoots()
            .find((item) => item.id === change.mountId);
          if (root) void library.reconcileRoots(root.id);
        }
      }
    });
  };
  refreshMounts();
  // 运行期间受控轮询挂载状态，检测断连/重连（计划 §7.5 外部增删改语义）。
  const mountPollTimer = setInterval(refreshMounts, 15_000);
  mountPollTimer.unref();

  const commandLineFiles = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((value) => !value.startsWith("-"));
  if (commandLineFiles.length) {
    await importCommandLineEntries(commandLineFiles);
  }
  createWindow();
  void Promise.all([
    registerWindowsSendTo(),
    registerWindowsProjectFormat(),
  ]).catch(() => undefined);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void library?.resumeWatching();
    }
  });
});

app.on("second-instance", (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
    void library?.resumeWatching();
  }
  const files = argv.slice(1).filter((value) => !value.startsWith("-"));
  if (files.length && library) {
    void importCommandLineEntries(files).then((importedProject) => {
      if (importedProject) mainWindow?.reload();
    });
  }
});

app.on("window-all-closed", () => {
  // 后台驻留开启时保留主进程与托盘，由托盘控制完全退出。
  if (!quitting && backgroundResidencyEnabled()) {
    if (!tray) createTray();
    return;
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
});

async function shutdownServices(): Promise<void> {
  saveMainWindowBounds();
  for (const window of boardWindows.values()) window.destroy();
  boardWindows.clear();
  mainWindow?.destroy();
  cancelBackgroundServicesStart();
  globalShortcut.unregisterAll();
  destroyTray();
  thumbnailQueue.clear("APP_QUITTING");
  thumbnailWorker?.close();
  previewCacheIndex?.close();
  await providerRegistry?.dispose();
  directoryBatches?.close();
  directoryService?.close();
  await library?.close();
  backups?.close();
  database?.close();
}

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownPromise) return;
  shutdownPromise = shutdownServices()
    .catch((error) => console.error("APP_SHUTDOWN_FAILED", error))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});
