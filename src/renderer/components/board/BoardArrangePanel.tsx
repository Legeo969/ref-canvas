import { X } from "lucide-react";
import { useState } from "react";
import { translate } from "../../app/i18n";
import type { ArrangeKey } from "../../app/board-arrange";
import { SelectMenu, type SelectMenuOption } from "../SelectMenu";

export interface BoardArrangeSettings {
  key: ArrangeKey;
  gap: number;
  align: "left" | "center" | "right";
  reverse: boolean;
}

interface BoardArrangePanelProps {
  open: boolean;
  onClose(): void;
  onApply(options: BoardArrangeSettings): void;
}

const ALIGN_SEGMENTS = [
  ["left", "board.alignLeft"],
  ["center", "board.alignCenterX"],
  ["right", "board.alignRight"],
] as const;

/** 排列设置浮层：排序方式/间距/对齐/倒序，状态由本组件持有，应用后关闭。 */
export function BoardArrangePanel({
  open,
  onClose,
  onApply,
}: BoardArrangePanelProps) {
  const [sortKey, setSortKey] = useState<ArrangeKey>("name");
  const [gap, setGap] = useState(20);
  const [align, setAlign] = useState<BoardArrangeSettings["align"]>("left");
  const [reverse, setReverse] = useState(false);
  if (!open) return null;
  const sortOptions: readonly SelectMenuOption<ArrangeKey>[] = [
    { value: "name", label: translate("board.arrangeByName") },
    { value: "added", label: translate("board.arrangeByAdded") },
    { value: "layer", label: translate("board.arrangeByLayer") },
    { value: "path", label: translate("board.arrangeByPath") },
    { value: "random", label: translate("board.arrangeRandom") },
    { value: "stack", label: translate("board.arrangeStack") },
  ];
  return (
    <aside
      className="arrange-settings-panel"
      aria-label={translate("board.arrangeSettings")}
    >
      <header>
        <div>
          <strong>{translate("board.arrangeSettings")}</strong>
        </div>
        <button
          onClick={onClose}
          aria-label={translate("board.closeArrangeSettings")}
        >
          <X size={15} />
        </button>
      </header>
      <label className="arrange-sort-field">
        <span>{translate("board.arrangeSortKey")}</span>
        <SelectMenu<ArrangeKey>
          value={sortKey}
          options={sortOptions}
          onValueChange={setSortKey}
          ariaLabel={translate("board.arrangeSortKey")}
        />
      </label>
      <label className="arrange-gap-field">
        <span>{translate("board.arrangeGap")}</span>
        <input
          type="number"
          min={0}
          max={200}
          value={gap}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            setGap(Number.isFinite(next) ? Math.min(200, Math.max(0, next)) : 0);
          }}
        />
      </label>
      <div
        className="arrange-align-options"
        role="group"
        aria-label={translate("board.groupArrange")}
      >
        {ALIGN_SEGMENTS.map(([value, labelKey]) => (
          <button
            className={align === value ? "active" : ""}
            key={value}
            onClick={() => setAlign(value)}
          >
            {translate(labelKey)}
          </button>
        ))}
      </div>
      <label className="arrange-reverse-option">
        <input
          type="checkbox"
          checked={reverse}
          onChange={(event) => setReverse(event.target.checked)}
        />
        <span>{translate("board.arrangeReverse")}</span>
      </label>
      <button
        className="arrange-apply"
        onClick={() => {
          onApply({ key: sortKey, gap, align, reverse });
          onClose();
        }}
      >
        {translate("board.arrangeApply")}
      </button>
    </aside>
  );
}
