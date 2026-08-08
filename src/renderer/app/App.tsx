import {
  Camera,
  Clipboard,
  Expand,
  FileJson,
  FolderOpen,
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
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { BoardSummary } from "../../shared/contracts";
import { PANEL_DEFAULTS, panelLayoutForWindow } from "./panel-layout";
import { parseBoardWindowParams } from "./board-window";
import { parsePreviewWindowParams } from "./preview-window";
import { useFoundSettings } from "./found-settings";
import { translate, useAppLanguage } from "./i18n";
import { ActionsPanel } from "../components/ActionsPanel";
import { AiDesignSupervisorPanel } from "../components/AiDesignSupervisor";
import { BoardCanvas } from "../components/BoardCanvas";
import { BoardWindow } from "../components/BoardWindow";
import { BrowserTabBar } from "../components/BrowserTabBar";
import { CaptureOverlay } from "../components/CaptureOverlay";
import { PreviewWindow } from "../components/PreviewWindow";
import { TaskCenter } from "../components/TaskCenter";
import { CollectionDetailsPanel } from "../components/CollectionsPanel";
import { DirectoryDetailsPanel } from "../components/DirectoryDetailsPanel";
import { DirectoryAssetPanel } from "../components/DirectoryAssetPanel";
import { useDialog } from "../components/DialogProvider";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import {
  PanelDividers,
  applyPanelLayoutStyles,
} from "../components/PanelDividers";
import { SettingsPanel } from "../components/SettingsPanel";
import { Sidebar } from "../components/Sidebar";
import { useAppStore } from "./store";

export function App() {
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
  const uiScale = useFoundSettings().uiScale;
  // FND-011：应用语言（七语言即时切换，英文回退）。
  useAppLanguage();
  // 迁移失败恢复模式（?recovery=1）：只展示恢复信息，不进入主工作区。
  const [recoveryMode] = useState(() =>
    new URLSearchParams(window.location.search).get("recovery") === "1",
  );
  const [migrationFailure, setMigrationFailure] = useState<Awaited<
    ReturnType<typeof window.refCanvas.system.getMigrationFailure>
  > | null>(null);
  // 独立白板窗口（?board=<id>&mode=window）：只渲染目标白板。
  const [boardWindowParams] = useState(() =>
    parseBoardWindowParams(window.location.search),
  );
  // 浮动预览窗口（?preview=<path>&mode=window）：只渲染单资产预览会话。
  const [previewWindowParams] = useState(() =>
    parsePreviewWindowParams(window.location.search),
  );
  const [captureSource, setCaptureSource] = useState<Awaited<
    ReturnType<typeof window.refCanvas.system.prepareRegionCapture>
  >>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "found">("general");
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [panelLayout, setPanelLayout] = useState(() =>
    panelLayoutForWindow(PANEL_DEFAULTS, window.innerWidth),
  );
  const [presentationMode, setPresentationModeState] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinPending, setPinPending] = useState(false);

  useEffect(() => {
    if (recoveryMode) {
      void window.refCanvas.system.getMigrationFailure().then(setMigrationFailure);
    }
  }, [recoveryMode]);

  useEffect(() => {
    if (boardWindowParams) return;
    if (recoveryMode) return; // 恢复模式不初始化主工作区。
    void store.initialize();
  }, [boardWindowParams, recoveryMode]);

  useEffect(() => {
    if (boardWindowParams) return;
    void window.refCanvas.filesystem.setObservedDirectory(
      store.workspaceMode === "directory" ? store.directoryPath : null,
    );
  }, [boardWindowParams, store.directoryPath, store.workspaceMode]);

  useEffect(() => {
    if (!store.preferences) return;
    setPanelLayout(applyPanelLayoutStyles(store.preferences.panelLayout, window.innerWidth));
  }, [store.preferences?.panelLayout, store.preferences]);

  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth);
      setPanelLayout((current) =>
        panelLayoutForWindow(current, window.innerWidth),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setPanelLayout((current) => panelLayoutForWindow(current, windowWidth));
  }, [windowWidth]);

  useEffect(() => {
    const openDuplicates = () => setDuplicatesOpen(true);
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<"general" | "found">).detail;
      setSettingsTab(detail === "found" ? "found" : "general");
      setMaintenanceOpen(true);
    };
    window.addEventListener("refcanvas:duplicates", openDuplicates);
    window.addEventListener("refcanvas:open-settings", openSettings);
    const unsubscribe = window.refCanvas.system.onRegionCaptureRequest(() => {
      void window.refCanvas.system.prepareRegionCapture().then(setCaptureSource);
    });
    return () => {
      window.removeEventListener("refcanvas:duplicates", openDuplicates);
      window.removeEventListener("refcanvas:open-settings", openSettings);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return window.refCanvas.system.onPresentationModeChanged(
      setPresentationModeState,
    );
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

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("refcanvas:presentation-mode", {
        detail: presentationMode,
      }),
    );
  }, [presentationMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.matches("input, textarea, select") ||
        target?.isContentEditable ||
        Boolean(target?.closest('[role="dialog"]'));
      if (event.key === "F11" && store.workspaceMode === "board") {
        event.preventDefault();
        void setPresentationMode(!presentationMode);
        return;
      }
      if (event.key === "Escape" && presentationMode) {
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
        !presentationMode &&
        store.workspaceMode === "board"
      ) {
        event.preventDefault();
        store.toggleFocusMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    presentationMode,
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
          : "操作未完成，请重试";
      setNotice(message);
      window.setTimeout(() => setNotice(null), 4200);
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  if (recoveryMode) {
    return (
      <div className="recovery-screen">
        <div className="recovery-card">
          <span className="brand-mark">R</span>
          <h1>数据库升级未完成</h1>
          <p>
            RefCanvas 升级数据库时失败，已停止在恢复页，没有改动原数据库文件。
          </p>
          <dl>
            <div>
              <dt>数据库文件</dt>
              <dd>{migrationFailure?.databasePath ?? "…"}</dd>
            </div>
            <div>
              <dt>迁移备份目录</dt>
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
              打开备份目录
            </button>
            <button className="primary-button" onClick={() => window.close()}>
              退出
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
        <span>正在打开磁盘工作区…</span>
      </div>
    );
  }

  const createBoard = async () => {
    const titles = new Set(store.boards.map((board) => board.title));
    let index = 1;
    let defaultTitle: string;
    do {
      defaultTitle = `参考板 ${String(index).padStart(2, "0")}`;
      index += 1;
    } while (titles.has(defaultTitle));
    await dialog.requestForm({
      title: "新建白板",
      description: "为新的参考白板命名，创建后会自动切换过去。",
      confirmLabel: "创建白板",
      fields: [
        {
          name: "title",
          label: "白板名称",
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
      title: "重命名白板",
      confirmLabel: "保存",
      fields: [
        {
          name: "title",
          label: "白板名称",
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
      window.confirm(`删除白板“${board.title}”？此操作不会删除素材源文件。`)
    ) {
      await store.deleteBoard(board.id);
    }
  };

  const openPickedDirectory = async (directory: string) => {
    await store.openDirectory(directory);
  };

  // 独立白板窗口：只渲染目标白板（跳过主窗口 store 初始化与工作台）。
  if (boardWindowParams) {
    return <BoardWindow boardId={boardWindowParams.boardId} />;
  }

  // 浮动预览窗口：只渲染单资产预览会话。
  if (previewWindowParams) {
    return (
      <PreviewWindow
        path={previewWindowParams.previewPath}
        onClose={() => window.close()}
      />
    );
  }

  return (
    <main
      className={`app-shell ${store.focusMode ? "focus-mode" : ""} ${
        presentationMode ? "presentation-mode" : ""
      }`}
      style={{ zoom: uiScale }}
    >
      {captureSource && (
        <CaptureOverlay
          source={captureSource}
          onComplete={async (dataUrl) => {
            await window.refCanvas.system.saveRegionCapture(dataUrl);
            setCaptureSource(null);
            await store.reloadAssets();
          }}
          onCancel={() => {
            setCaptureSource(null);
            void window.refCanvas.system.cancelRegionCapture();
          }}
        />
      )}
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
      {aiPanelOpen && (
        <AiDesignSupervisorPanel onClose={() => setAiPanelOpen(false)} />
      )}
      {taskCenterOpen && <TaskCenter onClose={() => setTaskCenterOpen(false)} />}
      {notice && <div className="app-toast">{notice}</div>}
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="brand">
            <span className="brand-mark">R</span>
            <span>RefCanvas</span>
          </div>
          <div className="workspace-mode-switch" role="tablist" aria-label="工作区">
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
                  title: "打开磁盘文件夹",
                });
                if (directory) await openPickedDirectory(directory);
              }}
            >
              <HardDrive size={14} />
              磁盘
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
              参考板
            </button>
          </div>
        </div>
        <div className="titlebar-actions">
          <button
            className="titlebar-button"
            onClick={async () => {
              const directory = await window.refCanvas.system.pickDirectory({
                title: "打开磁盘文件夹",
              });
              if (directory) await openPickedDirectory(directory);
            }}
          >
            <FolderOpen size={15} />
            打开文件夹
          </button>
          <button
            className="titlebar-button"
            onClick={async () => {
              await window.refCanvas.system.captureClipboard();
              await store.reloadAssets();
            }}
          >
            <Clipboard size={15} />
            剪贴板
          </button>
          <button
            className="titlebar-button"
            onClick={async () => {
              setCaptureSource(
                await window.refCanvas.system.prepareRegionCapture(),
              );
            }}
          >
            <Camera size={15} />
            区域
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
                aria-label="导出 JSON"
              >
                <FileJson size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() =>
                  window.dispatchEvent(new Event("refcanvas:export-png"))
                }
                aria-label="导出 PNG"
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
                aria-label="在新窗口打开白板"
                title="在新窗口打开白板"
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
                  setNotice(`参考板项目已打包到 ${destination}`);
                  window.setTimeout(() => setNotice(null), 4200);
                }}
                aria-label="打包参考板及源文件"
                title="打包参考板及源文件"
              >
                <PackageOpen size={16} />
              </button>
            </>
          )}
          <span className="titlebar-separator" />
          <button
            className={`icon-button pin-toggle${alwaysOnTop ? " active" : ""}`}
            onClick={() => void toggleAlwaysOnTop()}
            aria-label={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
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
                aria-label="专注白板"
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
                aria-label="全屏展示白板"
                data-shortcut="F11"
              >
                <MonitorPlay size={16} />
              </button>
            </>
          )}
          <button
            className={`icon-button${aiPanelOpen ? " active" : ""}`}
            onClick={() => setAiPanelOpen((value) => !value)}
            aria-label="AI 设计"
            aria-pressed={aiPanelOpen}
            title="AI Design Supervisor"
          >
            <Sparkles size={16} />
          </button>
          <button
            className="icon-button"
            onClick={() => {
              setSettingsTab("general");
              setMaintenanceOpen(true);
            }}
            aria-label="设置"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className={`workspace ${store.workspaceMode}-workspace`}>
        <Sidebar />
        <PanelDividers
          panel="sidebar"
          layout={panelLayout}
          windowWidth={windowWidth}
          onCommit={(next) => {
            setPanelLayout(next);
            void store.setPreferences({ panelLayout: next });
          }}
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
              无法打开白板
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
              layout={panelLayout}
              windowWidth={windowWidth}
              onCommit={(next) => {
                setPanelLayout(next);
                void store.setPreferences({ panelLayout: next });
              }}
            />
            <DirectoryDetailsPanel entry={store.selectedDirectoryEntry} />
          </>
        ) : (
          <>
            <div className="workspace-main-column">
              <BrowserTabBar />
              <DirectoryAssetPanel />
            </div>
            <PanelDividers
              panel="details"
              layout={panelLayout}
              windowWidth={windowWidth}
              onCommit={(next) => {
                setPanelLayout(next);
                void store.setPreferences({ panelLayout: next });
              }}
            />
            <DirectoryDetailsPanel entry={store.selectedDirectoryEntry} />
          </>
        )}
      </div>

      {presentationMode && (
        <button
          className="presentation-exit"
          onClick={() => void setPresentationMode(false)}
          aria-label="退出全屏展示"
          data-shortcut="F11 / Esc"
        >
          退出展示
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
        <span className="status-hint">
          方向键浏览 · Space 预览 · F 收藏 · 0–5 评分 · 素材 Alt+拖到外部
        </span>
        <span className="statusbar-actions">
          <button
            className={`statusbar-button ${taskCenterOpen ? "active" : ""}`}
            onClick={() => setTaskCenterOpen((value) => !value)}
            aria-label="任务中心"
            title="任务中心"
          >
            <ListTodo size={15} />
            任务
          </button>
        </span>
        <ActionsPanel />
      </footer>
    </main>
  );
}
