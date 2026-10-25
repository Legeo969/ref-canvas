import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import type {
  BrowserCapturePayload,
  CaptureSource,
  RefCanvasApi,
} from "../shared/contracts";

ipcRenderer.on("boards:flush-request", () => {
  const event = new Event("refcanvas:board-flush-request", { cancelable: true });
  if (window.dispatchEvent(event)) ipcRenderer.send("boards:flush-complete", true);
});

function applyUiScale(preferences: unknown): void {
  if (!preferences || typeof preferences !== "object") return;
  const previewSettings = (preferences as { previewSettings?: unknown }).previewSettings;
  if (!previewSettings || typeof previewSettings !== "object") return;
  const scale = (previewSettings as { uiScale?: unknown }).uiScale;
  if (typeof scale !== "number" || !Number.isFinite(scale)) return;
  webFrame.setZoomFactor(Math.min(1.5, Math.max(0.8, scale)));
  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
}

const api: RefCanvasApi = {
  browserCapture: {
    createPairingCode: () =>
      ipcRenderer.invoke("browser-capture:create-pairing-code"),
    listPairings: () => ipcRenderer.invoke("browser-capture:list-pairings"),
    revokePairing: (id) =>
      ipcRenderer.invoke("browser-capture:revoke-pairing", id),
  },
  library: {
    searchWindow: (input) => ipcRenderer.invoke("library:search-window", input),
    get: (id) => ipcRenderer.invoke("library:get", id),
    getByPath: (path) => ipcRenderer.invoke("library:get-by-path", path),
    importPaths: (paths) =>
      ipcRenderer.invoke("library:import-paths", paths),
    onImportProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("library:import-progress", listener);
      return () => ipcRenderer.off("library:import-progress", listener);
    },
    onLibraryChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        change: Parameters<typeof callback>[0],
      ) => callback(change);
      ipcRenderer.on("library:changed", listener);
      return () => ipcRenderer.off("library:changed", listener);
    },
    pathsForFiles: (files) =>
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    update: (id, patch) =>
      ipcRenderer.invoke("library:update", id, patch),
    setTags: (assetId, tags) =>
      ipcRenderer.invoke("library:set-tags", assetId, tags),
    listAutoTagRules: () =>
      ipcRenderer.invoke("library:list-auto-tag-rules"),
    createAutoTagRule: (rule) =>
      ipcRenderer.invoke("library:create-auto-tag-rule", rule),
    updateAutoTagRule: (id, patch) =>
      ipcRenderer.invoke("library:update-auto-tag-rule", id, patch),
    deleteAutoTagRule: (id) =>
      ipcRenderer.invoke("library:delete-auto-tag-rule", id),
    previewAutoTagRule: (rule) =>
      ipcRenderer.invoke("library:preview-auto-tag-rule", rule),
    applyAutoTagRules: () =>
      ipcRenderer.invoke("library:apply-auto-tag-rules"),
    getPreferences: () => ipcRenderer.invoke("library:get-preferences"),
    setPreferences: (prefs) =>
      ipcRenderer.invoke("library:set-preferences", prefs),
    findSimilar: (id, options) =>
      ipcRenderer.invoke("library:find-similar", id, options),
    getSimilarityIndex: () =>
      ipcRenderer.invoke("library:get-similarity-index"),
    cancelSimilarityIndex: () =>
      ipcRenderer.invoke("library:cancel-similarity-index"),
    onSimilarityProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("library:similarity-progress", listener);
      return () => ipcRenderer.off("library:similarity-progress", listener);
    },
    startMediaMetadataRebuild: () =>
      ipcRenderer.invoke("library:start-media-metadata-rebuild"),
    getMediaMetadataRebuild: () =>
      ipcRenderer.invoke("library:get-media-metadata-rebuild"),
    cancelMediaMetadataRebuild: () =>
      ipcRenderer.invoke("library:cancel-media-metadata-rebuild"),
    onMediaMetadataProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("library:media-metadata-progress", listener);
      return () =>
        ipcRenderer.off("library:media-metadata-progress", listener);
    },
    exportBundle: () => ipcRenderer.invoke("library:export-bundle"),
    importBundle: (options) =>
      ipcRenderer.invoke("library:import-bundle", options),
  },
  libraries: {
    managedPreflight: () => ipcRenderer.invoke("libraries:managed-preflight"),
    managedMigrate: (targetDirectory) =>
      ipcRenderer.invoke("libraries:managed-migrate", targetDirectory),
    capturesDirectory: () => ipcRenderer.invoke("libraries:captures-directory"),
    adoptCaptures: (paths, targetDirectory) =>
      ipcRenderer.invoke("libraries:adopt-captures", { paths, targetDirectory }),
  },
  mounts: {
    list: () => ipcRenderer.invoke("mounts:list"),
    add: (path) => ipcRenderer.invoke("mounts:add", path),
    remove: (id) => ipcRenderer.invoke("mounts:remove", id),
    reconnect: (id) => ipcRenderer.invoke("mounts:reconnect", id),
    onChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        change: Parameters<typeof callback>[0],
      ) => callback(change);
      ipcRenderer.on("mounts:changed", listener);
      return () => ipcRenderer.off("mounts:changed", listener);
    },
  },
  collections: {
    list: () => ipcRenderer.invoke("collections:list"),
    create: (input) => ipcRenderer.invoke("collections:create", input),
    update: (id, patch) =>
      ipcRenderer.invoke("collections:update", { id, patch }),
    delete: (id, options) =>
      ipcRenderer.invoke("collections:delete", { id, ...options }),
    listItems: (collectionId) =>
      ipcRenderer.invoke("collections:list-items", collectionId),
    addPaths: (collectionId, paths) =>
      ipcRenderer.invoke("collections:add-paths", { collectionId, paths }),
    removeItems: (collectionId, itemIds) =>
      ipcRenderer.invoke("collections:remove-items", {
        collectionId,
        itemIds,
      }),
    resolve: (collectionId) =>
      ipcRenderer.invoke("collections:resolve", collectionId),
    relink: (itemId, path, confirmFingerprintChange) =>
      ipcRenderer.invoke("collections:relink", {
        itemId,
        path,
        confirmFingerprintChange,
      }),
    export: (collectionId, targetDirectory, options) =>
      ipcRenderer.invoke("collections:export", {
        collectionId,
        targetDirectory,
        jobId: options?.jobId,
        conflictAction: options?.conflictAction,
      }),
    cancelExport: (jobId) =>
      ipcRenderer.invoke("collections:cancel-export", jobId),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("collections:changed", listener);
      return () => ipcRenderer.off("collections:changed", listener);
    },
  },
  tasks: {
    list: (limit) => ipcRenderer.invoke("tasks:list", { limit }),
    get: (id) => ipcRenderer.invoke("tasks:get", id),
    cancel: (id) => ipcRenderer.invoke("tasks:cancel", id),
    onChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("tasks:changed", listener);
      return () => ipcRenderer.off("tasks:changed", listener);
    },
  },
  metadata: {
    ensure: (path) => ipcRenderer.invoke("metadata:ensure", path),
    patch: (assetId, patch) =>
      ipcRenderer.invoke("metadata:patch", assetId, patch),
  },
  media: {
    probe: (path) => ipcRenderer.invoke("media:probe", path),
    thumbnail: (path, options) =>
      ipcRenderer.invoke("media:thumbnail", path, options),
    preview: (path) => ipcRenderer.invoke("media:preview", path),
    validateOcioConfig: (path) =>
      ipcRenderer.invoke("media:validateOcioConfig", path),
    frame: (path, options) =>
      ipcRenderer.invoke("media:frame", path, options),
    gifFrames: (path, options) =>
      ipcRenderer.invoke("media:gifFrames", path, options),
    palette: (path, options) =>
      ipcRenderer.invoke("media:palette", path, options),
    downscale: (request) => ipcRenderer.invoke("media:downscale", request),
    convert: (path, targetFormat, jobId) =>
      ipcRenderer.invoke("media:convert", path, targetFormat, jobId),
    exportGif: (request) => ipcRenderer.invoke("media:exportGif", request),
    exportFrames: (request) => ipcRenderer.invoke("media:exportFrames", request),
    exportMp4: (request) => ipcRenderer.invoke("media:exportMp4", request),
    exportDisplayChannel: (request) =>
      ipcRenderer.invoke("media:exportDisplayChannel", request),
    cancel: (jobId) => ipcRenderer.invoke("media:cancel", jobId),
    waveform: (path, options) =>
      ipcRenderer.invoke("media:waveform", path, options),
    readText: (path, options) =>
      ipcRenderer.invoke("media:readText", path, options),
  },
  sequences: {
    detect: (directory, options) =>
      ipcRenderer.invoke("sequences:detect", directory, options),
    exportMp4: (request) => ipcRenderer.invoke("sequences:exportMp4", request),
    exportGif: (request) => ipcRenderer.invoke("sequences:exportGif", request),
  },
  color: {
    getStatus: () => ipcRenderer.invoke("color:get-status"),
    sampleImage: (request: { assetId: string; u: number; v: number }) =>
      ipcRenderer.invoke("color:sample-image", request),
  },
  scripts: {
    list: () => ipcRenderer.invoke("scripts:list"),
    inspect: (request) => ipcRenderer.invoke("scripts:inspect", request),
    register: (request) => ipcRenderer.invoke("scripts:register", request),
    unregister: (id) => ipcRenderer.invoke("scripts:unregister", id),
    run: (request) => ipcRenderer.invoke("scripts:run", request),
  },
  filesystem: {
    listRoots: () => ipcRenderer.invoke("filesystem:list-roots"),
    setObservedDirectory: (path) =>
      ipcRenderer.invoke("filesystem:set-observed-directory", path),
    listDirectory: (path, options) =>
      ipcRenderer.invoke("filesystem:list-directory", path, options),
    pathType: (path) => ipcRenderer.invoke("filesystem:path-type", path),
    onDirectoryProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("filesystem:directory-progress", listener);
      return () =>
        ipcRenderer.removeListener("filesystem:directory-progress", listener);
    },
    locateEntry: (path, entryPath, revision, options) =>
      ipcRenderer.invoke(
        "filesystem:locate-entry",
        path,
        entryPath,
        revision,
        options,
      ),
    startSearch: (path, query, options) =>
      ipcRenderer.invoke("filesystem:start-search", path, query, options),
    cancelSearch: (id) => ipcRenderer.invoke("filesystem:cancel-search", id),
    getSearch: (id) => ipcRenderer.invoke("filesystem:get-search", id),
    getSearchPage: (id, options) =>
      ipcRenderer.invoke("filesystem:get-search-page", id, options),
    onSearchProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("filesystem:search-progress", listener);
      return () =>
        ipcRenderer.removeListener("filesystem:search-progress", listener);
    },
    addQuickAccess: (path, name) =>
      ipcRenderer.invoke("filesystem:add-quick-access", path, name),
    updateQuickAccess: (id, patch) =>
      ipcRenderer.invoke("filesystem:update-quick-access", id, patch),
    removeQuickAccess: (id) =>
      ipcRenderer.invoke("filesystem:remove-quick-access", id),
    listQuickAccess: () => ipcRenderer.invoke("filesystem:list-quick-access"),
    materialize: (path) =>
      ipcRenderer.invoke("filesystem:materialize", path),
    rename: (path, newName, options) =>
      ipcRenderer.invoke("filesystem:rename", path, newName, options),
    createFolder: (parentPath, name, options) =>
      ipcRenderer.invoke("filesystem:create-folder", parentPath, name, options),
    copy: (sources, targetDirectory, options) =>
      ipcRenderer.invoke("filesystem:copy", sources, targetDirectory, options),
    move: (sources, targetDirectory, options) =>
      ipcRenderer.invoke("filesystem:move", sources, targetDirectory, options),
    trash: (paths, options) =>
      ipcRenderer.invoke("filesystem:trash", paths, options),
    open: (path) => ipcRenderer.invoke("filesystem:open", path),
    reveal: (path) => ipcRenderer.invoke("filesystem:reveal", path),
    previewToken: (path) =>
      ipcRenderer.invoke("filesystem:preview-token", path),
    previewTokens: (paths) =>
      ipcRenderer.invoke("filesystem:preview-tokens", paths),
    startBatch: (selection, action) =>
      ipcRenderer.invoke("filesystem:start-batch", selection, action),
    exportPaths: (selection) =>
      ipcRenderer.invoke("filesystem:export-paths", selection),
    getBatch: (id) => ipcRenderer.invoke("filesystem:get-batch", id),
    cancelBatch: (id) => ipcRenderer.invoke("filesystem:cancel-batch", id),
    archive: (request) => ipcRenderer.invoke("filesystem:archive", request),
    cancelArchive: (jobId) =>
      ipcRenderer.invoke("filesystem:cancel-archive", jobId),
    onBatchProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("filesystem:batch-progress", listener);
      return () => ipcRenderer.removeListener("filesystem:batch-progress", listener);
    },
    dragOut: (paths) =>
      ipcRenderer.send("system:start-native-drag-paths", paths),
  },
  backups: {
    list: () => ipcRenderer.invoke("backups:list"),
    create: () => ipcRenderer.invoke("backups:create"),
    restore: (path) => ipcRenderer.invoke("backups:restore", path),
  },
  boards: {
    list: () => ipcRenderer.invoke("boards:list"),
    create: (title) => ipcRenderer.invoke("boards:create", title),
    rename: (id, title) => ipcRenderer.invoke("boards:rename", id, title),
    delete: (id) => ipcRenderer.invoke("boards:delete", id),
    load: (id) => ipcRenderer.invoke("boards:load", id),
    save: (id, document, revision) =>
      ipcRenderer.invoke("boards:save", id, document, revision),
    exportPng: (id, dataUrl) =>
      ipcRenderer.invoke("boards:export-png", id, dataUrl),
    exportPackage: (id, options) =>
      ipcRenderer.invoke("boards:export-package", id, options),
    importProject: () => ipcRenderer.invoke("boards:import-project"),
    recent: () => ipcRenderer.invoke("boards:recent"),
    touch: (id) => ipcRenderer.invoke("boards:touch", id),
    openWindow: (id) => ipcRenderer.invoke("boards:open-window", id),
    closeWindow: () => ipcRenderer.invoke("boards:close-window"),
    confirmFlush: (saved) => ipcRenderer.send("boards:flush-complete", saved),
    getAssets: (id) => ipcRenderer.invoke("boards:get-assets", id),
    resolveReferences: (id) =>
      ipcRenderer.invoke("boards:resolve-references", id),
    relinkReference: (id, assetId, path) =>
      ipcRenderer.invoke("boards:relink-reference", id, assetId, path),
  },
  actions: {
    preview: (request) => ipcRenderer.invoke("actions:preview", request),
    start: (request) => ipcRenderer.invoke("actions:start", request),
    listPresets: () => ipcRenderer.invoke("actions:list-presets"),
    savePreset: (input) => ipcRenderer.invoke("actions:save-preset", input),
    updatePreset: (id, input) => ipcRenderer.invoke("actions:update-preset", id, input),
    deletePreset: (id) => ipcRenderer.invoke("actions:delete-preset", id),
    runPreset: (id, targets) => ipcRenderer.invoke("actions:run-preset", id, targets),
    get: (id) => ipcRenderer.invoke("actions:get", id),
    cancel: (id) => ipcRenderer.invoke("actions:cancel", id),
    retry: (id) => ipcRenderer.invoke("actions:retry", id),
    resolveConflict: (id, outputPath, overwrite) =>
      ipcRenderer.invoke("actions:resolve-conflict", id, outputPath, overwrite),
    onProgress: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof callback>[0],
      ) => callback(snapshot);
      ipcRenderer.on("actions:progress", listener);
      return () => ipcRenderer.off("actions:progress", listener);
    },
  },
  mediaNotes: {
    list: (assetId) => ipcRenderer.invoke("media-notes:list", assetId),
    create: (assetId, input) =>
      ipcRenderer.invoke("media-notes:create", assetId, input),
    update: (id, patch) =>
      ipcRenderer.invoke("media-notes:update", id, patch),
    delete: (id) => ipcRenderer.invoke("media-notes:delete", id),
    getPlaybackState: (assetId) =>
      ipcRenderer.invoke("media-notes:get-playback-state", assetId),
    setPlaybackState: (assetId, state) =>
      ipcRenderer.invoke("media-notes:set-playback-state", assetId, state),
  },
  system: {
    openExternal: (path) =>
      ipcRenderer.invoke("system:open-external", path),
    openUrl: (url) => ipcRenderer.invoke("system:open-url", url),
    openRecycleBin: () => ipcRenderer.invoke("system:open-recycle-bin"),
    openFilesWithDefaultApp: (paths) =>
      ipcRenderer.invoke("system:open-files-with-default-app", paths),
    revealInFolder: (path) => ipcRenderer.invoke("system:reveal", path),
    openDataFolder: () => ipcRenderer.invoke("system:open-data-folder"),
    requestUninstall: () => ipcRenderer.invoke("system:request-uninstall"),
    pickDirectory: (options) =>
      ipcRenderer.invoke("system:pick-directory", options),
    pickFile: (options) => ipcRenderer.invoke("system:pick-file", options),
    saveRenderedImage: (dataUrl, options) =>
      ipcRenderer.invoke("system:save-rendered-image", dataUrl, options),
    toggleAlwaysOnTop: () =>
      ipcRenderer.invoke("system:toggle-always-on-top"),
    markRendererInteractive: () =>
      ipcRenderer.invoke("system:mark-renderer-interactive"),
    setAlwaysOnBottom: (enabled) =>
      ipcRenderer.invoke("system:set-always-on-bottom", enabled),
    setInteractionLift: (enabled) =>
      ipcRenderer.invoke("system:set-interaction-lift", enabled),
    setClickThrough: (enabled) =>
      ipcRenderer.invoke("system:set-click-through", enabled),
    setWindowTransparent: (enabled) =>
      ipcRenderer.invoke("system:set-window-transparent", enabled),
    getWindowModeState: () =>
      ipcRenderer.invoke("system:get-window-mode-state"),
    setPresentationMode: (enabled) =>
      ipcRenderer.invoke("system:set-presentation-mode", enabled),
    onPresentationModeChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) =>
        callback(enabled);
      ipcRenderer.on("system:presentation-mode-changed", listener);
      return () =>
        ipcRenderer.removeListener(
          "system:presentation-mode-changed",
          listener,
        );
    },
    onWindowModeReset: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("system:window-mode-reset", listener);
      return () => ipcRenderer.off("system:window-mode-reset", listener);
    },
    /** FND-002：第二实例打开目录 → 主窗口在新标签打开。 */
    onOpenDirectoryTab: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        path: string,
      ) => callback(path);
      ipcRenderer.on("browser:open-directory-tab", listener);
      return () => ipcRenderer.off("browser:open-directory-tab", listener);
    },
    onBrowserCapture: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: BrowserCapturePayload,
      ) => callback(data);
      ipcRenderer.on("browser:capture", listener);
      return () => ipcRenderer.off("browser:capture", listener);
    },
    ackBrowserCapture: (captureId: string) =>
      ipcRenderer.send("browser:capture-ack", captureId),
    captureClipboard: () =>
      ipcRenderer.invoke("system:capture-clipboard"),
    prepareRegionCapture: () =>
      ipcRenderer.invoke("system:prepare-region-capture"),
    captureReady: () => ipcRenderer.send("capture:renderer-ready"),
    onCaptureSource: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        source: CaptureSource,
      ) => callback(source);
      ipcRenderer.on("capture:source", listener);
      return () => ipcRenderer.off("capture:source", listener);
    },
    onCaptureSaved: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("capture:saved", listener);
      return () => ipcRenderer.off("capture:saved", listener);
    },
    onCaptureFailed: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("capture:failed", listener);
      return () => ipcRenderer.off("capture:failed", listener);
    },
    saveRegionCapture: (crop) =>
      ipcRenderer.invoke("system:save-region-capture", crop),
    saveCaptureImage: (dataUrl) =>
      ipcRenderer.invoke("system:save-capture-image", dataUrl),
    cancelRegionCapture: () =>
      ipcRenderer.invoke("system:cancel-region-capture"),
    notifySelectionActive: (active: boolean) =>
      ipcRenderer.send("capture:selection-active", active),
    onOverlayMode: (
      callback: (mode: "active" | "passive") => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        mode: "active" | "passive",
      ) => callback(mode);
      ipcRenderer.on("capture:overlay-mode", listener);
      return () => ipcRenderer.off("capture:overlay-mode", listener);
    },
    rebuildThumbnailCache: () =>
      ipcRenderer.invoke("system:rebuild-thumbnail-cache"),
    exportDiagnostics: () =>
      ipcRenderer.invoke("system:export-diagnostics"),
    setGlobalShortcuts: (enabled) =>
      ipcRenderer.invoke("system:set-global-shortcuts", enabled),
    getPreferences: async () => {
      const preferences = await ipcRenderer.invoke("system:get-preferences");
      applyUiScale(preferences);
      return preferences;
    },
    setPreferences: async (prefs) => {
      const preferences = await ipcRenderer.invoke("system:set-preferences", prefs);
      applyUiScale(preferences);
      return preferences;
    },
    getAppInfo: () => ipcRenderer.invoke("system:get-app-info"),
    getMigrationFailure: () =>
      ipcRenderer.invoke("system:get-migration-failure"),
    getStartupHealth: () =>
      ipcRenderer.invoke("system:get-startup-health"),
    recoverListBackups: () =>
      ipcRenderer.invoke("system:recover-list-backups"),
    recoverRestoreBackup: (filename) =>
      ipcRenderer.invoke("system:recover-restore-backup", filename),
    recoverNewDatabase: () =>
      ipcRenderer.invoke("system:recover-new-database"),
    writeClipboard: (text) =>
      ipcRenderer.invoke("system:write-clipboard", text),
    getNavigationState: () =>
      ipcRenderer.invoke("system:get-navigation-state"),
    setNavigationState: (value) =>
      ipcRenderer.invoke("system:set-navigation-state", value),
    getBoardShortcuts: () =>
      ipcRenderer.invoke("system:get-board-shortcuts"),
    setBoardShortcuts: (value) =>
      ipcRenderer.invoke("system:set-board-shortcuts", value),
    startNativeDrag: (assetIds) =>
      ipcRenderer.send("system:start-native-drag", assetIds),
  },
};

contextBridge.exposeInMainWorld("refCanvas", api);
