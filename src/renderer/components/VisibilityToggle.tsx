import { Eye } from "lucide-react";
import { useState } from "react";
import { translate } from "../app/i18n";
import { usePreviewSettings } from "../app/preview-settings";

/**
 * 👁 主隐藏开关（Sidebar Navigation 设计规格）。
 *
 * 语义（已确认）：found 面板中所有隐藏项目的主隐藏开关——即
 * `previewSettings.showHiddenFiles`（设置面板「显示隐藏文件」，
 * 目录视图是否显示以 `.` 开头的文件）。
 *
 * - 点按切换偏好并广播 `refcanvas:preview-settings`（与 SettingsPanel 同一
 *   写入/广播通道，`usePreviewSettings` 订阅方即时更新）。
 * - 图标态 = 当前是否显示隐藏项：亮起（accent + 实心）表示隐藏文件可见。
 * - 三个侧栏面板标题共用同一主开关（同一偏好、同一图标态）。
 */
export function VisibilityToggle() {
  const previewSettings = usePreviewSettings();
  const showing = previewSettings.showHiddenFiles;
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      const next = await window.refCanvas.system.setPreferences({
        previewSettings: { showHiddenFiles: !showing },
      });
      window.dispatchEvent(
        new CustomEvent("refcanvas:preview-settings", {
          detail: next.previewSettings,
        }),
      );
    } catch {
      // 测试或受限环境没有完整 preload API：保持现状，不破坏侧栏。
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className={`mini-icon-button visibility-toggle ${showing ? "active" : ""}`}
      aria-pressed={showing}
      aria-label={
        showing ? translate("sidebar.hideHiddenFiles") : translate("sidebar.showHiddenFiles")
      }
      title={
        showing ? translate("sidebar.hideHiddenFiles") : translate("sidebar.showHiddenFiles")
      }
      disabled={pending}
      onClick={() => void toggle()}
    >
      <Eye size={13} fill={showing ? "currentColor" : "none"} />
    </button>
  );
}
