import { translate } from "../../app/i18n";
import type { DirectorySortMode } from "../DirectoryAssetPanel";

/** 排序菜单 popover 的 fixed 定位（面板在打开/滚动/缩放时计算）。 */
export interface DirectorySortMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface DirectorySortMenuProps {
  /** 面板的菜单容器 ref：外部点击判定与滚动/缩放重定位读取。 */
  menuRef: React.Ref<HTMLDivElement>;
  position: DirectorySortMenuPosition | null;
  sortMode: DirectorySortMode;
  onSelect(mode: DirectorySortMode): void;
  onClose(): void;
}

/** 排序菜单 popover：名称/修改时间/大小三选一（portal 到 body 由面板负责）。 */
export function DirectorySortMenu({
  menuRef,
  position,
  sortMode,
  onSelect,
  onClose,
}: DirectorySortMenuProps) {
  return (
    <div
      ref={menuRef}
      className="dir-sort-popover"
      role="menu"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position?.maxHeight ?? 220,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {(["name", "mtime", "size"] as const).map((mode) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={sortMode === mode}
          className={`dir-sort-option ${sortMode === mode ? "active" : ""}`}
          key={mode}
          data-testid={`directory-sort-${mode}`}
          onClick={() => {
            onSelect(mode);
            onClose();
          }}
        >
          {mode === "mtime"
            ? translate("directory.sortModified")
            : mode === "size"
              ? translate("directory.sortSize")
              : translate("directory.sortName")}
        </button>
      ))}
    </div>
  );
}
