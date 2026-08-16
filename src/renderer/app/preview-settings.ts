import { useEffect, useState } from "react";
import type {
  AppPreferencesPatch,
  PreviewSettings,
} from "../../shared/contracts";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../shared/contracts";

export function flattenDepthPreferencePatch(
  directoryPath: string | null,
  depth: number,
): AppPreferencesPatch {
  const previewSettings: NonNullable<AppPreferencesPatch["previewSettings"]> = {
    defaultFlattenDepth: depth,
  };
  if (directoryPath) {
    previewSettings.flattenPerFolder = { [directoryPath]: depth };
  }
  return { previewSettings };
}

/**
 * 预览高级功能设置（阶段 5）：
 * 挂载时从主进程读取一次，之后监听 `refcanvas:preview-settings` 事件即时更新。
 */
export function usePreviewSettings(): PreviewSettings {
  const [settings, setSettings] = useState<PreviewSettings>(
    PREVIEW_SETTINGS_DEFAULTS,
  );

  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.system
        .getPreferences()
        .then((preferences) => {
          if (!cancelled) setSettings(preferences.previewSettings);
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有完整 preload API：保持默认值。
    }
    const onPreviewSettings = (event: Event) => {
      const detail = (event as CustomEvent<PreviewSettings>).detail;
      if (detail) setSettings(detail);
    };
    window.addEventListener("refcanvas:preview-settings", onPreviewSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("refcanvas:preview-settings", onPreviewSettings);
    };
  }, []);

  return settings;
}

/** alphaBackground 设置 → CSS background 字符串。 */
export function alphaBackgroundStyle(settings: PreviewSettings): string {
  switch (settings.alphaBackground) {
    case "black":
      return "#000";
    case "white":
      return "#fff";
    case "custom":
      return settings.alphaCustomColor || "#404040";
    case "checker":
    default:
      return "conic-gradient(#3a3f3d 0 25%, #232725 0 50%, #3a3f3d 0 75%, #232725 0) 0 0 / 24px 24px";
  }
}
