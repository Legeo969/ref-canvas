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
import type { BoardSettings, BoardSummary } from "../../shared/contracts";
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
        <span className="brand-mark">R</span>
        <span>{translate("app.loadingWorkspace")}</span>
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
    await store.openDirectory(directory);
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
      }`}
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
      {notice && <div className="app-toast">{notice}</div>}
      {startupHealth?.mode === "degraded" && (
        <div className="degraded-banner" role="alert">
          <span className="degraded-banner-icon">⚠</span>
          <span>{translate("app.degradedBanner")}</span>
        </div>
      )}
      {startupHealth?.previousCrash && startupHealth.mode !== "safe" && startupHealth.mode !== "too-new" && (
        <div className="degraded-banner previous-crash-banner" role="alert">
          <span className="degraded-banner-icon">⚠</span>
          <span>{translate("app.previousCrash")}</span>
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
                title={translate("titlebar.openBoardWindow")}
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
                title={translate("titlebar.collectProject")}
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
            aria-label={translate("titlebar.ai")}
            aria-pressed={aiPanelOpen}
            title={translate("directory.aiDesignSupervisor")}
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
            title={translate("tasks.title")}
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
