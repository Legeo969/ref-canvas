import {
  Circle as CircleIcon,
  Minus,
  Paintbrush,
  Pipette,
  Square,
  X,
} from "lucide-react";
import { useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "../../app/color-readout";
import { translate } from "../../app/i18n";
import { ColorPanel } from "../ColorPanel";
import type {
  BoardDrawingStyle,
  BoardDrawingTool,
  BoardTool,
} from "../../features/board/controllers/drawing-controller";

interface BoardDrawingPanelProps {
  tool: BoardTool;
  drawingStyle: BoardDrawingStyle;
  setTool: (tool: BoardTool) => void;
  setLastDrawingTool: (tool: BoardDrawingTool) => void;
  setDrawingStyle: (
    update: (current: BoardDrawingStyle) => BoardDrawingStyle,
  ) => void;
  onClose(): void;
}

/** 绘图设置浮层：工具/颜色/线宽/线型，状态由 BoardCanvas 持有。 */
export function BoardDrawingPanel({
  tool,
  drawingStyle,
  setTool,
  setLastDrawingTool,
  setDrawingStyle,
  onClose,
}: BoardDrawingPanelProps) {
  // 颜色用自建颜色面板，不再用原生 <input type="color">：原生控件的取色光标
  // 由 Chromium 自绘，CSS 改不了，与全局吸管视觉不一致。
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const hsv =
    hexToHsv(drawingStyle.color) ?? ({ h: 0, s: 0, v: 0 } as Hsv);
  return (
    <aside className="draw-settings-panel" aria-label={translate("board.drawingSettings")}>
      <header>
        <div>
          <strong>{translate("board.drawingTools")}</strong>
          <span>{translate("board.drawingShiftHint")}</span>
        </div>
        <button onClick={onClose} aria-label={translate("board.closeDrawingSettings")}>
          <X size={15} />
        </button>
      </header>
      <div className="draw-tool-options" role="group" aria-label={translate("board.drawingTypeGroup")}>
        {([
          ["pencil", "board.drawingToolPencil" as const, <Paintbrush size={16} />],
          ["line", "board.drawingToolLine" as const, <Minus size={17} />],
          ["rectangle", "board.drawingToolRectangle" as const, <Square size={15} />],
          ["ellipse", "board.drawingToolEllipse" as const, <CircleIcon size={15} />],
        ] as const).map(([value, labelKey, icon]) => {
          const label = translate(labelKey);
          return (
            <button
              className={tool === value ? "active" : ""}
              key={value}
              onClick={() => {
                setTool(value);
                setLastDrawingTool(value);
              }}
              aria-label={label}
            >
              {icon}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <div className="draw-style-row">
        <div className="draw-color-field">
          <span>{translate("board.drawingColor")}</span>
          <button
            type="button"
            className={`draw-color-trigger ${colorPanelOpen ? "active" : ""}`}
            aria-label={translate("board.drawingColor")}
            aria-expanded={colorPanelOpen}
            onClick={() => setColorPanelOpen((open) => !open)}
          >
            <span
              className="draw-color-swatch"
              style={{ background: drawingStyle.color }}
              aria-hidden="true"
            />
            <code>{drawingStyle.color.toUpperCase()}</code>
            <Pipette size={13} />
          </button>
          {colorPanelOpen && (
            <ColorPanel
              hsv={hsv}
              onChange={(next) =>
                setDrawingStyle((current) => ({
                  ...current,
                  color: hsvToHex(next),
                }))
              }
            />
          )}
        </div>
        <label className="draw-width-field">
          <span>{translate("board.drawingWidth")}</span>
          <input
            type="range"
            min="1"
            max="24"
            value={drawingStyle.width}
            onChange={(event) =>
              setDrawingStyle((current) => ({
                ...current,
                width: Number(event.target.value),
              }))
            }
          />
          <output>{drawingStyle.width}px</output>
        </label>
      </div>
      <div className="draw-line-options" role="group" aria-label={translate("board.drawingLineStyle")}>
        <button
          className={drawingStyle.dashed ? "" : "active"}
          onClick={() =>
            setDrawingStyle((current) => ({
              ...current,
              dashed: false,
            }))
          }
        >
          <span className="line-preview solid" />
          {translate("board.drawingSolid")}
        </button>
        <button
          className={drawingStyle.dashed ? "active" : ""}
          onClick={() =>
            setDrawingStyle((current) => ({
              ...current,
              dashed: true,
            }))
          }
        >
          <span className="line-preview dashed" />
          {translate("board.drawingDashed")}
        </button>
      </div>
    </aside>
  );
}
