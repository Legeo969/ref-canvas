import {
  Camera,
  Expand,
  FileJson,
  FolderInput,
  HardDrive,
  ImageDown,
  MonitorPlay,
  PanelLeftClose,
  PanelsTopLeft,
  Pin,
  PinOff,
  Settings,
  SquareArrowOutUpRight,
} from "lucide-react";
import { translate } from "../app/i18n";

interface AppTitleBarProps {
  workspaceMode: "directory" | "board";
  focusMode: boolean;
  capturePreparing: boolean;
  alwaysOnTop: boolean;
  pinPending: boolean;
  onShowDirectoryWorkspace(): void;
  onShowBoardWorkspace(): void;
  onPrepareRegionCapture(): void;
  onExportPng(): void;
  onExportPackage(): void;
  onImportProject(): void;
  onOpenBoardWindow(): void;
  onToggleAlwaysOnTop(): void;
  onToggleFocusMode(): void;
  onStartPresentation(): void;
  onOpenSettings(): void;
}

/**
 * 主窗口标题栏：品牌、工作区切换与截图/导入导出/置顶/专注/演示/设置入口。
 * 纯展示组件——全部状态与动作经 props 由 App（组合根）注入。
 */
export function AppTitleBar({
  workspaceMode,
  focusMode,
  capturePreparing,
  alwaysOnTop,
  pinPending,
  onShowDirectoryWorkspace,
  onShowBoardWorkspace,
  onPrepareRegionCapture,
  onExportPng,
  onExportPackage,
  onImportProject,
  onOpenBoardWindow,
  onToggleAlwaysOnTop,
  onToggleFocusMode,
  onStartPresentation,
  onOpenSettings,
}: AppTitleBarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span>RefCanvas</span>
        </div>
        <div className="workspace-mode-switch" role="tablist" aria-label={translate("titlebar.workspace")}>
          <button
            role="tab"
            aria-selected={workspaceMode === "directory"}
            className={workspaceMode === "directory" ? "active" : ""}
            onClick={onShowDirectoryWorkspace}
          >
            <HardDrive size={14} />
            {translate("workspace.disk")}
          </button>
          <button
            role="tab"
            aria-selected={workspaceMode === "board"}
            className={workspaceMode === "board" ? "active" : ""}
            onClick={onShowBoardWorkspace}
          >
            <PanelsTopLeft size={14} />
            {translate("workspace.board")}
          </button>
        </div>
      </div>
      <div className="titlebar-actions">
        <button
          className="titlebar-button"
          onClick={onPrepareRegionCapture}
          disabled={capturePreparing}
        >
          <Camera size={15} />
          {translate("titlebar.screenshot")}
        </button>
        {workspaceMode === "board" && (
          <>
            <span className="titlebar-separator" />
            <button
              className="icon-button"
              onClick={onExportPng}
              aria-label={translate("titlebar.exportPng")}
            >
              <ImageDown size={16} />
            </button>
            <button
              className="icon-button"
              onClick={onExportPackage}
              aria-label={translate("titlebar.exportPackage")}
            >
              <FileJson size={16} />
            </button>
            <button
              className="icon-button"
              onClick={onImportProject}
              aria-label={translate("titlebar.importProject")}
            >
              <FolderInput size={16} />
            </button>
            <button
              className="icon-button"
              onClick={onOpenBoardWindow}
              aria-label={translate("titlebar.openBoardWindow")}
            >
              <SquareArrowOutUpRight size={16} />
            </button>
          </>
        )}
        <span className="titlebar-separator" />
        <button
          className={`icon-button pin-toggle${alwaysOnTop ? " active" : ""}`}
          onClick={onToggleAlwaysOnTop}
          aria-label={translate(alwaysOnTop ? "titlebar.unpin" : "titlebar.pin")}
          aria-pressed={alwaysOnTop}
          disabled={pinPending}
        >
          <span className="pin-icon-stack" aria-hidden="true">
            <Pin className="pin-icon-rest" size={16} />
            <PinOff className="pin-icon-active" size={16} />
          </span>
        </button>
        {workspaceMode === "board" && (
          <>
            <button
              className="icon-button"
              onClick={onToggleFocusMode}
              aria-label={translate("titlebar.focusBoard")}
              data-shortcut="Tab"
            >
              {focusMode ? (
                <PanelLeftClose size={16} />
              ) : (
                <Expand size={16} />
              )}
            </button>
            <button
              className="icon-button"
              onClick={onStartPresentation}
              aria-label={translate("titlebar.presentBoard")}
              data-shortcut="F11"
            >
              <MonitorPlay size={16} />
            </button>
          </>
        )}
        <button
          className="icon-button"
          onClick={onOpenSettings}
          aria-label={translate("titlebar.settings")}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
