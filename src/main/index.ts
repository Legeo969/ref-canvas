import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
} from "electron";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import Database from "better-sqlite3";
import { copyFileDurable } from "./platform/fsync";
import { moveToRecycleBin } from "./platform/recycle-bin";
import { BackupService } from "./services/backup-service";
import { ActionService } from "./services/action-service";
import { RefCanvasDatabase, APP_MAX_SCHEMA_VERSION } from "./persistence/database";
import type { MigrationRecoveryInfo } from "./ipc/system-ipc";
import {
  rewriteBoardAssetId,
  toBoardV2,
} from "./persistence/repositories/boards-repository";
import {
  LibraryManager,
  backupDirectoryFor,
  browserCapturesPath,
  databasePathFor,
  trashPathFor,
  type LibraryEntry,
} from "./services/library-manager";
import { LibraryService } from "./services/library-service";
import { FilesystemService } from "./services/filesystem-service";
import { FileOperationsService } from "./services/file-operations-service";
import { MountService } from "./services/mount-service";
import { ScriptsService } from "./services/scripts-service";
import { BoardReferenceService } from "./services/board-reference-service";
import { DirectoryIndexClient } from "./platform/directory-index-client";
import { ImportEnumeratorClient } from "./platform/import-enumerator-client";
import { DirectoryBatchService } from "./services/directory-batch-service";
import { PreviewTokenRegistry } from "./platform/refbrowse";
import { PreviewQueue } from "./platform/preview-queue";
import { PreviewCacheIndex } from "./platform/preview-cache-index";
import { reconcileCacheDatabase } from "./platform/cache-db-guard";
import {
  inspectPrimaryDatabase,
  backupCorruptPrimary,
} from "./platform/database-health";
import { ThumbnailWorkerClient } from "./platform/thumbnail-worker-client";
import { VisualSignatureWorkerClient } from "./platform/visual-signature-worker-client";
import { cleanupOrphanThumbnails } from "./platform/thumbnail-cache";
import { ProviderRegistry } from "./platform/provider-registry";
import { WorkerSupervisor } from "./platform/worker-supervisor";
import { WorkerBackedProvider } from "./platform/provider-worker-client";
import { GenericProvider } from "./providers/generic-provider";
import { HDR_PROVIDER_MANIFEST } from "./providers/hdr-provider";
import { GEOMETRY_PROVIDER_MANIFEST } from "./providers/geometry-provider";
import { VIDEO_PROVIDER_MANIFEST } from "./providers/video-provider";
import { IMAGE_PROVIDER_MANIFEST } from "./providers/image-provider";
import { AudioProvider } from "./providers/audio-provider";
import { FontProvider } from "./providers/font-provider";
import { DocumentProvider } from "./providers/document-provider";
import { DccProvider } from "./providers/dcc-provider";
import { registerProtocols } from "./platform/protocols";
import { createCaptureServer } from "./platform/browser-capture-server";
import {
  captureCacheDirectory,
  captureDisplay,
  discardCapture,
} from "./platform/screen-capture";
import { BrowserCapturePairingService } from "./services/browser-capture-pairing-service";
import { ActionPresetService } from "./services/action-preset-service";
import { pruneOrphanedCaptures } from "./services/browser-capture-maintenance";
import { CaptureDeliveryService, type CaptureDeliveryTarget } from "./services/capture-delivery";
import { createCaptureSession } from "./services/capture-session";
import { registerSecureListener } from "./platform/secure-ipc";
import {
  registerWindowsProjectFormat,
  registerWindowsSendTo,
  removeWindowsIntegration,
  updateSquirrelShortcut,
} from "./platform/windows-integration";
import {
  getSquirrelLifecycleEvent,
  isSquirrelFirstRun,
} from "./platform/windows-installer";
import { SecureIpcRegistrar } from "./platform/secure-ipc";
import { registerActionIpc } from "./ipc/action-ipc";
import { registerBackupIpc } from "./ipc/backup-ipc";
import { registerBoardIpc } from "./ipc/board-ipc";
import { boardDocumentSchema } from "./ipc/board-schema";
import { registerFilesystemIpc } from "./ipc/filesystem-ipc";
import { registerLibraryIpc } from "./ipc/library-ipc";
import { registerCollectionsIpc } from "./ipc/collections-ipc";
import { registerLibraryManagementIpc } from "./ipc/library-management-ipc";
import { registerMediaNotesIpc } from "./ipc/media-notes-ipc";
import { registerResourcesIpc } from "./ipc/resources-ipc";
import { registerSystemIpc } from "./ipc/system-ipc";
import { registerTaskCenterIpc } from "./ipc/task-center-ipc";
import { registerBrowserCaptureIpc } from "./ipc/browser-capture-ipc";
import type { BoardDocument } from "../shared/contracts";
import type { CaptureSource } from "../shared/contracts";
import { readPreviewSettings } from "./ipc/preview-settings";
import { TaskCenterService } from "./services/task-center-service";
import { MediaJobRegistry } from "./services/media-job-registry";
import { ZipArchiveService } from "./services/zip-archive-service";
import { trayIconPaths } from "./platform/tray-icon";
import {
  hardenWindowNavigation,
  secureWebPreferences,
} from "./platform/window-security";
import { TrustedWindowRegistry } from "./platform/trusted-window-registry";
import { WriteAccessController } from "./platform/write-access-controller";

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
const boardFlushResolvers = new Map<number, (saved: boolean) => void>();
const boardWindowsClosingAfterFlush = new Set<number>();
const mainWindowsClosingAfterFlush = new Set<number>();
const trustedWindows = new TrustedWindowRegistry();
const writeAccess = new WriteAccessController(() => {
  const roots = [
    app.getPath("userData"),
    path.join(app.getPath("pictures"), "RefCanvas Actions"),
    path.join(app.getPath("pictures"), "RefCanvas Captures"),
  ];
  try {
    roots.push(...database.listMountRoots().map((mount) => mount.path));
  } catch {
    // Startup recovery registers IPC before the database is available.
  }
  return roots;
});
const browserCapturePairings = new BrowserCapturePairingService(() => database);
const actionPresets = new ActionPresetService(() => database);
let database: RefCanvasDatabase;
let library: LibraryService;
let backups: BackupService;
let actions: ActionService;
let libraryManager: LibraryManager;
let directoryService: FilesystemService;
let directoryBatches: DirectoryBatchService;
let fileOperations: FileOperationsService;
let mountService: MountService;
let scriptsService: ScriptsService;
let boardReferences: BoardReferenceService;
let taskCenter: TaskCenterService;
let mediaJobRegistry: MediaJobRegistry;
let zipArchiveService: ZipArchiveService;
/**
 * 当前截图会话各屏的临时底图（displayId → 文件与物理尺寸）。
 * 空 Map = 无会话；save/cancel 后清空并删文件。
 */
const pendingCaptures = new Map<
  number,
  { filePath: string; width: number; height: number }
>();
/** 会话中持有键盘焦点的覆盖窗所在屏（= 按下时光标所在屏）。 */
let captureFocusDisplayId: number | null = null;
/** 常驻复用的覆盖窗所在屏（主窗口所在屏，随会话更新）；其余屏用完即销毁。 */
let residentCaptureDisplayId: number | null = null;
/** displayId → 覆盖窗口。多屏截图 = 每屏一个覆盖窗。 */
const captureWindows = new Map<number, Electron.BrowserWindow>();
/**
 * 当前会话各屏已推送的底图。did-finish-load 的推送与渲染端 React 挂载
 * 存在竞态（事件在 onCaptureSource 订阅前发出即丢失，覆盖窗黑屏），
 * 渲染端就绪后会用 capture:renderer-ready 来拉一次，这里按屏重推。
 */
const captureSourcesByDisplay = new Map<number, CaptureSource>();
let thumbnailCacheDirectory = "";
let databaseFilename = "";
let alwaysOnBottom = false;
let clickThrough = false;
let transparentOverlay = false;
let rendererInteractive = false;
let backgroundStartTimer: NodeJS.Timeout | null = null;
let tray: Electron.Tray | null = null;
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
let providerSupervisor: WorkerSupervisor | null = null;
const overlayExitAccelerator = "CommandOrControl+Alt+Shift+R";
const squirrelEvent = getSquirrelLifecycleEvent(process.argv);
const squirrelFirstRun = isSquirrelFirstRun(process.argv);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

async function trashDirectoryPath(filename: string): Promise<void> {
  await moveToRecycleBin(filename, (target) => shell.trashItem(target));
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

async function saveCapture(
  buffer: Buffer,
  directory = path.join(app.getPath("pictures"), "RefCanvas Captures"),
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const filename = path.join(directory, `RefCanvas-${stamp}.png`);
  await writeFile(filename, buffer);
  return filename;
}

/**
 * 截图覆盖窗口（每显示器一个：常驻屏复用，其余屏会话内按需创建）。
 *
 * 旧实现每次截图都新建 BrowserWindow 并加载整个渲染包（1.9MB JS + 247KB
 * CSS，含 three/fabric），冷启动本身就是几百毫秒。这里改为常驻屏建一次、
 * 之后只 show/hide 并空闲预热；多屏会话时其余屏现建现销毁——建窗加载期
 * 宿主已被会话锁定，不存在裸奔窗口，加载完再 show 也无白闪。
 *
 * 代价是常驻隐藏窗口会让 window-all-closed 不再触发：退出路径必须显式
 * destroyCaptureWindows，否则进程退不掉。
 */
function ensureCaptureWindowFor(display: Electron.Display): Electron.BrowserWindow {
  const existing = captureWindows.get(display.id);
  if (existing && !existing.isDestroyed()) return existing;
  const window = new BrowserWindow({
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#050606",
    show: false,
    webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
  });
  captureWindows.set(display.id, window);
  trustedWindows.register(window);
  hardenWindowNavigation(window.webContents);
  // 隐藏期间 Chromium 会把 IPC 与 rAF 节流到 0：覆盖窗口必须在隐藏时也能
  // 收到底图并完成首帧绘制，否则显示瞬间仍是空白。走 webContents 而不是
  // webPreferences 覆盖项，保持"每个窗口都用统一安全策略"的架构约束。
  window.webContents.setBackgroundThrottling(false);
  window.on("closed", () => {
    captureWindows.delete(display.id);
    // 覆盖窗被外部强关（任务管理器等）：宿主不能就此锁死，强制收会话。
    // 正常收会话先摘 isActive 再销毁窗口，不会在这里递归。
    if (captureSession.isActive()) endCaptureSession("forced");
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?capture=1`);
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { capture: "1" } },
    );
  }
  return window;
}

/**
 * 截图会话：会话期间锁定宿主全部窗口（主窗口 + 白板窗口）——不可激活、
 * 不可拖——并把任何落在宿主上的键盘焦点钳回覆盖窗。这是"截图时宿主还能
 * 被任务栏/Alt+Tab/Win+方向键拖走"的根治：此前只靠覆盖窗盖住，宿主置顶
 * 时 z 序随时可能反超。
 */
const captureSession = createCaptureSession(
  {
    getHostWindows: () =>
      [mainWindow, ...boardWindows.values()].filter(
        (window): window is Electron.BrowserWindow => !!window,
      ),
    getFocusOverlay: () => {
      const preferred =
        captureFocusDisplayId != null
          ? captureWindows.get(captureFocusDisplayId)
          : undefined;
      if (preferred && !preferred.isDestroyed()) return preferred;
      for (const window of captureWindows.values()) {
        if (!window.isDestroyed()) return window;
      }
      return null;
    },
  },
  {
    onWindowFocus: (listen) => {
      const handler = (_event: Electron.Event, window: Electron.BrowserWindow) =>
        listen(window);
      app.on("browser-window-focus", handler);
      return () => {
        app.off("browser-window-focus", handler);
      };
    },
  },
);

async function discardPendingCaptures(): Promise<void> {
  const files = [...pendingCaptures.values()].map((entry) => entry.filePath);
  pendingCaptures.clear();
  await Promise.all(files.map((file) => discardCapture(file)));
}

function captureScreen(display: Electron.Display) {
  return captureDisplay(captureCacheDirectory(app.getPath("userData")), display);
}

/** 把底图推给某屏的覆盖窗口。窗口跨次复用，所以是 push 而不是一次性索取。 */
function showCaptureWindow(
  display: Electron.Display,
  source: CaptureSource,
  options: { focus: boolean },
): void {
  const window = ensureCaptureWindowFor(display);
  // 缓存底图：渲染端就绪信号（capture:renderer-ready）到达时按屏重推，
  // 消灭 did-finish-load 与 React 挂载之间的竞态（事件早于订阅即丢失，
  // 覆盖窗黑屏、要点两次截图才能成功）。
  captureSourcesByDisplay.set(display.id, source);
  window.setBounds(display.bounds);
  // screen-saver 是 Electron 置顶序列的最高级：宿主即使用户手动置顶
  // （floating 级）也压不过它，任务栏点击/Alt+Tab 都抬不上来。
  window.setAlwaysOnTop(true, "screen-saver");
  window.showInactive();
  if (options.focus) window.focus();
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", () => {
      window.webContents.send("capture:source", source);
    });
  } else {
    window.webContents.send("capture:source", source);
  }
}

function focusActiveCaptureWindow(): void {
  const window =
    captureFocusDisplayId != null
      ? captureWindows.get(captureFocusDisplayId)
      : null;
  if (window && !window.isDestroyed()) window.focus();
}

/**
 * 结束截图会话的统一出口：恢复宿主锁定、收起/销毁覆盖窗、按需回焦。
 * 幂等；所有退出路径（保存、取消、失败、覆盖窗被强关、quit）都必须到达。
 * 宿主全程原样（QQ 式所见即所得，不隐藏不弹出），这里只处理焦点与反馈。
 */
function endCaptureSession(
  reason: "saved" | "cancelled" | "error" | "forced",
): void {
  const host = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  captureSession.end();
  captureSourcesByDisplay.clear();
  for (const [displayId, window] of captureWindows) {
    if (window.isDestroyed()) {
      captureWindows.delete(displayId);
      continue;
    }
    // 常驻屏只 hide 供下次复用；其余屏销毁，不为偶发的多屏截图常驻
    // 渲染进程内存。
    if (displayId === residentCaptureDisplayId) {
      window.hide();
    } else {
      captureWindows.delete(displayId);
      window.destroy();
    }
  }
  if (!host) return;
  const hostVisible = host.isVisible() && !host.isMinimized();
  if (reason === "saved") {
    if (hostVisible) {
      // 用户本来就在看着应用：回焦展示"已入库并复制"的 toast。
      host.focus();
    } else {
      // 最小化/藏托盘发起的截图：托盘气泡告知结果，绝不为反馈弹窗。
      showTrayNotification("RefCanvas", "截图已保存并复制到剪贴板。");
    }
  } else if (hostVisible) {
    host.focus();
  }
}

/** 退出路径必须真正销毁，否则隐藏窗口拖住 window-all-closed。 */
function destroyCaptureWindows(): void {
  for (const [displayId, window] of captureWindows) {
    captureWindows.delete(displayId);
    if (!window.isDestroyed()) window.destroy();
  }
}

/**
 * 区域截图会话入口：主进程直连（全局快捷键）与渲染端（标题栏按钮）共用。
 * 冻结全部显示器 → 锁定宿主 → 每屏覆盖窗接管框选；键盘焦点落在光标屏。
 *
 * QQ 式所见即所得：直接抓「用户此刻看到的画面」——宿主可见就在画面里
 * （不隐藏、不闪烁，用户偶尔要截画板上的内容也成立）；宿主最小化/藏托盘
 * 时它本就不在屏幕上，画面里自然没有它，也绝不为截图把它弹出。宿主的
 * "不可拖动"由会话锁定保证，与画面呈现无关。
 */
async function runRegionCapture(): Promise<void> {
  if (captureSession.isActive()) {
    focusActiveCaptureWindow();
    return;
  }
  const host = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  // 常驻覆盖窗跟随可见的主窗口所在屏；宿主隐藏（热键路径）时保持上次。
  if (host && host.isVisible() && !host.isMinimized()) {
    residentCaptureDisplayId = screen.getDisplayMatching(host.getBounds()).id;
  }
  captureSession.begin();
  const captures = new Map<
    number,
    { filePath: string; width: number; height: number }
  >();
  try {
    const displays = screen.getAllDisplays();
    captureFocusDisplayId = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).id;
    // 原生抓屏是同步 napi 调用（每屏 ~25ms），串行即可，避免 native 并发。
    // 单屏失败只放弃那一屏（那块屏不接管、不进会话），别让一块故障屏
    // 炸掉整个会话——整体失败走热键路径时会把宿主弹回前台，观感就是
    // "一按截图窗口又跳出来"。
    for (const display of displays) {
      try {
        const capture = await captureScreen(display);
        captures.set(display.id, {
          filePath: capture.filePath,
          width: capture.width,
          height: capture.height,
        });
      } catch (error) {
        console.warn(
          `[capture] display ${display.id} capture failed, skipping:`,
          error,
        );
      }
    }
    if (captures.size === 0) {
      throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
    }
    await discardPendingCaptures();
    for (const [displayId, capture] of captures) {
      pendingCaptures.set(displayId, capture);
    }
    // 光标屏抓取失败时，键盘焦点退给第一块成功冻结的屏。
    captureFocusDisplayId = captures.has(captureFocusDisplayId)
      ? captureFocusDisplayId
      : (captures.keys().next().value ?? null);
    for (const display of displays) {
      const capture = captures.get(display.id);
      if (!capture) continue;
      showCaptureWindow(
        display,
        {
          imageUrl: `refbrowse://preview/${previewTokens.tokenFor(capture.filePath)}`,
          width: capture.width,
          height: capture.height,
          displayId: display.id,
        },
        { focus: display.id === captureFocusDisplayId },
      );
    }
  } catch (error) {
    endCaptureSession("error");
    // 会话中途失败：已落盘的屏底图立即回收，不留孤儿临时文件。
    await Promise.all(
      [...captures.values()].map((capture) => discardCapture(capture.filePath)),
    );
    throw error;
  }
}

/** 跨屏选区互斥：一块屏开始框选，其余屏转纯遮罩（active = 允许框选）。 */
function broadcastOverlayMode(
  senderId: number,
  mode: "active" | "passive",
): void {
  for (const window of captureWindows.values()) {
    if (window.isDestroyed() || window.webContents.id === senderId) continue;
    window.webContents.send("capture:overlay-mode", mode);
  }
}

/** 预热：主窗口就绪后空闲时静默建好常驻屏的覆盖窗口，首次点击不再冷启动。 */
function prewarmCaptureWindow(): void {
  const timer = setTimeout(() => {
    if (quitting) return;
    const host =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
        ? mainWindow
        : null;
    const display = host
      ? screen.getDisplayMatching(host.getBounds())
      : screen.getPrimaryDisplay();
    residentCaptureDisplayId = display.id;
    ensureCaptureWindowFor(display);
  }, 1500);
  timer.unref();
}

function safeFilename(value: string): string {
  // Control chars are stripped deliberately: they are illegal in filenames.
  // eslint-disable-next-line no-control-regex
  return value.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120);
}

/**
 * 把白板引用的一份源文件复制进打包目录。源文件已离线/被删时返回 null
 * 而不是抛错：一个缺失素材不该让整包导出失败（导出端会统计跳过数量
 * 并在 UI 上提示，白板文档里的引用保持原样，导入后仍可由断链定位修复）。
 */
async function copyProjectAsset(
  assetId: string,
  destination: string,
): Promise<{ id: string; source: string; relativePath: string } | null> {
  const asset = database.getAsset(assetId);
  const source = database.getAssetPath(assetId);
  if (!asset || !source) return null;
  const assetDirectory = path.join(destination, "assets", assetId);
  await mkdir(assetDirectory, { recursive: true });
  const relativePath = path.join("assets", assetId, path.basename(source));
  try {
    await copyFile(source, path.join(destination, relativePath));
  } catch {
    // 索引有记录但磁盘已不可读（移动/删除/离线挂载）：按缺失处理。
    return null;
  }
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
      if (!image.isEmpty() && mainWindow && !mainWindow.isDestroyed()) {
        const captureDirectory = path.join(app.getPath("pictures"), "RefCanvas Captures");
        void writeAccess.authorize(mainWindow, "export", [
          { path: captureDirectory, mode: "destination" },
        ]).then(([canonicalDirectory]) => saveCapture(image.toPNG(), canonicalDirectory)).then((filename) =>
          library.importPaths([filename]),
        ).catch(() => undefined);
      }
    },
  );
  const focusApp = globalShortcut.register(
    "CommandOrControl+Shift+R",
    () => {
      // 会话中再按热键：只把键盘焦点还给覆盖窗。旧实现 show+focus 主窗口
      // 会主动打破模态，把宿主抬到覆盖层之上。
      if (captureSession.isActive()) {
        focusActiveCaptureWindow();
        return;
      }
      // 热键只冻结"用户此刻看到的画面"：绝不先弹宿主——宿主最小化/藏
      // 托盘时会被强行弹出并拍进底图，用户框选永远绕不开它。宿主在保存
      // 成功后才被带回前台。
      void runRegionCapture().catch(() => {
        // 失败必须显式提示（不能只闪一下屏），但绝不能把窗口强行弹到
        // 前台——那正是"一按截图窗口又跳出来"的观感。宿主可见（会话
        // 失败路径已把它恢复原状）时借主窗口的 notice 提示；不可见时用
        // 托盘气泡。
        const host =
          mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        if (host && host.isVisible() && !host.isMinimized()) {
          host.webContents.send("capture:failed");
          return;
        }
        showTrayNotification("RefCanvas", "无法捕获屏幕画面，请重试。");
      });
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

/** 路径是否为可访问目录（FND-002 第二实例目录标签）。 */
function isDirectoryPath(filename: string): boolean {
  try {
    return statSync(filename).isDirectory();
  } catch {
    return false;
  }
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
      const raw = JSON.parse(await readFile(entry, "utf8")) as unknown;
      const packageResult = z
        .object({
          format: z.literal("refcanvas-package"),
          version: z.literal(2),
          board: z.object({ title: z.string().trim().min(1).max(120) }),
          assets: z.array(
            z.object({
              id: z.string().min(1).max(128),
              relativePath: z.string().min(1).max(4_096),
            }),
          ),
          files: z.array(
            z.object({
              relativePath: z.string().min(1).max(4_096),
              dataBase64: z.string(),
            }),
          ),
          document: boardDocumentSchema,
        })
        .safeParse(raw);
      let title = path.basename(entry, ".refcanvas");
      let document: BoardDocument;
      if (packageResult.success) {
        const extractionRoot = path.join(
          path.dirname(entry),
          `${path.basename(entry, ".refcanvas")}.assets-${Date.now()}`,
        );
        await mkdir(extractionRoot, { recursive: true });
        for (const file of packageResult.data.files) {
          const target = path.resolve(extractionRoot, file.relativePath);
          const relative = path.relative(extractionRoot, target);
          if (
            relative.startsWith("..") ||
            path.isAbsolute(relative)
          ) {
            throw new Error("BOARD_PACKAGE_PATH_OUTSIDE_ROOT");
          }
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, Buffer.from(file.dataBase64, "base64"));
        }
        document = toBoardV2(packageResult.data.document as BoardDocument);
        for (const asset of packageResult.data.assets) {
          const filename = path.resolve(extractionRoot, asset.relativePath);
          const relative = path.relative(extractionRoot, filename);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("BOARD_PACKAGE_ASSET_OUTSIDE_ROOT");
          }
          const materialized = await library.materializePath(filename);
          rewriteBoardAssetId(document, asset.id, materialized.asset.id);
        }
        title = packageResult.data.board.title;
      } else {
        document = boardDocumentSchema.parse(raw) as BoardDocument;
      }
      const summary = database.createBoard(title);
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

const validateSender = trustedWindows.validateSender.bind(trustedWindows);

/** IPC 对话框/窗口操作只允许已登记且仍存活的发送窗口。 */
function windowForSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
): BrowserWindow {
  return trustedWindows.windowForSender(event);
}

/** 向主窗口与全部白板窗口广播进度事件。 */
function broadcastAll(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
  for (const window of boardWindows.values()) {
    window.webContents.send(channel, ...args);
  }
}

/** 后台驻留：关闭窗口后保留主进程与托盘（可选设置，默认关闭）。 */
function backgroundResidencyEnabled(): boolean {
  if (quitting) return false;
  // 阶段 5 §10.5：closeBehavior=tray 与 backgroundResidency 等效。
  return (
    database.getSetting("backgroundResidency", false) ||
    database.getSetting<"quit" | "tray">("closeBehavior", "quit") === "tray"
  );
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
          captureDelivery.flushQueue();
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
  tray.setToolTip("RefCanvas");
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
    // 驻留恢复不重载渲染端（无 did-finish-load），这里显式重投暂存捕获。
    captureDelivery.flushQueue();
  });
  rebuildTrayMenu();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * 托盘气泡通知（Windows）。用于主窗口看不见的失败/暂存事件：
 * 捕获端口被占、网页捕获入队暂存等。无托盘平台或创建失败时静默降级。
 */
function showTrayNotification(title: string, content: string): void {
  try {
    if (process.platform === "darwin") return;
    createTray();
    if (!tray) return;
    if (typeof tray.displayBalloon === "function") {
      tray.displayBalloon({ iconType: "info", title, content });
    } else {
      console.info(`[notify] ${title}: ${content}`);
    }
  } catch (error) {
    console.warn("[notify] tray balloon failed:", error);
  }
}

// 浏览器扩展捕获的确认制投递（详见 services/capture-delivery.ts）：
// 无存活窗口或渲染端超时未回执时入队暂存，托盘气泡提示，窗口就绪后重投。
const captureDelivery = new CaptureDeliveryService({
  // 只投主窗口：BoardWindow（白板子窗口）是精简渲染端，没有捕获导入
  // 管线，投给它只会白等超时。主窗口不在时入队暂存并托盘提示。
  getTargets: () => {
    const targets: CaptureDeliveryTarget[] = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      const window = mainWindow;
      targets.push({
        id: window.id,
        isDestroyed: () => window.isDestroyed(),
        isFocused: () => window.isFocused(),
        send: (channel, ...args) => window.webContents.send(channel, ...args),
      });
    }
    return targets;
  },
  notifyStored: (count) =>
    showTrayNotification(
      "RefCanvas",
      count === 1
        ? "网页捕获已暂存：打开 RefCanvas 后自动上板"
        : `${count} 个网页捕获已暂存：打开 RefCanvas 后自动上板`,
    ),
});
registerSecureListener(validateSender, "browser:capture-ack", (_event, captureId: unknown) => {
  if (typeof captureId === "string") captureDelivery.handleAck(captureId);
});

/** 启动期数据库迁移失败的恢复信息（FND-001：失败时不进入主工作区）。 */
let migrationRecovery: MigrationRecoveryInfo = {
  failed: false,
  databasePath: null,
  backupDirectory: null,
  entries: [],
};

/**
 * SPEC-1：主库损坏时进入只读降级模式。为 true 时 UI 顶部展示持久横幅
 * "数据库损坏，已进入只读模式"，且所有数据库写操作被 SQLite `query_only`
 * 拒绝。仅主库 quick_check 失败但仍可只读打开时为 true。
 */
let degradedMode = false;

/**
 * SPEC-1/SPEC-7：启动健康状态，供渲染端展示降级横幅或安全模式恢复入口。
 * `ok` / `degraded` 会进入主工作区（degraded 带只读横幅）；`safe` /
 * `too-new` 停留在恢复页。
 */
let startupHealth: {
  mode: "ok" | "degraded" | "safe" | "too-new";
  databasePath: string | null;
  reason: string | null;
  /** 上次是否异常退出（clean-shutdown 标记缺失）。 */
  previousCrash: boolean;
} = { mode: "ok", databasePath: null, reason: null, previousCrash: false };

/**
 * 读取迁移日志，生成恢复页所需信息。
 *
 * 迁移失败时 `RefCanvasDatabase` 构造函数抛错、实例不存在，但失败的日志行
 * 已由迁移 runner 在事务外写入 `migration_log` 表并提交，因此这里直接以只读
 * 方式打开数据库文件读取，不依赖已打开的实例。
 */
function computeMigrationRecovery(
  entry: LibraryEntry | null,
  openDatabase: RefCanvasDatabase | null,
): MigrationRecoveryInfo {
  const databasePath = entry ? databasePathFor(entry) : null;
  let failedEntries: MigrationRecoveryInfo["entries"] = [];
  if (openDatabase) {
    failedEntries = openDatabase
      .getMigrationLog()
      .filter((log) => log.result === "failed")
      .map((log) => ({
        stepId: log.stepId,
        fromVersion: log.fromVersion,
        toVersion: log.toVersion,
        error: log.error,
      }));
  } else if (databasePath) {
    try {
      const raw = new Database(databasePath, { readonly: true });
      try {
        failedEntries = raw
          .prepare(
            `SELECT step_id AS stepId, from_version AS fromVersion,
               to_version AS toVersion, error
             FROM migration_log WHERE result = 'failed' ORDER BY started_at`,
          )
          .all() as MigrationRecoveryInfo["entries"];
      } finally {
        raw.close();
      }
    } catch {
      failedEntries = [];
    }
  }
  return {
    failed: failedEntries.length > 0,
    databasePath,
    backupDirectory: entry ? backupDirectoryFor(entry) : null,
    entries: failedEntries,
  };
}

/** 备份文件名模式（与 BackupService 保持一致）。 */
const RECOVERY_BACKUP_PATTERN = /^refcanvas-(auto|manual)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.backup$/;

/**
 * SPEC-1 安全模式：列出备份目录中的最近备份。安全模式下服务未初始化，
 * 仅依赖备份目录路径，可独立运行。
 */
async function recoverListBackups(): Promise<
  Array<{ filename: string; path: string; createdAt: string }>
> {
  const entry = libraryManager?.currentEntry();
  const backupDirectory = entry ? backupDirectoryFor(entry) : null;
  if (!backupDirectory) return [];
  await mkdir(backupDirectory, { recursive: true });
  const records: Array<{ filename: string; path: string; createdAt: string }> = [];
  for (const filename of await readdir(backupDirectory)) {
    const match = RECOVERY_BACKUP_PATTERN.exec(filename);
    if (!match) continue;
    const fullPath = path.join(backupDirectory, filename);
    try {
      const fileStat = statSync(fullPath);
      records.push({
        filename,
        path: fullPath,
        createdAt: fileStat.birthtime.toISOString(),
      });
    } catch {
      // 忽略不可读备份。
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * SPEC-1 安全模式：从指定备份恢复主库并重启。备份目录是安全的绝对路径，
 * 校验备份确实位于备份目录内（防路径穿越）。
 */
async function recoverRestoreBackup(filename: string): Promise<void> {
  const entry = libraryManager?.currentEntry();
  if (!entry) throw new Error("RECOVERY_ENTRY_UNAVAILABLE");
  const backupDirectory = backupDirectoryFor(entry);
  await mkdir(backupDirectory, { recursive: true });
  const fullPath = path.resolve(backupDirectory, filename);
  const backupRoot = path.resolve(backupDirectory) + path.sep;
  if (fullPath !== path.resolve(backupDirectory, filename) || !fullPath.startsWith(backupRoot)) {
    throw new Error("RECOVERY_BACKUP_PATH_INVALID");
  }
  if (!existsSync(fullPath)) throw new Error("RECOVERY_BACKUP_MISSING");
  const databaseTarget = databasePathFor(entry);
  // 关闭任何可能打开的连接（安全模式下通常未打开）。
  try {
    database?.close();
  } catch {
    /* ignore */
  }
  // SPEC-6：恢复拷贝用原子写 + fsync，防止断电时主库半截。
  await copyFileDurable(fullPath, databaseTarget);
  app.relaunch();
  app.exit(0);
}

/**
 * SPEC-1 安全模式：新建空库（删除损坏主库及 WAL/SHM 侧车）并重启。
 * 下次启动会创建全新数据库。
 */
async function recoverNewDatabase(): Promise<void> {
  const entry = libraryManager?.currentEntry();
  if (!entry) throw new Error("RECOVERY_ENTRY_UNAVAILABLE");
  try {
    database?.close();
  } catch {
    /* ignore */
  }
  const databaseTarget = databasePathFor(entry);
  await rm(databaseTarget, { force: true });
  await rm(`${databaseTarget}-wal`, { force: true });
  await rm(`${databaseTarget}-shm`, { force: true });
  app.relaunch();
  app.exit(0);
}

/**
 * SPEC-2：导入 bundle 后重启，若存在待重映射标记则执行路径重映射并清标记。
 * 标记由 BundleService.importBundle 写入（`<userData>/pending-bundle-remap.json`）。
 */
async function applyPendingBundleRemap(databasePath: string): Promise<void> {
  const remapFile = path.join(path.dirname(databasePath), "pending-bundle-remap.json");
  let raw: string;
  try {
    raw = await readFile(remapFile, "utf8");
  } catch {
    return; // 无标记 → 正常启动。
  }
  try {
    const parsed = JSON.parse(raw) as {
      rules: Array<{ from: string; to: string }>;
    };
    if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
      await rm(remapFile, { force: true });
      return;
    }
    const remapped = database.remapPaths(parsed.rules);
    console.log(
      `BUNDLE_REMAP ${JSON.stringify(remapped)}`,
    );
  } catch (error) {
    console.error("BUNDLE_REMAP_FAILED", error);
  } finally {
    await rm(remapFile, { force: true }).catch(() => undefined);
  }
}

/**
 * Tears down the currently open library connections and reopens them bound to
 * the given library entry. Used at startup and when switching libraries.
 */
async function reopenLibrary(
  entry: LibraryEntry,
  options: { readonly?: boolean } = {},
): Promise<void> {  cancelBackgroundServicesStart();
  actions?.close();
  directoryBatches?.close();
  directoryService?.close();
  await library?.close();
  backups?.close();
  database?.close();
  databaseFilename = databasePathFor(entry);
  database = new RefCanvasDatabase(databaseFilename, {
    migrationBackupDirectory: backupDirectoryFor(entry),
    readonly: options.readonly === true,
  });
  const internalCacheRoot = path.join(app.getPath("userData"), "cache");
  const purgedInternalRecords = options.readonly === true
    ? 0
    : database.purgeLinkedRecordsUnderRoots([internalCacheRoot]);
  if (purgedInternalRecords) {
    console.warn(`INTERNAL_CACHE_RECORDS_PURGED count=${purgedInternalRecords}`);
  }
  library = new LibraryService(database, trashPathFor(entry), {
    libraryRoot: entry.root,
    importEnumerator: new ImportEnumeratorClient(
      path.join(__dirname, "import-enumerator.js"),
    ),
    visualSignatureReader: new VisualSignatureWorkerClient(
      path.join(__dirname, "visual-signature-worker.js"),
    ),
    excludedSourceRoots: [internalCacheRoot],
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
      (() => {
        const directoryIndexPath = path.join(
          app.getPath("userData"),
          "cache",
          "directory-index.sqlite",
        );
        // 缓存库可重建：损坏或 schema 过新时删除，worker 下次打开自动重建。
        const reconcile = reconcileCacheDatabase(
          directoryIndexPath,
          APP_MAX_SCHEMA_VERSION,
        );
        if (reconcile.recreated) {
          console.warn(
            `DIRECTORY_INDEX_RECONCILED ${reconcile.reason ?? "unknown"}`,
          );
        }
        return directoryIndexPath;
      })(),
    ),
  });
  directoryService.onSearchProgress((snapshot) => {
    broadcastAll("filesystem:search-progress", snapshot);
  });
  directoryService.onDirectoryProgress((snapshot) => {
    broadcastAll("filesystem:directory-progress", snapshot);
  });
  const filesystemRootPaths = (await directoryService.listRoots()).map(
    (root) => root.path,
  );
  directoryBatches = new DirectoryBatchService({
    resolveSelection: (selection, offset) =>
      selection.mode === "all"
        ? directoryService.resolveSelection(
            selection.directoryPath,
            selection.revision,
            selection.excludedPaths,
            offset,
            undefined,
            selection.extensions,
            selection.favoritesOnly,
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
    allowedRoots: () => [
      ...filesystemRootPaths,
      ...database.listMountRoots().map((mount) => mount.path),
    ],
    trash: (filename) => trashDirectoryPath(filename),
    validateRevision: (directoryPath, revision) =>
      directoryService.validateRevision(directoryPath, revision),
  });
  mountService = new MountService(database);
  scriptsService = new ScriptsService(database);
  boardReferences = new BoardReferenceService(database);
  // 统一任务中心（FND-007 §8.3）：聚合导入/批处理/媒体导出任务。
  mediaJobRegistry = new MediaJobRegistry();
  zipArchiveService = new ZipArchiveService();
  taskCenter = new TaskCenterService({
    listImports: () => library.listImportJobs(),
    listBatches: () => directoryBatches.list(),
    listMediaJobs: () => mediaJobRegistry.list(200),
    cancelImport: async (id) => library.cancelImport(id),
    cancelBatch: async (id) => directoryBatches.cancel(id),
    cancelMedia: async (id) => mediaJobRegistry.cancel(id),
  });
  library.onImportProgress((snapshot) => {
    broadcastAll("library:import-progress", snapshot);
    taskCenter?.notify("import");
    // SPEC-8：大批量导入完成后主动 PASSIVE checkpoint 回收 WAL。
    if (snapshot.state === "completed" || snapshot.state === "failed") {
      scheduleWalCheckpoint();
    }
  });
  directoryBatches.onProgress((snapshot) => {
    broadcastAll("filesystem:batch-progress", snapshot);
    taskCenter?.notify("batch");
  });
  taskCenter.onChanged((snapshot) => {
    broadcastAll("tasks:changed", snapshot);
  });
  mediaJobRegistry.onChanged((snapshot) => {
    broadcastAll("tasks:changed", snapshot);
  });
  // mount 恢复（online）：增量 reconcile 修正该挂载根的链接状态。
  mountService.onMountStateChanged(({ mountId, state }) => {
    broadcastAll("mounts:changed", { type: "state", mountId, state });
    if (state !== "online") return;
    const root = database.listWatchRoots().find((item) => item.id === mountId);
    if (root) void library.reconcileRoots(root.id).catch(() => undefined);
  });
  // 只读降级模式：不执行写恢复/元数据回填（SQLite query_only 会拒绝这些写）。
  if (!database.readOnly) {
    await library.recoverPendingOperations();
  }
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

// SPEC-8：idle / 导入完成 checkpoint 的节流定时器。PASSIVE 不阻塞读者。
let walCheckpointTimer: NodeJS.Timeout | null = null;

/** 立即对三个库做一次 PASSIVE checkpoint（尽力而为，失败不影响主流程）。 */
function checkpointPassive(): void {
  try {
    database?.checkpoint("PASSIVE");
  } catch {
    /* ignore */
  }
  try {
    previewCacheIndex?.checkpoint("PASSIVE");
  } catch {
    /* ignore */
  }
}

/**
 * SPEC-8：节流式 idle checkpoint。应用空闲（无 IPC 活动）若干秒后触发一次
 * PASSIVE checkpoint；导入完成等写密集场景也调用此入口合并进同一节流。
 */
function scheduleWalCheckpoint(delayMs = 3_000): void {
  if (walCheckpointTimer) clearTimeout(walCheckpointTimer);
  walCheckpointTimer = setTimeout(() => {
    walCheckpointTimer = null;
    checkpointPassive();
  }, delayMs);
  walCheckpointTimer.unref();
}

function registerIpc(): void {
  const ipc = new SecureIpcRegistrar(validateSender, () => scheduleWalCheckpoint());

  // 覆盖窗渲染端就绪信号：did-finish-load 的底图推送可能早于渲染端
  // React 挂载（onCaptureSource 订阅之前）而丢失——覆盖窗黑屏、用户
  // 要点第二次截图才成功。渲染端就绪后按屏重推缓存底图，闭环补齐。
  ipc.on("capture:renderer-ready", (event) => {
    for (const [displayId, window] of captureWindows) {
      if (window.isDestroyed() || window.webContents.id !== event.sender.id) {
        continue;
      }
      const source = captureSourcesByDisplay.get(displayId);
      if (source) window.webContents.send("capture:source", source);
      return;
    }
  });

  registerBrowserCaptureIpc(ipc, () => browserCapturePairings);

  registerLibraryIpc(ipc, {
      getDatabase: () => database,
    getLibrary: () => library,
    getLibraryManager: () => libraryManager,
    getThumbnailCacheDirectory: () => thumbnailCacheDirectory,
    getPreviewCacheIndexFilenames: () =>
      previewCacheIndex?.listValidFilenames() ?? [],
    safeFilename,
    windowForSender,
    writeAccess,
  });
  registerLibraryManagementIpc(ipc, {
    getLibrary: () => library,
    windowForSender,
    writeAccess,
  });
  registerCollectionsIpc(ipc, {
    getDatabase: () => database,
    notifyCollectionsChanged: () => broadcastAll("collections:changed"),
    windowForSender,
    writeAccess,
  });
  registerTaskCenterIpc(ipc, {
    getTaskCenter: () => taskCenter,
  });
  registerFilesystemIpc(ipc, {
    getDatabase: () => database,
    getDirectoryBatches: () => directoryBatches,
    getDirectoryService: () => directoryService,
    getFileOperations: () => fileOperations,
    getLibrary: () => library,
    getMountRoots: () => database.listMountRoots(),
    getThumbnailCacheDirectory: () => thumbnailCacheDirectory,
    previewTokens,
    trashDirectoryPath,
    windowForSender,
    writeAccess,
    getArchiveService: () => zipArchiveService,
  });
  registerBackupIpc(ipc, {
    getBackups: () => backups,
    getDatabase: () => database,
    getDatabaseFilename: () => databaseFilename,
    getLibrary: () => library,
  });
  registerBoardIpc(ipc, {
    copyProjectAsset,
    materializePath: (filename) => library.materializePath(filename),
    getBoardReferences: () => boardReferences,
    getDatabase: () => database,
    getMainWindow: () => mainWindow,
    notifyBoardFlushComplete: (event, saved) => {
      const window = windowForSender(event);
      boardFlushResolvers.get(window.id)?.(saved);
    },
    openBoardWindow,
    pngDataUrlToBuffer,
    relinkBoardAsset: (assetId, filename) =>
      library.relinkAsset(assetId, filename),
    windowForSender,
    writeAccess,
  });

  registerResourcesIpc(ipc, {
    getDatabase: () => database,
    getLibrary: () => library,
    getMountService: () => mountService,
    getProviderRegistry: () => providerRegistry!,
    getThumbnailWorker: () => thumbnailWorker,
    getThumbnailCacheDirectory: () => thumbnailCacheDirectory,
    getPreviewCacheIndex: () => previewCacheIndex,
    getScriptsService: () => scriptsService,
    previewTokens,
    notifyMountsChanged: (change) => broadcastAll("mounts:changed", change),
    windowForSender,
    writeAccess,
    getMediaJobRegistry: () => mediaJobRegistry,
  });

  registerActionIpc(ipc, {
    getActions: () => actions,
    getPresets: () => actionPresets,
    windowForSender,
    writeAccess,
  });
  registerMediaNotesIpc(ipc, () => database);
  registerSystemIpc(ipc, {
    configureGlobalShortcuts,
    getDatabase: () => database,
    getDatabaseFilename: () => databaseFilename,
    getLibrary: () => library,
    getLibraryManager: () => libraryManager,
    getMigrationRecovery: () => migrationRecovery,
    getStartupHealth: () => startupHealth,
    recoverListBackups,
    recoverRestoreBackup,
    recoverNewDatabase,
    getMainWindow: () => mainWindow,
    startRegionCapture: runRegionCapture,
    endCaptureSession,
    discardPendingCaptures,
    broadcastOverlayMode,
    notifyCaptureSaved: () => {
      // 覆盖窗口保存后立即关闭，toast 打在主窗口上。
      mainWindow?.webContents.send("capture:saved");
    },
    overlayExitAccelerator,
    pngDataUrlToBuffer,
    registerOverlayEmergencyShortcut,
    saveCapture,
    scheduleBackgroundServices,
    state: {
      get alwaysOnBottom() {
        return alwaysOnBottom;
      },
      set alwaysOnBottom(value) {
        alwaysOnBottom = value;
      },
      // 引用共享：system-ipc 的 save 按屏读取当前会话底图，写入只发生在
      // 主进程的 runRegionCapture/endCaptureSession 里。
      pendingCaptures,
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
    thumbnailWorker,
    windowForSender,
    writeAccess,
  });
}

/**
 * 迁移失败恢复窗口（FND-001）：不初始化任何依赖 database 的服务，只加载
 * 渲染层并展示恢复信息。窗口关闭即退出应用。
 */
function createRecoveryWindow(): void {
  mainWindow = new BrowserWindow({
    width: 880,
    height: 620,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#171a1c",
    show: false,
    title: "RefCanvas — 数据库恢复",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#171a1c",
      symbolColor: "#aeb5b2",
      height: 40,
    },
    webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
  });
  trustedWindows.register(mainWindow);
  hardenWindowNavigation(mainWindow.webContents);
  mainWindow.once("ready-to-show", () => {
    const window = mainWindow;
    window?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?recovery=1`,
    );
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { recovery: "1" } },
    );
  }
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
  trustedWindows.register(mainWindow);

  hardenWindowNavigation(mainWindow.webContents);
  bindFullscreenTitleBarOverlay(mainWindow);
  // 渲染端就绪即重投暂存的网页捕获（后台驻留恢复/冷启动均覆盖）。
  mainWindow.webContents.on("did-finish-load", () => {
    captureDelivery.flushQueue();
  });
  mainWindow.once("ready-to-show", () => {
    const window = mainWindow;
    window?.show();
  });
  mainWindow.on("enter-full-screen", () => {
    setFullscreenTitleBarOverlay(mainWindow, true);
    mainWindow?.webContents.send("system:presentation-mode-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    setFullscreenTitleBarOverlay(mainWindow, false);
    mainWindow?.webContents.send("system:presentation-mode-changed", false);
  });
  mainWindow.on("close", (event) => {
    if (!mainWindow) return;
    if (!quitting) saveMainWindowBounds();
    // 后台驻留开启：隐藏并保留 renderer，托盘恢复无需重新加载整个应用。
    if (!quitting && backgroundResidencyEnabled()) {
      event.preventDefault();
      mainWindow.hide();
      createTray();
      // 驻留模式：白板窗口随主窗口一并关闭，避免失去托管的编辑入口。
      closeAllBoardWindows();
      return;
    }
    if (mainWindowsClosingAfterFlush.has(mainWindow.id)) return;
    event.preventDefault();
    void closeWindowAfterBoardFlush(mainWindow, mainWindowsClosingAfterFlush);
  });
  mainWindow.on("closed", () => {
    if (mainWindow) mainWindowsClosingAfterFlush.delete(mainWindow.id);
    mainWindow = null;
    // 窗口关闭即会话结束：清空 refbrowse 预览 token，防止复用。
    previewTokens.clear();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const query = new URLSearchParams();
    if (fpsCheckMode) query.set("fps", "1");
    if (app.isPackaged && squirrelFirstRun) query.set("first-run", "1");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    void mainWindow.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}${suffix}`,
    );
  } else {
    const query = {
      ...(fpsCheckMode ? { fps: "1" } : {}),
      ...(app.isPackaged && squirrelFirstRun ? { "first-run": "1" } : {}),
    };
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: Object.keys(query).length ? query : undefined },
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
  trustedWindows.register(window);
  hardenWindowNavigation(window.webContents);
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (quitting || !window.webContents || boardWindowsClosingAfterFlush.has(window.id)) return;
    event.preventDefault();
    void closeWindowAfterBoardFlush(window, boardWindowsClosingAfterFlush);
  });
  window.on("closed", () => {
    boardFlushResolvers.delete(window.id);
    boardWindowsClosingAfterFlush.delete(window.id);
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

async function flushBoardRenderer(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return true;
  const saved = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2_000);
    boardFlushResolvers.set(window.id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
    window.webContents.send("boards:flush-request");
  });
  boardFlushResolvers.delete(window.id);
  return saved;
}

async function closeWindowAfterBoardFlush(
  window: BrowserWindow,
  closingWindows: Set<number>,
): Promise<void> {
  const saved = await flushBoardRenderer(window);
  if (saved && !window.isDestroyed()) {
    closingWindows.add(window.id);
    window.close();
  }
}

function setFullscreenTitleBarOverlay(window: BrowserWindow | null, fullscreen: boolean): void {
  if (!window || window.isDestroyed()) return;
  // setTitleBarOverlay 仅 Windows/macOS 支持；Linux 上直接跳过，避免抛错。
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  window.setTitleBarOverlay({
    // 沉浸模式（HTML5/窗口级全屏、聚焦预览）下窗口控制按钮应完全不可见：
    // color 透明背景 + symbolColor 全透明符号，避免半透明按钮仍压住画面。
    color: fullscreen ? "#00000000" : "#171a1c",
    symbolColor: fullscreen ? "#00000000" : "#aeb5b2",
    height: 40,
  });
}

function bindFullscreenTitleBarOverlay(window: BrowserWindow): void {
  window.on("enter-html-full-screen", () => setFullscreenTitleBarOverlay(window, true));
  window.on("leave-html-full-screen", () => setFullscreenTitleBarOverlay(window, false));
}

void app.whenReady().then(async () => {
  // 阶段 7：本地 crash dump（不自动上传；dump 落 userData/Crashes）。
  crashReporter.start({
    submitURL: "",
    uploadToServer: false,
    compress: true,
    extra: {
      appVersion: app.getVersion(),
      platform: process.platform,
      channel: app.isPackaged ? "signed" : "unsigned",
    },
  });
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
  // 注册 IPC handler 必须早于恢复窗口/健康检查分支：safe/too-new 分支会
  // `createRecoveryWindow()` 并立即 return，而恢复页依赖 `system:get-startup-health`
  // 与 `system:get-migration-failure` 获取数据。所有 handler 都是惰性闭包，
  // 注册本身不访问尚未初始化的服务，安全。
  registerIpc();
  const databasePath = databasePathFor(initialEntry);
  // SPEC-1/SPEC-7：启动前先探主库健康，决定正常 / 只读降级 / 拒绝(过新) /
  // 安全模式，而不是让 `new Database` / `migrate` 直接崩溃。
  const primaryHealth = inspectPrimaryDatabase(databasePath, APP_MAX_SCHEMA_VERSION);
  let openReadOnly = false;
  if (primaryHealth.status === "too-new") {
    migrationRecovery = {
      failed: true,
      databasePath,
      backupDirectory: backupDirectoryFor(initialEntry),
      entries: [],
    };
    startupHealth = { mode: "too-new", databasePath, reason: `schema v${primaryHealth.schemaVersion} > app max v${APP_MAX_SCHEMA_VERSION}`, previousCrash: false };
    createRecoveryWindow();
    return;
  }
  if (primaryHealth.status === "unsafe") {
    // 安全模式：库完全打不开，不打开、不初始化服务；展示恢复页并提供
    // "从最近备份恢复" / "新建空库" 入口。
    backupCorruptPrimary(databasePath, userData);
    migrationRecovery = {
      failed: true,
      databasePath,
      backupDirectory: backupDirectoryFor(initialEntry),
      entries: [],
    };
    startupHealth = { mode: "safe", databasePath, reason: primaryHealth.reason, previousCrash: false };
    createRecoveryWindow();
    return;
  }
  if (primaryHealth.status === "degraded") {
    // 只读降级：quick_check 失败但仍可只读打开 → 保留浏览，拒绝写。
    const backup = backupCorruptPrimary(databasePath, userData);
    console.warn(
      `PRIMARY_DB_DEGRADED ${primaryHealth.reason}; corrupted backup: ${backup ?? "none"}`,
    );
    degradedMode = true;
    openReadOnly = true;
  }
  try {
    await reopenLibrary(initialEntry, { readonly: openReadOnly });
  } catch (error) {
    // FND-001：迁移失败时停留在恢复页，不进入主工作区。记录可诊断信息，
    // 创建恢复窗口展示数据库/备份位置。
    console.error("STARTUP_MIGRATION_FAILED", error);
    migrationRecovery = computeMigrationRecovery(initialEntry, database);
  }
  if (migrationRecovery.failed) {
    // 数据库未成功打开：不初始化任何依赖 database 的服务，只展示恢复页。
    createRecoveryWindow();
    return;
  }
  // SPEC-2：导入 bundle 后重启，执行待处理的路径重映射（linked 资产根映射）。
  await applyPendingBundleRemap(databasePath);
  // 崩溃检测：正常退出会在 shutdownServices 写 clean-shutdown 标记；启动时
  // 标记缺失说明上次异常退出。白板数据是即时持久化的（500ms debounce 已落
  // 库），故只提示、不恢复未保存数据。检测后立即清除标记（本次启动即重写）。
  // 首次启动（hasLaunchedBefore 缺失）不视为崩溃——全新 profile 没有
  // cleanShutdown 标记是正常现象，不应显示横幅。
  const hasLaunchedBefore = database.getSetting<boolean>("hasLaunchedBefore", false);
  startupHealth = {
    ...startupHealth,
    previousCrash:
      hasLaunchedBefore &&
      database.getSetting<boolean>("cleanShutdown", false) === false,
  };
  database.setSetting("hasLaunchedBefore", true);
  database.setSetting("cleanShutdown", false);
  thumbnailCacheDirectory = path.join(userData, "cache", "thumbnails");
  const previewIndexPath = path.join(userData, "cache", "preview-index.sqlite");
  // 缓存库是可重建的派生数据：损坏或 schema 比本应用新时直接删除重建
  // （SPEC-1/SPEC-7），而不是卡死启动。
  const previewIndexReconcile = reconcileCacheDatabase(
    previewIndexPath,
    APP_MAX_SCHEMA_VERSION,
  );
  if (previewIndexReconcile.recreated) {
    console.warn(
      `PREVIEW_CACHE_RECONCILED ${previewIndexReconcile.reason ?? "unknown"}`,
    );
  }
  previewCacheIndex = new PreviewCacheIndex(previewIndexPath, {
    // SPEC-5：运行中事件触发 prune 时记录日志并回收对应缓存文件。
    onPrune: ({ removedFiles, totalBefore, totalAfter, elapsedMs }) => {
      for (const filename of removedFiles) {
        void rm(filename, { force: true });
      }
      console.log(
        `PREVIEW_CACHE_PRUNE removed=${removedFiles.length} before=${totalBefore} after=${totalAfter} ms=${elapsedMs}`,
      );
    },
  });
  // 性能偏好（§10.2）启动回填：并发设置此前只在「改动时」套用，重启后
  // 队列回到硬编码默认 4、worker 回到 sharp 默认核数，直到用户再次改动。
  const previewSettings = readPreviewSettings(database);
  thumbnailQueue.setConcurrency(previewSettings.previewConcurrency);
  thumbnailWorker = new ThumbnailWorkerClient(
    path.join(__dirname, "thumbnail-worker.js"),
    thumbnailCacheDirectory,
    previewSettings.thumbnailWorkerThreads,
  );
  providerRegistry = new ProviderRegistry();
  // provider worker 不继承 process.defaultApp（undefined 会被误判为打包
  // 环境、只找 app.asar.unpacked 侧车），显式传递打包状态供侧车定位。
  process.env.REFCANVAS_PACKAGED = app.isPackaged ? "1" : "0";
  providerSupervisor = new WorkerSupervisor({
    workerPath: path.join(__dirname, "provider-worker.js"),
    serviceName: "RefCanvas Provider Worker",
    maxConcurrency: 2,
    // 必须大于解码子进程自身的 90s 超时（openimageio-tools），否则大文件
    // 解码在 60s 被提前取消、oiiotool 仍在运行，重试再起一个进程导致
    // 内存翻倍与 worker 崩溃循环。
    defaultDeadlineMs: 120_000,
  });
  const genericProvider = new GenericProvider();
  providerRegistry.register({
    provider: genericProvider,
    dispose: () => genericProvider.dispose(),
  });
  const hdrProvider = new WorkerBackedProvider(
    HDR_PROVIDER_MANIFEST,
    providerSupervisor,
  );
  providerRegistry.register({
    provider: hdrProvider,
    dispose: () => hdrProvider.dispose(),
  });
  const geometryProvider = new WorkerBackedProvider(
    GEOMETRY_PROVIDER_MANIFEST,
    providerSupervisor,
  );
  providerRegistry.register({
    provider: geometryProvider,
    dispose: () => geometryProvider.dispose(),
  });
  const videoProvider = new WorkerBackedProvider(
    VIDEO_PROVIDER_MANIFEST,
    providerSupervisor,
  );
  providerRegistry.register({
    provider: videoProvider,
    dispose: () => videoProvider.dispose(),
  });
  const imageProvider = new WorkerBackedProvider(
    IMAGE_PROVIDER_MANIFEST,
    providerSupervisor,
  );
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
  // 统一清理：移除未被索引的 frame/palette/media 残留以及 WebP 迁移前的旧
  // .png 缩略图；随后删除索引中已指向不存在文件的记录，保持索引与磁盘一致。
  const orphanRemoved = await cleanupOrphanThumbnails(
    thumbnailCacheDirectory,
    new Set(previewCacheIndex.listValidFilenames()),
  );
  if (orphanRemoved.length > 0) {
    console.log(`THUMBNAIL_CACHE_ORPHAN_CLEANUP removed=${orphanRemoved.length}`);
  }
  const missingRemoved = previewCacheIndex.removeMissingFiles();
  if (missingRemoved > 0) {
    console.log(`PREVIEW_CACHE_INDEX_RECONCILE removed=${missingRemoved}`);
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
    originPolicy: {
      allowedOrigins: MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? [MAIN_WINDOW_VITE_DEV_SERVER_URL]
        : [],
      allowedReferrerPrefixes: MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? [MAIN_WINDOW_VITE_DEV_SERVER_URL]
        : [
            `${pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`)).href}/`,
          ],
    },
  });
  if (database.getSetting("globalShortcuts", false)) {
    configureGlobalShortcuts(true);
  }
  // 启动时修复存量 watch root 与 mount root 的 1:1 关联，再刷新挂载状态。
  // 只读降级模式下跳过（这些是写操作，query_only 会拒绝）。
  if (!degradedMode) {
    repairMountRoots();
  }
  const refreshMounts = () => {
    void mountService.refreshAll();
  };
  if (!degradedMode) {
    refreshMounts();
  }
  // 运行期间受控轮询挂载状态，检测断连/重连（计划 §7.5 外部增删改语义）。
  // 只读降级模式下跳过（刷新会写库）。
  if (!degradedMode) {
    const mountPollTimer = setInterval(refreshMounts, 15_000);
    mountPollTimer.unref();
  }

  const commandLineFiles = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((value) => !value.startsWith("-"));
  if (commandLineFiles.length) {
    await importCommandLineEntries(commandLineFiles);
  }
  createWindow();
  prewarmCaptureWindow();
  // 显示器拔出：清掉那块屏的覆盖窗；截图会话进行中则立即收会话——
  // 冻结画面缺了一块已无意义，宿主必须马上恢复可交互。
  screen.on("display-removed", (_event, oldDisplay) => {
    residentCaptureDisplayId =
      residentCaptureDisplayId === oldDisplay.id ? null : residentCaptureDisplayId;
    if (captureSession.isActive()) {
      endCaptureSession("forced");
      return;
    }
    const window = captureWindows.get(oldDisplay.id);
    if (!window) return;
    captureWindows.delete(oldDisplay.id);
    if (!window.isDestroyed()) window.destroy();
  });

  // Browser extension capture server (127.0.0.1:17530).
  // Lets the Chrome/Edge extension send images from web pages into RefCanvas.
  // 投递走模块级 captureDelivery（确认制 + 暂存重投），不再 fire-and-forget。
  createCaptureServer(
    {
      getCaptureDirectory: () => browserCapturesPath(app.getPath("userData")),
      getBoardsSummary: () =>
        database.listBoards().map((board) => ({ id: board.id, title: board.title })),
      onCapture: (filePath, meta) => {
        captureDelivery.deliver({
          path: filePath,
          sourceUrl: meta.sourceUrl,
          boardId: meta.boardId,
          pageTitle: meta.pageTitle,
          alt: meta.alt,
        });
      },
      pair: (code, origin, label) =>
        browserCapturePairings.pair(code, origin, label),
      authenticate: (origin, token) =>
        Boolean(browserCapturePairings.authenticate(origin, token)),
    },
    17530,
  ).on("error", (error) => {
    // 端口被占（崩溃残留进程或其他程序）：捕获服务没起来，扩展侧只会显示
    // 未连接/发送失败，必须让用户看见原因，不能只留一条 console。
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    console.warn("[browser-capture] port 17530 in use, skipping");
    showTrayNotification(
      "RefCanvas",
      "扩展捕获端口 17530 被其他程序占用，浏览器捕获暂不可用（可重启电脑后重试）。",
    );
  });

  // 启动时清理 browser-captures 孤儿文件（无资产引用且超过宽限期）。
  void pruneOrphanedCaptures({
    directory: browserCapturesPath(app.getPath("userData")),
    hasAssetAtPath: (absolutePath) => Boolean(database.getAssetByPath(absolutePath)),
  }).catch((error) => {
    console.warn("[browser-capture] orphan prune failed:", error);
  });

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
  }
  // 二次启动常伴随用户主动回到应用：把暂存捕获立刻重投。
  captureDelivery.flushQueue();
  void library?.resumeWatching();
  const files = argv.slice(1).filter((value) => !value.startsWith("-"));
  if (files.length && library) {
    // 第二实例打开目录 → 在新标签打开；文件 → 定位其父目录（FND-002）。
    const directories = files.filter((entry) => isDirectoryPath(entry));
    if (directories.length > 0) {
      mainWindow?.webContents.send("browser:open-directory-tab", directories[0]);
      return;
    }
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
  writeAccess.clear();
  // 先收截图会话（恢复宿主锁定/焦点），再冲刷渲染端。
  endCaptureSession("forced");
  saveMainWindowBounds();
  const flushed = await Promise.all([
    ...[...boardWindows.values()].map(flushBoardRenderer),
    ...(mainWindow ? [flushBoardRenderer(mainWindow)] : []),
  ]);
  if (flushed.some((saved) => !saved)) {
    throw new Error("BOARD_FLUSH_FAILED");
  }
  // 崩溃检测：正常退出写 clean-shutdown 标记，供下次启动判断是否异常退出。
  database?.setSetting("cleanShutdown", true);
  for (const window of boardWindows.values()) window.destroy();
  boardWindows.clear();
  // 常驻复用的截图窗口是隐藏而非关闭：不显式销毁会拖住 window-all-closed。
  destroyCaptureWindows();
  await discardPendingCaptures();
  mainWindow?.destroy();
  cancelBackgroundServicesStart();
  globalShortcut.unregisterAll();
  destroyTray();
  thumbnailQueue.clear("APP_QUITTING");
  thumbnailWorker?.close();
  previewCacheIndex?.close();
  await providerRegistry?.dispose();
  await providerSupervisor?.close();
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