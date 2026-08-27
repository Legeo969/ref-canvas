import {
  Camera,
  Expand,
  FileJson,
  HardDrive,
  ImageDown,
  MonitorPlay,
  PanelLeftClose,
  PanelsTopLeft,
  Pin,
  PinOff,
  PackageOpen,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
  ListTodo,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  AssetRecord,
  BoardSettings,
  BoardSummary,
  BrowserCapturePayload,
  SimilarAsset,
  SimilarityIndexSnapshot,
} from "../../shared/contracts";
import {
  BOARD_PANEL_IDS,
  DIRECTORY_PANEL_IDS,
  PANEL_DEFAULTS,
  normalizePanelLayout,
  panelLayoutForWindow,
  panelWidthOf,
  setPanelWidthOf,
  withCollapsed,
  type PanelId,
  type PanelLayout,
} from "./panel-layout";
import {
  presentationModeForWorkspace,
  presentationTargetForF11,
} from "./presentation-mode";
import { workspaceStatusHint } from "./workspace-status";
import { parseBoardWindowParams } from "./board-window";
import { usePreviewSettings } from "./preview-settings";
import { translate, useAppLanguage } from "./i18n";
import { ActionsPanel } from "../components/ActionsPanel";
import { AiDesignSupervisorPanel } from "../components/AiDesignSupervisor";
import { BoardCanvas } from "../components/BoardCanvas";
import { BoardWindow } from "../components/BoardWindow";
import { BrowserTabBar } from "../components/BrowserTabBar";
import { CaptureWindow } from "../components/CaptureWindow";
import { TaskCenter } from "../components/TaskCenter";
import { CollectionDetailsPanel } from "../components/CollectionsPanel";
import { DirectoryAssetPanel } from "../components/DirectoryAssetPanel";
import { useDialog } from "../components/DialogProvider";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import { PanelDividers } from "../components/PanelDividers";
import { SettingsPanel } from "../components/SettingsPanel";
import { InstallCompleteScreen } from "../components/InstallCompleteScreen";
import { SimilarPanel } from "../components/SimilarPanel";
import { Sidebar } from "../components/Sidebar";
import { PreviewPanel } from "../components/PreviewPanel";
import { useAppStore } from "./store";

/**
 * Window router. Keep auxiliary windows outside WorkspaceApp so they never
 * inherit the main workspace's loading gate or initialization effects.
 */
export function App() {
  useAppLanguage();
  const boardWindowParams = parseBoardWindowParams(window.location.search);
  if (boardWindowParams) {
    return <BoardWindow boardId={boardWindowParams.boardId} />;
  }

  // 独立区域截图覆盖窗口（?capture=1）：主窗口保持可见，无需隐藏/关窗。
  if (new URLSearchParams(window.location.search).get("capture") === "1") {
    return <CaptureWindow />;
  }

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const store = useAppStore(
    useShallow(({
      selectedAsset: _selectedAsset,
      selectedIds: _selectedIds,
      allMatchingSelected: _allMatchingSelected,
      excludedIds: _excludedIds,
      selectionAnchorId: _selectionAnchorId,
      ...state
    }) => state),
  );
  const dialog = useDialog();
  const uiScale = usePreviewSettings().uiScale;
  const [boardInteractionPreset, setBoardInteractionPreset] = useState<
    BoardSettings["interactionPreset"]
  >("pureref");
  useEffect(() => {
    const apply = (settings: BoardSettings) =>
      setBoardInteractionPreset(settings.interactionPreset);
    const onSettingsChanged = (event: Event) =>
      apply((event as CustomEvent<BoardSettings>).detail);
    void window.refCanvas.system
      .getPreferences()
      .then((preferences) => apply(preferences.boardSettings));
    window.addEventListener("refcanvas:board-settings", onSettingsChanged);
    return () =>
      window.removeEventListener("refcanvas:board-settings", onSettingsChanged);
  }, []);
  // 迁移失败恢复模式（?recovery=1）：只展示恢复信息，不进入主工作区。
  const [recoveryMode] = useState(() =>
    new URLSearchParams(window.location.search).get("recovery") === "1",
  );
  const [installCompleteOpen, setInstallCompleteOpen] = useState(() =>
    !recoveryMode &&
    new URLSearchParams(window.location.search).get("first-run") === "1",
  );
  const dismissInstallComplete = useCallback(() => {
    setInstallCompleteOpen(false);
    window.focus();
  }, []);
  const [migrationFailure, setMigrationFailure] = useState<Awaited<
    ReturnType<typeof window.refCanvas.system.getMigrationFailure>
  > | null>(null);
  const [startupHealth, setStartupHealth] = useState<Awaited<
    ReturnType<typeof window.refCanvas.system.getStartupHealth>
  > | null>(null);
  const capturePreparingRef = useRef(false);
  const [capturePreparing, setCapturePreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [similarSource, setSimilarSource] = useState<AssetRecord | null>(null);
  const [similarResults, setSimilarResults] = useState<SimilarAsset[]>([]);
  const [similarIndex, setSimilarIndex] = useState<SimilarityIndexSnapshot>({
    state: "idle",
    total: 0,
    processed: 0,
    indexed: 0,
    failed: 0,
  });
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarMinScore, setSimilarMinScore] = useState(70);
  const [settingsTab, setSettingsTab] = useState<"general" | "preview">("general");
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [panelLayout, setPanelLayout] = useState(PANEL_DEFAULTS);
  const [presentationMode, setPresentationModeState] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinPending, setPinPending] = useState(false);

  const prepareRegionCapture = useCallback(async () => {
    if (capturePreparingRef.current) return;
    capturePreparingRef.current = true;
    setCapturePreparing(true);
    try {
      // 主进程抓屏后打开独立覆盖窗口（?capture=1），框选在覆盖窗口内完成，
      // 主窗口保持可见。返回值仅供确认成功，不再在主窗口渲染覆盖层。
      await window.refCanvas.system.prepareRegionCapture();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setNotice(
        message === "SCREEN_CAPTURE_UNAVAILABLE"
          ? translate("capture.unavailable")
          : message || translate("capture.error"),
      );
      window.setTimeout(() => setNotice(null), 4200);
    } finally {
      capturePreparingRef.current = false;
      setCapturePreparing(false);
    }
  }, []);

  useEffect(() => {
    if (recoveryMode) {
      void window.refCanvas.system.getMigrationFailure().then(setMigrationFailure);
    }
    void window.refCanvas.system.getStartupHealth().then(setStartupHealth);
  }, [recoveryMode]);

  const refreshSimilar = useCallback(async (
    source: AssetRecord,
    minScore = similarMinScore,
  ) => {
    setSimilarLoading(true);
    try {
      const [results, index] = await Promise.all([
        window.refCanvas.library.findSimilar(source.id, { limit: 100, minScore }),
        window.refCanvas.library.getSimilarityIndex(),
      ]);
      setSimilarResults(results);
      setSimilarIndex(index);
    } finally {
      setSimilarLoading(false);
    }
  }, [similarMinScore]);

  useEffect(() => {
    const unsubscribe = window.refCanvas.library.onSimilarityProgress?.(setSimilarIndex);
    const onFindSimilar = (event: Event) => {
      const detail = (event as CustomEvent<{ assetId?: string; path?: string }>).detail;
      void (async () => {
        const source = detail.assetId
          ? await window.refCanvas.library.get(detail.assetId)
          : detail.path
            ? (await window.refCanvas.metadata.ensure(detail.path)).asset
            : null;
        if (!source || source.kind !== "image") return;
        setSimilarSource(source);
        setSimilarResults([]);
        await refreshSimilar(source);
      })();
    };
    window.addEventListener("refcanvas:find-similar", onFindSimilar);
    return () => {
      unsubscribe?.();
      window.removeEventListener("refcanvas:find-similar", onFindSimilar);
    };
  }, [refreshSimilar]);

  useEffect(() => {
    if (recoveryMode) return; // 恢复模式不初始化主工作区。
    void store.initialize().catch((reason) => {
      useAppStore.setState({ loading: false });
      setNotice(
        reason instanceof Error && reason.message
          ? reason.message
          : translate("app.workspaceInitFailed"),
      );
    });
  }, [recoveryMode]);

  useEffect(() => {
    void window.refCanvas.filesystem.setObservedDirectory(
      store.workspaceMode === "directory" ? store.directoryPath : null,
    );
  }, [store.directoryPath, store.workspaceMode]);

  useEffect(() => {
    if (!store.preferences) return;
    setPanelLayout(normalizePanelLayout(store.preferences.panelLayout));
  }, [store.preferences?.panelLayout, store.preferences]);

  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (!message) return;
      setNotice(message);
      window.setTimeout(() => setNotice(null), 4200);
    };
    window.addEventListener("refcanvas:toast", onToast);
    return () => window.removeEventListener("refcanvas:toast", onToast);
  }, []);

  useEffect(() => {
    setWindowWidth(window.innerWidth);
  }, [uiScale]);

  useEffect(() => {
    const openDuplicates = () => setDuplicatesOpen(true);
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<"general" | "preview">).detail;
      setSettingsTab(detail === "preview" ? "preview" : "general");
      setMaintenanceOpen(true);
    };
    window.addEventListener("refcanvas:duplicates", openDuplicates);
    window.addEventListener("refcanvas:open-settings", openSettings);
    const unsubscribe = window.refCanvas.system.onRegionCaptureRequest(() => {
      void prepareRegionCapture();
    });
    return () => {
      window.removeEventListener("refcanvas:duplicates", openDuplicates);
      window.removeEventListener("refcanvas:open-settings", openSettings);
      unsubscribe();
    };
  }, [prepareRegionCapture]);

  // Browser extension capture: main process writes the image to a temp file,
  // then notifies the renderer to import it into the active board.
  // 确认制投递：导入成功后回 ackBrowserCapture；失败不回执——主进程超时后
  // 会入队暂存（托盘提示），窗口就绪时自动重投，不再静默丢图。
  const importBrowserCapture = useCallback(
    (data: BrowserCapturePayload) => {
      void (async () => {
        // 选板投放：先切到目标板再导入。板已被删除时 switchBoard 内部
        // 静默保持当前板——比丢弃捕获更合理，来源信息仍会回写。
        if (data.boardId) {
          await store.switchBoard(data.boardId);
        }
        const addedAssets = await store.addDirectoryEntriesToBoard([data.path]);
        // 回写来源元数据：网页图文件名基本是乱码，页面标题作标题、
        // URL/alt 进自定义字段，右图可溯源。失败不影响上板与回执。
        try {
          const asset =
            addedAssets[0] ??
            (await window.refCanvas.library.getByPath(data.path));
          if (asset) {
            const customFields: Record<string, string> = {
              ...asset.customFields,
            };
            let hasMeta = false;
            if (data.sourceUrl) {
              customFields.sourceUrl = data.sourceUrl;
              hasMeta = true;
            }
            if (data.pageTitle) {
              customFields.pageTitle = data.pageTitle;
              hasMeta = true;
            }
            if (data.alt) {
              customFields.alt = data.alt;
              hasMeta = true;
            }
            const pageTitle = data.pageTitle?.trim().slice(0, 256);
            if (pageTitle || hasMeta) {
              await window.refCanvas.library.update(asset.id, {
                title: pageTitle || undefined,
                customFields: hasMeta ? customFields : undefined,
              });
            }
          }
        } catch (error) {
          console.warn(
            "BROWSER_CAPTURE_META_WRITEBACK_FAILED",
            data.path,
            error,
          );
        }
        // 同时归档进「网页捕获」集合：捕获有可发现、可导出的家，不再只是
        // 散落在库里的一条 linked 记录。归档失败不影响上板主流程与回执。
        void store.addBrowserCaptureToCollection(data.path);
        if (data.captureId) {
          window.refCanvas.system.ackBrowserCapture(data.captureId);
        }
      })().catch((error) => {
        console.warn("BROWSER_CAPTURE_IMPORT_FAILED", data.path, error);
      });
    },
    [store],
  );

  useEffect(() => {
    return window.refCanvas.system.onBrowserCapture(importBrowserCapture);
  }, [importBrowserCapture]);

  useEffect(() => {
    // 只同步 App 自己的演示模式状态，绝不强制退出窗口全屏：预览全屏
    // （PreviewSessionModeButtons）发生在 directory 工作区，若在这里
    // setPresentationMode(false) 会把刚进入的全屏立刻退掉（「全屏闪一
    // 下」）。board 演示模式的状态退出由下方 effect 按 workspaceMode 处理。
    return window.refCanvas.system.onPresentationModeChanged((enabled) => {
      setPresentationModeState(
        enabled && useAppStore.getState().workspaceMode === "board",
      );
    });
  }, []);

  useEffect(() => {
    void window.refCanvas.system
      .getWindowModeState()
      .then((state) => setAlwaysOnTop(state.alwaysOnTop));
    return window.refCanvas.system.onWindowModeReset(() =>
      setAlwaysOnTop(false),
    );
  }, []);

  const toggleAlwaysOnTop = useCallback(async () => {
    if (pinPending) return;
    setPinPending(true);
    try {
      setAlwaysOnTop(
        await window.refCanvas.system.toggleAlwaysOnTop(),
      );
    } finally {
      setPinPending(false);
    }
  }, [pinPending]);

  const setPresentationMode = useCallback(async (enabled: boolean) => {
    const actual = await window.refCanvas.system.setPresentationMode(enabled);
    setPresentationModeState(actual);
  }, []);

  const boardPresentationMode = presentationModeForWorkspace(
    presentationMode,
    store.workspaceMode,
  );

  // 异常退出状态仍由主进程保留用于诊断，但不向用户显示打扰性横幅。
  // 只有数据库降级/只读等会影响当前操作安全的状态需要常驻提示。
  const hasStartupBanner = startupHealth?.mode === "degraded";

  useEffect(() => {
    if (store.workspaceMode === "board" || !presentationMode) return;
    void setPresentationMode(false);
  }, [presentationMode, setPresentationMode, store.workspaceMode]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("refcanvas:presentation-mode", {
        detail: boardPresentationMode,
      }),
    );
  }, [boardPresentationMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 合成键盘事件的目标可能是 window/document（非 Element），此时
      // matches/isContentEditable 会抛 TypeError；真实按键始终以元素为
      // 目标，但防御性收窄不会改变任何正常行为。
      const target =
        event.target instanceof HTMLElement ? event.target : null;
      const isEditing =
        target?.matches("input, textarea, select") ||
        target?.isContentEditable ||
        Boolean(target?.closest('[role="dialog"]'));
      if (event.key === "F11") {
        event.preventDefault();
        const target = presentationTargetForF11(
          boardPresentationMode,
          store.workspaceMode,
        );
        if (target !== null) void setPresentationMode(target);
        return;
      }
      if (event.key === "Escape" && boardPresentationMode) {
        event.preventDefault();
        void setPresentationMode(false);
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-field input")?.focus();
      }
      if (
        event.key === "Tab" &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditing &&
        !boardPresentationMode &&
        store.workspaceMode === "board"
      ) {
        event.preventDefault();
        store.toggleFocusMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    boardPresentationMode,
    setPresentationMode,
    store.workspaceMode,
    store.toggleFocusMode,
  ]);

  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : translate("app.operationFailed");
      setNotice(message);
      window.setTimeout(() => setNotice(null), 4200);
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  if (recoveryMode) {
    const isSafe = startupHealth?.mode === "safe";
    const isTooNew = startupHealth?.mode === "too-new";
    return (
      <div className="recovery-screen">
        <div className="recovery-card">
          <span className="brand-mark">R</span>
          <h1>
            {isTooNew
              ? translate("app.schemaTooNewTitle")
              : isSafe
                ? translate("app.safeModeTitle")
                : translate("app.recoveryTitle")}
          </h1>
          <p>
            {isTooNew
              ? translate("app.schemaTooNewDescription")
              : isSafe
                ? translate("app.safeModeDescription")
                : translate("app.recoveryDescription")}
          </p>
          <dl>
            <div>
              <dt>{translate("app.recoveryDatabaseFile")}</dt>
              <dd>{startupHealth?.databasePath ?? migrationFailure?.databasePath ?? "…"}</dd>
            </div>
            <div>
              <dt>{translate("app.recoveryBackupDirectory")}</dt>
              <dd>{migrationFailure?.backupDirectory ?? "…"}</dd>
            </div>
          </dl>
          {migrationFailure?.entries.map((entry) => (
            <div key={entry.stepId} className="recovery-entry">
              <code>{entry.stepId}</code>
              <span>
                v{entry.fromVersion} → v{entry.toVersion}
              </span>
              <pre>{entry.error}</pre>
            </div>
          ))}
          <div className="recovery-actions">
            {isSafe && (
              <>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void window.refCanvas.system.recoverNewDatabase();
                  }}
                >
                  {translate("app.safeModeNewDatabase")}
                </button>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const backups = await window.refCanvas.system.recoverListBackups();
                    if (!backups.length) {
                      setNotice(translate("app.safeModeNoBackups"));
                      window.setTimeout(() => setNotice(null), 4200);
                      return;
                    }
                    const backup = backups[0]; // 最近备份
                    void window.refCanvas.system.recoverRestoreBackup(backup.filename);
                  }}
                >
                  {translate("app.safeModeRestore")}
                </button>
              </>
            )}
            <button
              className="secondary-button"
              onClick={() => {
                if (migrationFailure?.backupDirectory) {
                  void window.refCanvas.system.openExternal(
                    migrationFailure.backupDirectory,
                  );
                }
              }}
            >
              {translate("app.openBackupDirectory")}
            </button>
            <button className="primary-button" onClick={() => window.close()}>
              {translate("app.quit")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (store.loading) {
    return (
      <div className="loading-screen">
        <div className="loading-titlebar">
          <span className="brand-mark">R</span>
          <span>{translate("app.loadingWorkspace")}</span>
        </div>
        <div className="loading-sidebar" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
        </div>
        <div className="loading-workspace" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
        </div>
      </div>
    );
  }

  const createBoard = async () => {
    const titles = new Set(store.boards.map((board) => board.title));
    let index = 1;
    let defaultTitle: string;
    do {
      defaultTitle = translate("workspace.boardDefault").replace("{number}", String(index).padStart(2, "0"));
      index += 1;
    } while (titles.has(defaultTitle));
    await dialog.requestForm({
      title: translate("boards.new"),
      description: translate("app.newBoardDescription"),
      confirmLabel: translate("app.createBoardConfirm"),
      fields: [
        {
          name: "title",
          label: translate("boards.nameLabel"),
          initialValue: defaultTitle,
          required: true,
          maxLength: 120,
        },
      ],
      onSubmit: ({ title }) => store.createBoard(title),
    });
  };

  const renameBoard = async (board: BoardSummary) => {
    await dialog.requestForm({
      title: translate("board.renameBoardTitle"),
      confirmLabel: translate("collections.save"),
      fields: [
        {
          name: "title",
          label: translate("boards.nameLabel"),
          initialValue: board.title,
          required: true,
          maxLength: 120,
        },
      ],
      onSubmit: ({ title }) => store.renameBoard(board.id, title),
    });
  };

  const deleteBoard = async (board: BoardSummary) => {
    if (
      store.boards.length > 1 &&
      window.confirm(translate("app.deleteBoardConfirm").replace("{name}", board.title))
    ) {
      await store.deleteBoard(board.id);
    }
  };

  const openPickedDirectory = async (directory: string) => {
    const mount = await window.refCanvas.mounts.add(directory);
    await store.openDirectory(mount.path);
  };

  const activePanelIds =
    store.workspaceMode === "directory" ? DIRECTORY_PANEL_IDS : BOARD_PANEL_IDS;
  const effectivePanelLayout = panelLayoutForWindow(
    panelLayout,
    windowWidth,
    activePanelIds,
  );
  const commitPanelLayout = (panel: PanelId, next: PanelLayout) => {
    const desired = setPanelWidthOf(
      withCollapsed(panelLayout, panel, next.collapsed.includes(panel)),
      panel,
      panelWidthOf(next, panel),
    );
    setPanelLayout(desired);
    void store.setPreferences({ panelLayout: desired });
  };

  return (
    <main
      className={`app-shell ${store.focusMode ? "focus-mode" : ""} ${
        boardPresentationMode ? "presentation-mode" : ""
      } ${hasStartupBanner ? "has-startup-banner" : ""}`}
    >

      {duplicatesOpen && (
        <DuplicatesPanel
          groups={store.duplicates}
          onClose={() => setDuplicatesOpen(false)}
          onMerge={store.mergeDuplicates}
        />
      )}
      {maintenanceOpen && (
        <SettingsPanel
          initialTab={settingsTab}
          onClose={() => setMaintenanceOpen(false)}
        />
      )}
      {aiPanelOpen && store.workspaceMode === "board" && (
        <AiDesignSupervisorPanel onClose={() => setAiPanelOpen(false)} />
      )}
      {taskCenterOpen && <TaskCenter onClose={() => setTaskCenterOpen(false)} />}
      {similarSource && (
        <SimilarPanel
          source={similarSource}
          results={similarResults}
          index={similarIndex}
          loading={similarLoading}
          minScore={similarMinScore}
          onMinScoreChange={setSimilarMinScore}
          onRefresh={() => void refreshSimilar(similarSource)}
          onCancelIndex={() => void window.refCanvas.library.cancelSimilarityIndex()}
          onSelect={(asset) => {
            setSimilarSource(null);
            void store.locateAssetInLibrary(asset);
          }}
          onClose={() => setSimilarSource(null)}
        />
      )}
      {notice && <div className="app-toast">{notice}</div>}
      {installCompleteOpen && (
        <InstallCompleteScreen onOpen={dismissInstallComplete} />
      )}
      {hasStartupBanner && (
        <div className="startup-banners">
          {startupHealth?.mode === "degraded" && (
            <div className="degraded-banner" role="alert">
              <span className="degraded-banner-icon">⚠</span>
              <span>{translate("app.degradedBanner")}</span>
            </div>
          )}
        </div>
      )}
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="brand">
            <span className="brand-mark">R</span>
            <span>RefCanvas</span>
          </div>
          <div className="workspace-mode-switch" role="tablist" aria-label={translate("titlebar.workspace")}>
            <button
              role="tab"
              aria-selected={store.workspaceMode === "directory"}
              className={store.workspaceMode === "directory" ? "active" : ""}
              onClick={async () => {
                if (store.directoryPath) {
                  store.showDirectoryWorkspace();
                  return;
                }
                const directory = await window.refCanvas.system.pickDirectory({
                  title: translate("titlebar.openFolder"),
                });
                if (directory) await openPickedDirectory(directory);
              }}
            >
              <HardDrive size={14} />
              {translate("workspace.disk")}
            </button>
            <button
              role="tab"
              aria-selected={store.workspaceMode === "board"}
              className={store.workspaceMode === "board" ? "active" : ""}
              onClick={() => {
                if (store.activeBoard) {
                  void store.switchBoard(store.activeBoard.id);
                } else {
                  void createBoard();
                }
              }}
            >
              <PanelsTopLeft size={14} />
              {translate("workspace.board")}
            </button>
          </div>
        </div>
        <div className="titlebar-actions">
          <button
            className="titlebar-button"
            onClick={() => void prepareRegionCapture()}
            disabled={capturePreparing}
          >
            <Camera size={15} />
            {translate("titlebar.screenshot")}
          </button>
          {store.workspaceMode === "board" && (
            <>
              <span className="titlebar-separator" />
              <button
                className="icon-button"
                onClick={() => {
                  if (store.activeBoard) {
                    void window.refCanvas.boards.exportJson(store.activeBoard.id);
                  }
                }}
                aria-label={translate("titlebar.exportJson")}
              >
                <FileJson size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() =>
                  window.dispatchEvent(new Event("refcanvas:export-png"))
                }
                aria-label={translate("titlebar.exportPng")}
              >
                <ImageDown size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => {
                  if (store.activeBoard) {
                    void window.refCanvas.boards.openWindow(store.activeBoard.id);
                  }
                }}
                aria-label={translate("titlebar.openBoardWindow")}
              >
                <SquareArrowOutUpRight size={16} />
              </button>
              <button
                className="icon-button"
                onClick={async () => {
                  if (!store.activeBoard) return;
                  const destination = await window.refCanvas.library.collectProject(
                    store.activeBoard.id,
                  );
                  if (!destination) return;
                  setNotice(translate("titlebar.collectedProject").replace("{path}", destination));
                  window.setTimeout(() => setNotice(null), 4200);
                }}
                aria-label={translate("titlebar.collectProject")}
              >
                <PackageOpen size={16} />
              </button>
            </>
          )}
          <span className="titlebar-separator" />
          <button
            className={`icon-button pin-toggle${alwaysOnTop ? " active" : ""}`}
            onClick={() => void toggleAlwaysOnTop()}
            aria-label={translate(alwaysOnTop ? "titlebar.unpin" : "titlebar.pin")}
            aria-pressed={alwaysOnTop}
            disabled={pinPending}
          >
            <span className="pin-icon-stack" aria-hidden="true">
              <Pin className="pin-icon-rest" size={16} />
              <PinOff className="pin-icon-active" size={16} />
            </span>
          </button>
          {store.workspaceMode === "board" && (
            <>
              <button
                className="icon-button"
                onClick={store.toggleFocusMode}
                aria-label={translate("titlebar.focusBoard")}
                data-shortcut="Tab"
              >
                {store.focusMode ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <Expand size={16} />
                )}
              </button>
              <button
                className="icon-button"
                onClick={() => void setPresentationMode(true)}
                aria-label={translate("titlebar.presentBoard")}
                data-shortcut="F11"
              >
                <MonitorPlay size={16} />
              </button>
            </>
          )}
          <button
            className={`icon-button${aiPanelOpen ? " active" : ""}`}
            onClick={() => {
              if (store.workspaceMode === "directory") {
                setAiPanelOpen(false);
                window.dispatchEvent(new Event("refcanvas:open-ai-workbench"));
              } else {
                setAiPanelOpen((value) => !value);
              }
            }}
            aria-label={translate("directory.aiDesignSupervisor")}
            aria-pressed={aiPanelOpen}
          >
            <Sparkles size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => {
              setSettingsTab("general");
              setMaintenanceOpen(true);
            }}
            aria-label={translate("titlebar.settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className={`workspace ${store.workspaceMode}-workspace`}>
        <Sidebar />
        <PanelDividers
          panel="sidebar"
          activePanels={activePanelIds}
          layout={effectivePanelLayout}
          windowWidth={windowWidth}
          onCommit={(next) => commitPanelLayout("sidebar", next)}
        />
        {store.workspaceMode === "board" ? (
          store.activeBoard && store.boardDocument ? (
            <BoardCanvas
              board={store.activeBoard}
              document={store.boardDocument}
              assets={store.assets}
              boards={store.boards}
              onSelectAsset={store.selectAsset}
              onLocateAsset={store.locateAssetInLibrary}
              onSave={store.saveBoard}
              onSwitchBoard={store.switchBoard}
              onCreateBoard={createBoard}
              onRenameBoard={renameBoard}
              onDeleteBoard={deleteBoard}
              onLibraryChanged={store.reloadAssets}
              pendingAssetIds={store.pendingBoardAssetIds}
              onPendingAssetsConsumed={store.consumePendingBoardAssets}
            />
          ) : (
            <section className="board-panel board-unavailable">
              {translate("boards.unavailable")}
            </section>
          )
        ) : store.activeCollectionId ? (
          <>
            <div className="workspace-main-column">
              <BrowserTabBar />
              <CollectionDetailsPanel />
            </div>
            <PanelDividers
              panel="details"
              activePanels={activePanelIds}
              layout={effectivePanelLayout}
              windowWidth={windowWidth}
              onCommit={(next) => commitPanelLayout("details", next)}
            />
            <PreviewPanel entry={store.selectedDirectoryEntry} />
          </>
        ) : (
          <>
            <div className="workspace-main-column">
              <BrowserTabBar />
              <DirectoryAssetPanel />
            </div>
            <PanelDividers
              panel="details"
              activePanels={activePanelIds}
              layout={effectivePanelLayout}
              windowWidth={windowWidth}
              onCommit={(next) => commitPanelLayout("details", next)}
            />
            <PreviewPanel entry={store.selectedDirectoryEntry} />
          </>
        )}
      </div>

      {boardPresentationMode && (
        <button
          className="presentation-exit"
          onClick={() => void setPresentationMode(false)}
          aria-label={translate("presentation.exit")}
          data-shortcut="F11 / Esc"
        >
          {translate("presentation.exit")}
          <kbd>F11 / Esc</kbd>
        </button>
      )}

      <footer className="statusbar">
        <span>
          {store.importing
            ? translate("status.importing")
            : store.workspaceMode === "directory"
              ? translate("status.diskReady")
            : translate("status.boardReady")}
        </span>
        <span
          className="status-hint"
          title={workspaceStatusHint(store.workspaceMode, boardInteractionPreset)}
        >
          {workspaceStatusHint(store.workspaceMode, boardInteractionPreset)}
        </span>
        <span className="statusbar-actions">
          <button
            className={`statusbar-button ${taskCenterOpen ? "active" : ""}`}
            onClick={() => setTaskCenterOpen((value) => !value)}
            aria-label={translate("tasks.title")}
          >
            <ListTodo size={15} />
            {translate("titlebar.tasks")}
          </button>
        </span>
        <ActionsPanel />
      </footer>
    </main>
  );
}
