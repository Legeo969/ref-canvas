import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export interface BoardDockPanel {
  /** 稳定标识：用于记住每个面板的折叠状态。 */
  readonly id: string;
  /** 是否折叠成只留标题条。 */
  readonly collapsed: boolean;
  readonly title: string;
  readonly children: ReactNode;
}

interface BoardSideDockProps {
  /** 顶部起点（由工具栏实际高度下发）。 */
  readonly top: number;
  /** 右侧停靠列里的面板，自上而下排列，永不自相重叠。 */
  readonly panels: readonly BoardDockPanel[];
  readonly onToggleCollapsed: (id: string) => void;
  readonly onClose: (id: string) => void;
}

/**
 * 右侧停靠列：白板的图层面板、检查器、取色结果都排进这一列。
 *
 * 旧做法是每张卡片各自 `position:absolute; top:64px; right:12px`，
 * 再靠父组件测量"上一个有多高"手动往下推——漏掉任何一个面板就会重叠
 * （取色结果就是这样压在图层列表上的）。改成普通文档流纵向堆叠后，
 * 重叠在结构上不可能发生，也不需要任何高度测量。
 *
 * 列本身可纵向滚动、可在空白处拖动整体位置：面板多到超过画布高度时
 * 不会互相挤压，也不会被裁掉。
 */
export function BoardSideDock({
  top,
  panels,
  onToggleCollapsed,
  onClose,
}: BoardSideDockProps) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      // 只从列的空白边距起拖：点在面板内部时不抢交互。
      if (event.target !== event.currentTarget) return;
      if (event.button !== 0) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: dragOffset.x,
        originY: dragOffset.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dragOffset.x, dragOffset.y],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDragOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      });
    },
    [],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // 面板全部关闭后把位移复位，下一次打开从默认位置开始。
  useEffect(() => {
    if (panels.length === 0) setDragOffset({ x: 0, y: 0 });
  }, [panels.length]);

  if (panels.length === 0) return null;

  return (
    <div
      className="board-side-dock"
      style={{ top, translate: `${dragOffset.x}px ${dragOffset.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="group"
      aria-label="Board panels"
    >
      {panels.map((panel) => (
        <section
          key={panel.id}
          className={`board-side-dock-panel${panel.collapsed ? " collapsed" : ""}`}
          data-panel={panel.id}
        >
          <header
            className="board-side-dock-header"
            onClick={() => onToggleCollapsed(panel.id)}
          >
            <button
              type="button"
              className="board-side-dock-toggle"
              aria-label={panel.title}
              aria-expanded={!panel.collapsed}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapsed(panel.id);
              }}
            >
              <span aria-hidden="true">{panel.collapsed ? "▸" : "▾"}</span>
              <strong>{panel.title}</strong>
            </button>
            <button
              type="button"
              className="board-side-dock-close"
              aria-label={panel.title}
              onClick={(event) => {
                event.stopPropagation();
                onClose(panel.id);
              }}
            >
              ×
            </button>
          </header>
          {!panel.collapsed && (
            <div className="board-side-dock-body">{panel.children}</div>
          )}
        </section>
      ))}
    </div>
  );
}
