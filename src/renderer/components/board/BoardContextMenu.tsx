import {
  AlignCenterVertical,
  AlignStartVertical,
  Clipboard as ClipboardIcon,
  CopyPlus,
  Crop,
  FolderOpen,
  Grid3X3,
  Group as GroupIcon,
  LayoutGrid,
  Link2,
  Lock,
  Maximize,
  Palette,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Search,
  Trash2,
} from "lucide-react";
import { translate } from "../../app/i18n";

export interface BoardContextMenuState {
  x: number;
  y: number;
  kind: "object" | "multi" | "image" | "empty";
  target?: {
    id: string;
    isImage: boolean;
    assetId: string | null;
    hasGif: boolean;
    gifPlaying: boolean;
  };
}

/** 右键菜单行为：全部由 BoardCanvas 注入，组件只做声明式渲染。 */
export interface BoardContextMenuActions {
  align(mode: "left" | "centerX"): void;
  distribute(axis: "x" | "y"): void;
  arrangeCompact(): void;
  normalizeWidth(): void;
  group(): void;
  focus(id: string): void;
  crop(id: string): void;
  setOpacity(): void;
  toggleLock(): void;
  duplicate(): void;
  remove(): void;
  toggleGrayscale(): void;
  toggleGif(id: string): void;
  toggleSampling(): void;
  locate(id: string): void;
  relink(id: string): void;
  paste(): void;
  fitAll(): void;
  toggleGrid(): void;
  editAppearance(): void;
  openCommandPalette(): void;
}

interface BoardContextMenuProps {
  menu: BoardContextMenuState;
  /** 资产定位入口是否可用（事件绑定中存在 onLocateAsset）。 */
  locateEnabled: boolean;
  gridVisible: boolean;
  actions: BoardContextMenuActions;
  onClose(): void;
}

/** 画板右键菜单：对象/多选/图片/空白四态，纯展示组件（fabric 无关）。 */
export function BoardContextMenu({
  menu,
  locateEnabled,
  gridVisible,
  actions,
  onClose,
}: BoardContextMenuProps) {
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <>
      <div
        className="asset-context-menu board-context-menu"
        role="menu"
        style={{ left: menu.x, top: menu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menu.kind === "multi" && (
          <>
            <button role="menuitem" onClick={() => run(() => actions.align("left"))}>
              <AlignStartVertical size={16} />
              {translate("board.alignLeft")}
            </button>
            <button role="menuitem" onClick={() => run(() => actions.align("centerX"))}>
              <AlignCenterVertical size={16} />
              {translate("board.alignCenterX")}
            </button>
            <button role="menuitem" onClick={() => run(() => actions.distribute("x"))}>
              <LayoutGrid size={16} />
              {translate("board.distributeX")}
            </button>
            <button role="menuitem" onClick={() => run(() => actions.distribute("y"))}>
              <LayoutGrid size={16} />
              {translate("board.distributeY")}
            </button>
            <button role="menuitem" onClick={() => run(actions.arrangeCompact)}>
              <LayoutGrid size={16} />
              {translate("board.arrangeCompact")}
            </button>
            <button role="menuitem" onClick={() => run(actions.normalizeWidth)}>
              <RotateCcw size={16} />
              {translate("board.normalizeWidth")}
            </button>
            <button role="menuitem" onClick={() => run(actions.group)}>
              <GroupIcon size={16} />
              {translate("board.group")}
            </button>
          </>
        )}
        {menu.kind === "object" && menu.target && (
          <>
            <button role="menuitem" onClick={() => run(() => actions.focus(menu.target!.id))}>
              <ScanSearch size={16} />
              {translate("board.focus")}
            </button>
            <button role="menuitem" onClick={() => run(() => actions.crop(menu.target!.id))}>
              <Crop size={16} />
              {translate("board.crop")}
            </button>
            <button role="menuitem" onClick={() => run(actions.setOpacity)}>
              <span className="text-tool-icon">%</span>
              {translate("board.opacity")}
            </button>
            <button role="menuitem" onClick={() => run(actions.toggleLock)}>
              <Lock size={16} />
              {translate("board.lockUnlock")}
            </button>
            <button role="menuitem" onClick={() => run(actions.duplicate)}>
              <CopyPlus size={16} />
              {translate("board.duplicate")}
            </button>
            <div className="folder-menu-separator" />
            <button className="danger" role="menuitem" onClick={() => run(actions.remove)}>
              <Trash2 size={16} />
              {translate("board.delete")}
            </button>
          </>
        )}
        {menu.kind === "image" && menu.target && (
          <>
            <button role="menuitem" onClick={() => run(() => actions.focus(menu.target!.id))}>
              <ScanSearch size={16} />
              {translate("board.focus")}
            </button>
            <button role="menuitem" onClick={() => run(() => actions.crop(menu.target!.id))}>
              <Crop size={16} />
              {translate("board.crop")}
            </button>
            <button role="menuitem" onClick={() => run(actions.toggleGrayscale)}>
              <span className="text-tool-icon">B/W</span>
              {translate("board.toggleGrayscaleShort")}
            </button>
            {menu.target.hasGif && (
              <button role="menuitem" onClick={() => run(() => actions.toggleGif(menu.target!.id))}>
                {menu.target.gifPlaying ? <Pause size={16} /> : <Play size={16} />}
                {menu.target.gifPlaying
                  ? translate("board.gifPause")
                  : translate("board.gifPlay")}
              </button>
            )}
            <button role="menuitem" onClick={() => run(actions.toggleSampling)}>
              <span className="text-tool-icon">NN</span>
              {translate("board.toggleSampling")}
            </button>
            {locateEnabled && menu.target.assetId && (
              <button role="menuitem" onClick={() => run(() => actions.locate(menu.target!.assetId!))}>
                <FolderOpen size={16} />
                {translate("board.locateInIndex")}
              </button>
            )}
            <button role="menuitem" onClick={() => run(() => actions.relink(menu.target!.id))}>
              <Link2 size={16} />
              {translate("board.relink")}
            </button>
            <div className="folder-menu-separator" />
            <button className="danger" role="menuitem" onClick={() => run(actions.remove)}>
              <Trash2 size={16} />
              {translate("board.delete")}
            </button>
          </>
        )}
        {menu.kind === "empty" && (
          <>
            <button role="menuitem" onClick={() => run(actions.paste)}>
              <ClipboardIcon size={16} />
              {translate("board.paste")}
            </button>
            <button role="menuitem" onClick={() => run(actions.fitAll)}>
              <Maximize size={16} />
              {translate("board.fitAll")}
            </button>
            <button role="menuitem" onClick={() => run(actions.toggleGrid)}>
              <Grid3X3 size={16} />
              {gridVisible ? translate("board.hideGrid") : translate("board.showGrid")}
            </button>
            <button role="menuitem" onClick={actions.editAppearance}>
              <Palette size={16} />
              {translate("board.appearanceTitle")}
            </button>
            <div className="folder-menu-separator" />
            <button role="menuitem" onClick={actions.openCommandPalette}>
              <Search size={16} />
              {translate("board.commandPaletteTitle")}
            </button>
          </>
        )}
      </div>
      <div className="context-menu-dismiss" onClick={onClose} />
    </>
  );
}
