import { useEffect, useState } from "react";
import type { BoardAppearance } from "../../../shared/contracts";
import { hexToHsv, hsvToHex, type Hsv } from "../../app/color-readout";
import { translate } from "../../app/i18n";
import { ColorPanel } from "../ColorPanel";

interface BoardAppearancePanelProps {
  appearance: BoardAppearance;
  /** 面板内的改动实时预览，不改变持久化语义。 */
  onPreview(backgroundColor: string): void;
  onCancel(): void;
  onApply(next: { backgroundColor: string; gridSize: number }): void;
}

const MIN_GRID = 8;
const MAX_GRID = 96;
const HEX_PATTERN = /^#?[0-9a-f]{6}$/i;

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/**
 * 白板背景与网格设置：背景色用颜色面板选，hex 仍可手输（贴合
 * "取到色值直接粘贴"的实际用法）。网格大小用滑杆 + 数值双通道。
 */
export function BoardAppearancePanel({
  appearance,
  onPreview,
  onCancel,
  onApply,
}: BoardAppearancePanelProps) {
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(appearance.backgroundColor) ?? { h: 0, s: 0, v: 0.15 },
  );
  const [hexDraft, setHexDraft] = useState(appearance.backgroundColor);
  const [gridSize, setGridSize] = useState(appearance.gridSize);

  const hex = hsvToHex(hsv);
  const hexValid = HEX_PATTERN.test(hexDraft);

  useEffect(() => {
    onPreview(hex);
  }, [hex, onPreview]);

  const commitHex = (value: string) => {
    const next = hexToHsv(normalizeHex(value));
    if (!next) return;
    setHsv(next);
  };

  return (
    // 内容体：外框、标题、折叠、关闭由 BoardSideDock 提供。
    <div className="board-appearance-body">
      <ColorPanel
        hsv={hsv}
        onChange={(next) => {
          setHsv(next);
          setHexDraft(hsvToHex(next));
        }}
      >
        <label className="board-appearance-hex">
          <span>{translate("board.appearanceBackgroundLabel")}</span>
          <input
            value={hexDraft}
            spellCheck={false}
            maxLength={7}
            aria-invalid={hexValid ? undefined : true}
            aria-label={translate("board.appearanceBackgroundLabel")}
            onChange={(event) => {
              setHexDraft(event.target.value);
              commitHex(event.target.value);
            }}
            onBlur={() => setHexDraft(hex)}
          />
          <span
            className="board-appearance-hex-swatch"
            style={{ background: hexValid ? hex : "transparent" }}
            aria-hidden="true"
          />
        </label>
        <label className="board-appearance-grid">
          <span>
            {translate("board.appearanceGridLabel")}
            <output>{gridSize}px</output>
          </span>
          <input
            type="range"
            min={MIN_GRID}
            max={MAX_GRID}
            step={2}
            value={gridSize}
            aria-label={translate("board.appearanceGridLabel")}
            onChange={(event) => setGridSize(Number(event.target.value))}
          />
        </label>
      </ColorPanel>
      {!hexValid && (
        <p className="board-appearance-error" role="alert">
          {translate("board.appearanceHexError")}
        </p>
      )}
      <footer>
        <button type="button" className="board-appearance-cancel" onClick={onCancel}>
          {translate("board.cancel")}
        </button>
        <button
          type="button"
          className="board-appearance-apply"
          disabled={!hexValid}
          onClick={() => onApply({ backgroundColor: hex, gridSize })}
        >
          {translate("board.apply")}
        </button>
      </footer>
    </div>
  );
}
