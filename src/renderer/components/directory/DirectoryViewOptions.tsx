import { translate } from "../../app/i18n";

/** 视图选项 popover 的 fixed 定位（面板在打开/滚动/缩放时计算）。 */
export interface DirectoryViewOptionsPosition {
  left: number;
  top: number;
  maxHeight: number;
}

interface DirectoryViewOptionsProps {
  /** 面板的菜单容器 ref：外部点击判定与滚动/缩放重定位读取。 */
  menuRef: React.Ref<HTMLDivElement>;
  position: DirectoryViewOptionsPosition | null;
  /** 当前目录 flatten 深度（每文件夹记忆 > 默认值）。 */
  flattenDepth: number;
  onFlattenDepth(depth: number): void;
  collapseImageSequences: boolean;
  onCollapseImageSequences(collapse: boolean): void;
}

/** 视图选项 popover：子目录展开深度 + 序列合并（portal 到 body 由面板负责）。 */
export function DirectoryViewOptions({
  menuRef,
  position,
  flattenDepth,
  onFlattenDepth,
  collapseImageSequences,
  onCollapseImageSequences,
}: DirectoryViewOptionsProps) {
  return (
    <div
      ref={menuRef}
      className="dir-view-options-popover"
      role="group"
      aria-label={translate("directory.viewOptions")}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position?.maxHeight ?? 280,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="dir-view-options-section">
        <span className="dir-view-options-label">
          {translate("directory.subdirectories")}
        </span>
        <div
          className="dir-view-options-depths"
          role="radiogroup"
          aria-label={translate("directory.subdirectories")}
          data-testid="directory-flatten-depth"
        >
          <label className="dir-view-option">
            <input
              type="radio"
              name="directory-flatten-depth"
              value={0}
              checked={flattenDepth === 0}
              onChange={() => onFlattenDepth(0)}
            />
            <span>{translate("directory.currentOnly")}</span>
          </label>
          {[1, 2, 3, 4, 5, 6, 7].map((depth) => (
            <label className="dir-view-option" key={depth}>
              <input
                type="radio"
                name="directory-flatten-depth"
                value={depth}
                checked={flattenDepth === depth}
                onChange={() => onFlattenDepth(depth)}
              />
              <span>
                {translate("directory.includeDepth").replace(
                  "{depth}",
                  String(depth),
                )}
              </span>
            </label>
          ))}
          <label className="dir-view-option">
            <input
              type="radio"
              name="directory-flatten-depth"
              value={8}
              checked={flattenDepth === 8}
              onChange={() => onFlattenDepth(8)}
            />
            <span>{translate("directory.includeAllDepths")}</span>
          </label>
        </div>
      </div>
      <div className="dir-view-options-divider" />
      <label className="dir-view-option">
        <input
          type="checkbox"
          data-testid="directory-sequence-toggle"
          checked={collapseImageSequences}
          onChange={(event) => onCollapseImageSequences(event.target.checked)}
        />
        <span>{translate("directory.mergeSequences")}</span>
      </label>
    </div>
  );
}
