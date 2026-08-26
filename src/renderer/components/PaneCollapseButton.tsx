import { ChevronDown, ChevronUp } from "lucide-react";
import { translate } from "../app/i18n";

/**
 * 侧栏面板标题栏共用的折叠开关。
 *
 * 提示统一交给全局 TooltipLayer（读 aria-label），不设原生 title：
 * 同屏多份相同 title 会和 TooltipLayer 气泡叠成双气泡。
 */
export function PaneCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mini-icon-button pane-collapse"
      aria-expanded={!collapsed}
      aria-label={
        collapsed ? translate("sidebar.expand") : translate("sidebar.collapse")
      }
      onClick={onToggle}
    >
      {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
    </button>
  );
}
