import {
  Copy,
  Download,
  Eye,
  Film,
  FolderOpen,
  PanelsTopLeft,
  ScanSearch,
  Scissors,
  Shrink,
  SquareArrowOutUpRight,
  Star,
  Tags,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type {
  DirectoryEntry,
  RegisteredScript,
  SequenceGroupInfo,
} from "../../../shared/contracts";
import { translate } from "../../app/i18n";

export interface DirectoryContextMenuState {
  entry: DirectoryEntry;
  x: number;
  y: number;
}

/**
 * 右键菜单格式条件：面板按当前条目扩展名与序列检测结果计算后注入。
 * Downscale 仅在 ffmpeg 可下采样的图片格式上提供；GIF/导出 MP4 对视频
 * 直接提供，图片仅在属于已检测序列（合并序列帧）时提供。
 */
export interface DirectoryContextMenuFlags {
  isDownscalableImage: boolean;
  isImage: boolean;
  /** 与 Downscale/序列判定共用分隔线，避免非图片/非视频文件出现悬空分隔线。 */
  isVideo: boolean;
  isExportableVideo: boolean;
  isSequenceImage: boolean;
  /** 目录是否已在快捷访问中（星标填充态与收藏/取消收藏文案切换）。 */
  isFavorite: boolean;
  scripts: RegisteredScript[];
}

/**
 * 右键菜单行为：全部由 DirectoryAssetPanel 注入，组件只做声明式渲染。
 * toggleQuickAccess 在异步完成后自行关闭菜单、copyOrMove 在开头自行关闭
 * 菜单——这两个按钮保持原有“不由点击处立即关闭”的语义，组件不调 onClose。
 */
export interface DirectoryContextMenuActions {
  openDirectory(path: string): void;
  openFile(path: string): void;
  reveal(path: string): void;
  addToBoard(path: string): void;
  findSimilar(path: string): void;
  openInNewTab(entry: DirectoryEntry): void;
  /** 面板实现在异步完成后自行关闭菜单（组件不调用 onClose）。 */
  toggleQuickAccess(entry: DirectoryEntry): void;
  copyPath(path: string): void;
  cutToClipboard(entry: DirectoryEntry): void;
  /** 面板实现在开头自行关闭菜单（组件不调用 onClose）。 */
  copyOrMove(entry: DirectoryEntry, kind: "copy" | "move"): void;
  moveToTrash(entry: DirectoryEntry): void;
  setTags(entry: DirectoryEntry): void;
  downscale(entry: DirectoryEntry): void;
  openGifWorkbench(
    entry: DirectoryEntry,
    sequenceGroup: SequenceGroupInfo | undefined,
  ): void;
  exportMp4(entry: DirectoryEntry): void;
  exportFrames(entry: DirectoryEntry): void;
  runScript(script: RegisteredScript, entry: DirectoryEntry): void;
}

interface DirectoryContextMenuProps {
  menu: DirectoryContextMenuState;
  /** 面板的菜单容器 ref：越界钳制的 useLayoutEffect 读取其 rect。 */
  menuRef: React.Ref<HTMLDivElement>;
  flags: DirectoryContextMenuFlags;
  /** 帧路径 → 所属序列（闭包捕获面板的 sequenceIndex.byPath）。 */
  sequenceGroupFor(path: string): SequenceGroupInfo | undefined;
  actions: DirectoryContextMenuActions;
  onClose(): void;
}

/** 目录右键菜单：文件/文件夹两态，纯展示组件（行为全部由面板注入）。 */
export function DirectoryContextMenu({
  menu,
  menuRef,
  flags,
  sequenceGroupFor,
  actions,
  onClose,
}: DirectoryContextMenuProps) {
  return (
    <>
      <div
        ref={menuRef}
        className="asset-context-menu"
        role="menu"
        style={{ left: menu.x, top: menu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menu.entry.isDirectory ? (
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              actions.openDirectory(menu.entry.path);
            }}
          >
            <FolderOpen size={16} />
            {translate("directory.openDirectory")}
          </button>
        ) : (
          <>
            <button
              role="menuitem"
              onClick={() => {
                actions.openFile(menu.entry.path);
                onClose();
              }}
            >
              <Eye size={16} />
              {translate("directory.open")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                actions.reveal(menu.entry.path);
                onClose();
              }}
            >
              <FolderOpen size={16} />
              {translate("preview.reveal")}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                actions.addToBoard(menu.entry.path);
                onClose();
              }}
            >
              <PanelsTopLeft size={16} />
              {translate("directory.addToBoard")}
            </button>
            {flags.isImage && (
              <button
                role="menuitem"
                onClick={() => {
                  onClose();
                  actions.findSimilar(menu.entry.path);
                }}
              >
                <ScanSearch size={16} />
                {translate("similar.title")}
              </button>
            )}
          </>
        )}
        <button
          role="menuitem"
          onClick={() => {
            onClose();
            actions.openInNewTab(menu.entry);
          }}
        >
          <SquareArrowOutUpRight size={16} />
          {translate("directory.newTab")}
        </button>
        {menu.entry.isDirectory && (
          <button
            role="menuitem"
            onClick={() => void actions.toggleQuickAccess(menu.entry)}
          >
            <Star
              size={16}
              fill={flags.isFavorite ? "currentColor" : "none"}
            />
            {flags.isFavorite
              ? translate("directory.unfavorite")
              : translate("directory.favoriteDir")}
          </button>
        )}
        <button
          role="menuitem"
          onClick={() => {
            actions.copyPath(menu.entry.path);
            onClose();
          }}
        >
          <Copy size={16} />
          {translate("preview.copyPath")}
        </button>
        <button
          role="menuitem"
          onClick={() => {
            actions.cutToClipboard(menu.entry);
            onClose();
          }}
        >
          <Scissors size={16} />
          {translate("directory.cut")}
        </button>
        <span className="context-menu-divider" />
        <button
          role="menuitem"
          onClick={() => void actions.copyOrMove(menu.entry, "copy")}
        >
          <Copy size={16} />
          {translate("directory.copyTo")}
        </button>
        <button
          role="menuitem"
          onClick={() => void actions.copyOrMove(menu.entry, "move")}
        >
          <FolderOpen size={16} />
          {translate("directory.moveTo")}
        </button>
        <span className="context-menu-divider" />
        <button
          role="menuitem"
          onClick={() => {
            onClose();
            void actions.moveToTrash(menu.entry);
          }}
        >
          <Trash2 size={16} />
          {translate("preview.moveToTrash")}
        </button>
        {!menu.entry.isDirectory && (
          <>
            <button
              role="menuitem"
              onClick={() => {
                onClose();
                void actions.setTags(menu.entry);
              }}
            >
              <Tags size={16} />
              {translate("preview.setTags")}
            </button>
            {(flags.isDownscalableImage || flags.isVideo || flags.isSequenceImage) && (
              <span className="context-menu-divider" />
            )}
            {flags.isDownscalableImage && (
              <button
                role="menuitem"
                onClick={() => {
                  onClose();
                  void actions.downscale(menu.entry);
                }}
              >
                <Shrink size={16} />
                {translate("directory.downscaleEllipsis")}
              </button>
            )}
            {(flags.isExportableVideo || flags.isSequenceImage) && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    const entry = menu.entry;
                    onClose();
                    // 序列图片带 sequenceGroup 选中，预览面板即以序列模式
                    // 打开 GIF 工作台；视频沿用原工作台入口。
                    actions.openGifWorkbench(entry, sequenceGroupFor(entry.path));
                  }}
                >
                  <Film size={16} />
                  {translate("directory.gifWorkbench")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    const entry = menu.entry;
                    onClose();
                    void actions.exportMp4(entry);
                  }}
                >
                  <Download size={16} />
                  {translate("directory.exportMp4")}
                </button>
                {flags.isExportableVideo && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      const entry = menu.entry;
                      onClose();
                      actions.exportFrames(entry);
                    }}
                  >
                    <Film size={16} />
                    {translate("directory.exportFrames")}
                  </button>
                )}
              </>
            )}
            {flags.scripts.length > 0 && (
              <>
                <span className="context-menu-divider" />
                <span className="context-menu-label">{translate("directory.runScript")}</span>
                {flags.scripts.map((script) => (
                  <button
                    role="menuitem"
                    key={script.id}
                    onClick={() => {
                      const entry = menu.entry;
                      onClose();
                      void actions.runScript(script, entry);
                    }}
                  >
                    <TerminalSquare size={16} />
                    {script.name}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
      <div className="context-menu-dismiss" onClick={onClose} />
    </>
  );
}
