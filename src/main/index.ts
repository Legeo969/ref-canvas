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
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import Database from "better-sqlite3";
import { BackupService } from "./services/backup-service";
import { ActionService } from "./services/action-service";
import { RefCanvasDatabase } from "./persistence/database";
import type { MigrationRecoveryInfo } from "./ipc/system-ipc";
import {
  rewriteBoardAssetId,
  toBoardV2,
} from "./persistence/repositories/boards-repository";
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
import { ScriptsService } from "./services/scripts-service";
import { BoardReferenceService } from "./services/board-reference-service";
import { DirectoryIndexClient } from "./platform/directory-index-client";
import { ImportEnumeratorClient } from "./platform/import-enumerator-client";
import { DirectoryBatchService } from "./services/directory-batch-service";
import { PreviewTokenRegistry } from "./platform/refbrowse";
import { PreviewQueue } from "./platform/preview-queue";
import { PreviewCacheIndex } from "./platform/preview-cache-index";
import { ThumbnailWorkerClient } from "./platform/thumbnail-worker-client";
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
import { registerAiIpc, readAiSettings } from "./ipc/ai-ipc";
import { registerTaskCenterIpc } from "./ipc/task-center-ipc";
import { AiJobService } from "./services/ai/ai-job-service";
import type { AiProvider } from "./services/ai/ai-provider";
import type { AiProviderKind } from "../shared/contracts";
import { MockAiProvider } from "./services/ai/mock-ai-provider";
import { ComfyUiProvider } from "./services/ai/comfyui-provider";
import { RemoteRestProvider } from "./services/ai/remote-ai-provider";
import {
  HttpComfyTransport,
  HttpRemoteTransport,
} from "./services/ai/http-transports";
import { AiSecretStore } from "./services/ai/ai-secret-store";
import {
  inspectBinding,
  parseWorkflow,
  type ComfyWorkflowBinding,
} from "./services/ai/comfyui-workflow";
import { TaskCenterService } from "./services/task-center-service";
import { ZipArchiveService } from "./services/zip-archive-service";
import { trayIconPaths } from "./platform/tray-icon";
import {
  hardenWindowNavigation,
  secureWebPreferences,
} from "./platform/window-security";
import type { BoardDocument } from "../shared/contracts";
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
const writeAccess = new WriteAccessController(() => [app.getPath("userData")]);
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
let aiJobService: AiJobService;
let aiSecretStore: AiSecretStore;
let taskCenter: TaskCenterService;
let zipArchiveService: ZipArchiveService;
let captureWasFullScreen = false;
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

async function buildAiProviders(): Promise<Map<AiProviderKind, AiProvider>> {
  const providers = new Map<AiProviderKind, AiProvider>();
  if (mockAiAllowed()) providers.set("mock", new MockAiProvider());
  const settings = readAiSettings(database);
  if (settings.comfyuiWorkflowPath && settings.comfyuiBinding) {
    try {
      const workflowText = await readFile(settings.comfyuiWorkflowPath, "utf8");
      const workflow = parseWorkflow(workflowText);
      const binding = settings.comfyuiBinding as ComfyWorkflowBinding;
      if (workflow && inspectBinding(workflow, binding).valid) {
        providers.set(
          "comfyui",
          new ComfyUiProvider({
            address: settings.comfyuiAddress,
            workflow,
            binding,
            transport: new HttpComfyTransport(settings.comfyuiAddress),
          }),
        );
      }
    } catch {
      // workflow 文件缺失/损坏：不注册，health 呈现不可用。
    }
  }
  if (settings.remoteBaseUrl) {
    const remoteProvider = new RemoteRestProvider({
      baseUrl: settings.remoteBaseUrl,
      transport: new HttpRemoteTransport(),
    });
    remoteProvider.setTokenProvider(() => aiSecretStore.read());
    providers.set("remote-rest", remoteProvider);
  }
  return providers;
}
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
  });
  rebuildTrayMenu();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/** 启动期数据库迁移失败的恢复信息（FND-001：失败时不进入主工作区）。 */
let migrationRecovery: MigrationRecoveryInfo = {
  failed: false,
  databasePath: null,
  backupDirectory: null,
  entries: [],
};

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

/**
 * Tears down the currently open library connections and reopens them bound to
 * the given library entry. Used at startup and when switching libraries.
 */
async function reopenLibrary(entry: LibraryEntry): Promise<void> {  cancelBackgroundServicesStart();
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
  // AI Design Supervisor（FND-008 §9）：Mock 仅在开发/测试构建注册；
  // ComfyUI 与 Remote REST 按持久化配置注册真实 Provider（FND-009/010）。
  aiSecretStore = new AiSecretStore({
    filePath: path.join(app.getPath("userData"), "ai-secret.bin"),
  });
  aiJobService = new AiJobService(database.aiJobs(), await buildAiProviders());
  // 重启恢复：对非终态 job 尝试 Provider.recover，不支持则标记 failed。
  void aiJobService.recoverInterrupted();
  // 统一任务中心（FND-007 §8.3）：聚合导入/批处理/AI 任务。
  zipArchiveService = new ZipArchiveService();
  taskCenter = new TaskCenterService({
    listImports: () => library.listImportJobs(),
    listBatches: () => directoryBatches.list(),
    listAiJobs: () => aiJobService.list(100),
    cancelImport: async (id) => library.cancelImport(id),
    cancelBatch: async (id) => directoryBatches.cancel(id),
    cancelAi: async (id) => {
      await aiJobService.cancel(id);
      return true;
    },
  });
  library.onImportProgress((snapshot) => {
    broadcastAll("library:import-progress", snapshot);
    taskCenter?.notify("import");
  });
  directoryBatches.onProgress((snapshot) => {
    broadcastAll("filesystem:batch-progress", snapshot);
    taskCenter?.notify("batch");
  });
  // mount 恢复（online）：增量 reconcile 修正该挂载根的链接状态。
  mountService.onMountStateChanged(({ mountId, state }) => {
    broadcastAll("mounts:changed", { type: "state", mountId, state });
    if (state !== "online") return;
    const root = database.listWatchRoots().find((item) => item.id === mountId);
    if (root) void library.reconcileRoots(root.id);
  });
  await library.recoverPendingOperations();
  library.resumePendingMetadata();
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

/** Mock Provider 仅在开发/测试构建允许（found-clone.md §9.4；正式打包隐藏）。 */
function mockAiAllowed(): boolean {
  return !app.isPackaged;
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
  registerAiIpc(ipc, {
    getDatabase: () => database,
    getAiJobService: () => aiJobService,
    isMockAllowed: () => mockAiAllowed(),
    getSecretStore: () => aiSecretStore,
    reloadProviders: async () => {
      aiJobService.replaceProviders(await buildAiProviders());
    },
    notifyAiChanged: (snapshot) => broadcastAll("ai:changed", snapshot),
    windowForSender,
    writeAccess,
  });
  registerTaskCenterIpc(ipc, {
    getTaskCenter: () => taskCenter,
  });
  registerFilesystemIpc(ipc, {
    getDirectoryBatches: () => directoryBatches,
    getDirectoryService: () => directoryService,
    getFileOperations: () => fileOperations,
    getLibrary: () => library,
    getMountRoots: () => database.listMountRoots(),
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
    getScriptsService: () => scriptsService,
    previewTokens,
    notifyMountsChanged: (change) => broadcastAll("mounts:changed", change),
    windowForSender,
    writeAccess,
  });

  registerActionIpc(ipc, {
    getActions: () => actions,
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
    getMainWindow: () => mainWindow,
    openPreviewWindow,
    overlayExitAccelerator,
    pngDataUrlToBuffer,
    registerOverlayEmergencyShortcut,
    restoreCaptureWindow,
    saveCapture,
    scheduleBackgroundServices,
    setImmersiveTitleBarOverlay: (window, immersive) =>
      setFullscreenTitleBarOverlay(window, immersive),
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
    if (!squirrelFirstRun || !window) return;
    const isChinese = app.getLocale().toLowerCase().startsWith("zh");
    void dialog.showMessageBox(window, {
      type: "info",
      title: isChinese ? "RefCanvas 安装完成" : "RefCanvas installed",
      message: isChinese
        ? `RefCanvas ${app.getVersion()} 已安装完成`
        : `RefCanvas ${app.getVersion()} was installed successfully`,
      detail: isChinese
        ? "现在可以开始使用。以后可在“设置 → 关于”或 Windows“已安装的应用”中卸载。"
        : "You can start using it now. Uninstall later from Settings → About or Windows Installed apps.",
      buttons: [isChinese ? "开始使用" : "Get started"],
      defaultId: 0,
      noLink: true,
    });
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
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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

const previewWindows = new Set<BrowserWindow>();

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

/** base64url 编码预览路径（renderer 侧 preview-window.ts 解码）。 */
function encodePreviewWindowPath(filename: string): string {
  return Buffer.from(filename, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 打开浮动预览窗口（FND-004 §5 会话）；主窗口退出时一并关闭。 */
function openPreviewWindow(filename: string): void {
  const existing = [...previewWindows].find((window) => !window.isDestroyed());
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const encoded = encodePreviewWindowPath(filename);
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: "#171a1c",
    show: false,
    title: "RefCanvas · 浮动预览",
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
  bindFullscreenTitleBarOverlay(window);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => previewWindows.delete(window));
  previewWindows.add(window);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?preview=${encodeURIComponent(encoded)}&mode=window`,
    );
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { preview: encoded, mode: "window" } },
    );
  }
}

/** 关闭全部浮动预览窗口（主窗口退出时）。 */
function closeAllPreviewWindows(): void {
  for (const window of previewWindows) {
    if (!window.isDestroyed()) window.close();
  }
  previewWindows.clear();
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
  try {
    await reopenLibrary(initialEntry);
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
  thumbnailCacheDirectory = path.join(userData, "cache", "thumbnails");
  previewCacheIndex = new PreviewCacheIndex(
    path.join(userData, "cache", "preview-index.sqlite"),
  );
  thumbnailWorker = new ThumbnailWorkerClient(
    path.join(__dirname, "thumbnail-worker.js"),
    thumbnailCacheDirectory,
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
  registerIpc();
  if (database.getSetting("globalShortcuts", false)) {
    configureGlobalShortcuts(true);
  }
  // 启动时修复存量 watch root 与 mount root 的 1:1 关联，再刷新挂载状态。
  repairMountRoots();
  const refreshMounts = () => {
    void mountService.refreshAll();
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
  saveMainWindowBounds();
  const flushed = await Promise.all([
    ...[...boardWindows.values()].map(flushBoardRenderer),
    ...(mainWindow ? [flushBoardRenderer(mainWindow)] : []),
  ]);
  if (flushed.some((saved) => !saved)) {
    throw new Error("BOARD_FLUSH_FAILED");
  }
  for (const window of boardWindows.values()) window.destroy();
  boardWindows.clear();
  closeAllPreviewWindows();
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
