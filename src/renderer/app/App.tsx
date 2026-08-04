import {
  Camera,
  Clipboard,
  Expand,
  FileJson,
  FolderOpen,
  ImageDown,
  MonitorPlay,
  PanelLeftClose,
  Pin,
  PinOff,
  PackageOpen,
  Settings,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  AssetRecord,
  BoardSummary,
  SimilarAsset,
  SimilarityIndexSnapshot,
} from "../../shared/contracts";
import { PANEL_DEFAULTS, panelLayoutForWindow } from "./panel-layout";
import { parseBoardWindowParams } from "./board-window";
import { useFoundSettings } from "./found-settings";
import { AssetPanel } from "../components/AssetPanel";
import { ActionsPanel } from "../components/ActionsPanel";
import { BoardCanvas } from "../components/BoardCanvas";
import { BoardWindow } from "../components/BoardWindow";
import { CaptureOverlay } from "../components/CaptureOverlay";
import { DetailsPanel } from "../components/DetailsPanel";
import { useDialog } from "../components/DialogProvider";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import {
  PanelDividers,
  applyPanelLayoutStyles,
} from "../components/PanelDividers";
import { SettingsPanel } from "../components/SettingsPanel";
import { Sidebar } from "../components/Sidebar";
import { SimilarPanel } from "../components/SimilarPanel";
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
  // 独立白板窗口（?board=<id>&mode=window）：只渲染目标白板。
  const [boardWindowParams] = useState(() =>
    parseBoardWindowParams(window.location.search),
  );
  const [captureSource, setCaptureSource] = useState<Awaited<
    ReturnType<typeof window.refCanvas.system.prepareRegionCapture>
  >>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [panelLayout, setPanelLayout] = useState(() =>
    panelLayoutForWindow(PANEL_DEFAULTS, window.innerWidth),
  );
  const [presentationMode, setPresentationModeState] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [similarSource, setSimilarSource] = useState<AssetRecord | null>(null);
  const [similarResults, setSimilarResults] = useState<SimilarAsset[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarMinScore, setSimilarMinScore] = useState(70);
  const [similarityIndex, setSimilarityIndex] =
    useState<SimilarityIndexSnapshot>({
      state: "idle",
      total: 0,
      processed: 0,
      indexed: 0,
      failed: 0,
    });

  useEffect(() => {
    if (!boardWindowParams) {
      void store.initialize();
    }
  }, [boardWindowParams]);

  useEffect(() => {
    if (boardWindowParams) return;
    void window.refCanvas.filesystem.setObservedDirectory(
      store.navigationSource === "directory" ? store.directoryPath : null,
    );
  }, [boardWindowParams, store.directoryPath, store.navigationSource]);

  useEffect(
    () => () => {
      if (!boardWindowParams) {
        void window.refCanvas.filesystem.setObservedDirectory(null);
      }
    },
    [boardWindowParams],
  );

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
    void window.refCanvas.library
      .getSimilarityIndex()
      .then(setSimilarityIndex);
    return window.refCanvas.library.onSimilarityProgress(setSimilarityIndex);
  }, []);

  useEffect(() => {
    const openDuplicates = () => setDuplicatesOpen(true);
    window.addEventListener("refcanvas:duplicates", openDuplicates);
    const unsubscribe = window.refCanvas.system.onRegionCaptureRequest(() => {
      void window.refCanvas.system.prepareRegionCapture().then(setCaptureSource);
    });
    return () => {
      window.removeEventListener("refcanvas:duplicates", openDuplicates);
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
      if (event.key === "F11") {
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
        !presentationMode
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

  if (store.loading) {
    return (
      <div className="loading-screen">
        <span className="brand-mark">R</span>
        <span>正在打开素材库…</span>
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

  const findSimilar = async (
    asset: AssetRecord,
    minScore = similarMinScore,
  ) => {
    setSimilarSource(asset);
    setSimilarLoading(true);
    try {
      const results = await window.refCanvas.library.findSimilar(asset.id, {
        limit: 200,
        minScore,
      });
      setSimilarResults(results);
      setSimilarityIndex(await window.refCanvas.library.getSimilarityIndex());
    } finally {
      setSimilarLoading(false);
    }
  };

  // 独立白板窗口：只渲染目标白板（跳过主窗口 store 初始化与工作台）。
  if (boardWindowParams) {
    return <BoardWindow boardId={boardWindowParams.boardId} />;
  }

  const uiScale = useFoundSettings().uiScale;

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
        <SettingsPanel onClose={() => setMaintenanceOpen(false)} />
      )}
      {similarSource && (
        <SimilarPanel
          source={similarSource}
          results={similarResults}
          index={similarityIndex}
          loading={similarLoading}
          minScore={similarMinScore}
          onMinScoreChange={setSimilarMinScore}
          onRefresh={() => void findSimilar(similarSource)}
          onCancelIndex={() =>
            void window.refCanvas.library.cancelSimilarityIndex()
          }
          onSelect={(asset) => {
            store.selectAsset(asset);
            setSimilarSource(null);
          }}
          onClose={() => setSimilarSource(null)}
        />
      )}
      {notice && <div className="app-toast">{notice}</div>}
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span>RefCanvas</span>
        </div>
        <div className="titlebar-actions">
          <button
            className="titlebar-button"
            onClick={async () => {
              const directory = await window.refCanvas.system.pickDirectory({
                title: "打开本地文件夹",
              });
              if (directory) await store.openDirectory(directory);
            }}
          >
            <FolderOpen size={15} />
            打开本地文件夹
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
            onClick={() => {
              if (store.activeBoard) {
                void window.refCanvas.library.collectProject(store.activeBoard.id);
              }
            }}
            aria-label="收集白板项目"
          >
            <PackageOpen size={16} />
          </button>
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
          <button
            className="icon-button"
            onClick={() => setMaintenanceOpen(true)}
            aria-label="设置"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="workspace">
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
        <AssetPanel />
        <PanelDividers
          panel="asset"
          layout={panelLayout}
          windowWidth={windowWidth}
          onCommit={(next) => {
            setPanelLayout(next);
            void store.setPreferences({ panelLayout: next });
          }}
        />
        {store.activeBoard && store.boardDocument ? (
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
          />
        ) : (
          <section className="board-panel board-unavailable">
            无法打开白板
          </section>
        )}
        <PanelDividers
          panel="details"
          layout={panelLayout}
          windowWidth={windowWidth}
          onCommit={(next) => {
            setPanelLayout(next);
            void store.setPreferences({ panelLayout: next });
          }}
        />
        <DetailsPanel
          onUpdate={store.updateAsset}
          onRelink={store.relinkAsset}
          collections={store.collections}
          onAddToCollection={store.addToCollection}
          onRemoveFromCollection={store.removeFromCollection}
          onSetTags={store.setTags}
          onFindSimilar={(asset) => void findSimilar(asset)}
        />
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
        <span>{store.importing ? "正在索引素材…" : "素材库已就绪"}</span>
        <span className="status-hint">
          方向键浏览 · Space 预览 · F 收藏 · 0–5 评分 · 素材 Alt+拖到外部
        </span>
        <ActionsPanel />
      </footer>
    </main>
  );
}
