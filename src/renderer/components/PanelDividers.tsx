import { useEffect, useRef } from "react";
import {
  PANEL_CSS_VARIABLES,
  PANEL_DEFAULTS,
  adjustPanelWidth,
  expandedWidths,
  normalizePanelLayout,
  panelLayoutForWindow,
  panelResizeDelta,
  withCollapsed,
  type PanelId,
  type PanelLayout,
} from "../app/panel-layout";
import { translate } from "../app/i18n";

const KEYBOARD_STEP = 8;
const KEYBOARD_STEP_FAST = 32;

function applyWidthVariables(layout: PanelLayout): void {
  const widths = expandedWidths(layout);
  for (const panel of Object.keys(PANEL_CSS_VARIABLES) as PanelId[]) {
    document.documentElement.style.setProperty(
      PANEL_CSS_VARIABLES[panel],
      `${widths[panel]}px`,
    );
  }
}

interface PanelDividersProps {
  panel: PanelId;
  activePanels?: readonly PanelId[];
  /** 已含窗口收缩保护的渲染布局。 */
  layout: PanelLayout;
  windowWidth: number;
  onCommit(next: PanelLayout): void;
}

/**
 * 工作区面板之间的可拖分隔线。拖动期间直写 CSS 变量，不触发 React
 * render；松开后才提交持久化。双击折叠/恢复，键盘方向键微调。
 */
export function PanelDividers({
  panel,
  activePanels,
  layout,
  windowWidth,
  onCommit,
}: PanelDividersProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    panel: PanelId;
    startX: number;
  } | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    applyWidthVariables(layout);
  }, [layout]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { panel, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("dragging");
    document.body.classList.add("panel-resizing");
    event.preventDefault();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = panelResizeDelta(
      drag.panel,
      event.clientX - drag.startX,
    );
    const next = adjustPanelWidth(
      layoutRef.current,
      drag.panel,
      delta,
      windowWidth,
      activePanels,
    );
    applyWidthVariables(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = panelResizeDelta(
      drag.panel,
      event.clientX - drag.startX,
    );
    dragRef.current = null;
    event.currentTarget.classList.remove("dragging");
    document.body.classList.remove("panel-resizing");
    onCommit(
      adjustPanelWidth(
        layoutRef.current,
        drag.panel,
        delta,
        windowWidth,
        activePanels,
      ),
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const physicalDelta =
      (event.key === "ArrowRight" ? 1 : -1) *
      (event.shiftKey ? KEYBOARD_STEP_FAST : KEYBOARD_STEP);
    const delta = panelResizeDelta(panel, physicalDelta);
    onCommit(
      adjustPanelWidth(
        layoutRef.current,
        panel,
        delta,
        windowWidth,
        activePanels,
      ),
    );
  };

  const handleDoubleClick = () => {
    const collapsed = layoutRef.current.collapsed.includes(panel);
    onCommit(withCollapsed(layoutRef.current, panel, !collapsed));
  };

  return (
    <div
      ref={elementRef}
      className="panel-divider"
      role="separator"
      aria-label={translate("workspace.adjustPanelWidth").replace(
        "{panel}",
        translate(
          panel === "sidebar"
            ? "workspace.panelSidebar"
            : panel === "asset"
              ? "workspace.panelAsset"
              : "workspace.panelDetails",
        ),
      )}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={50}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
    />
  );
}

/**
 * 把偏好布局应用到 CSS 变量（供 App 在初始化与窗口尺寸变化时调用，
 * 与 PanelDividers 内部逻辑保持同一数据源）。
 */
export function applyPanelLayoutStyles(
  panelLayout: unknown,
  windowWidth: number,
  activePanels?: readonly PanelId[],
): PanelLayout {
  const base = normalizePanelLayout(panelLayout ?? PANEL_DEFAULTS);
  const effective = panelLayoutForWindow(base, windowWidth, activePanels);
  applyWidthVariables(effective);
  return effective;
}
