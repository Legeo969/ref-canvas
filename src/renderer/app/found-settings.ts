import { useEffect, useState } from "react";
import type { FoundSettings } from "../../shared/contracts";
import { FOUND_SETTINGS_DEFAULTS } from "../../shared/contracts";

/**
 * Found 高级功能设置（阶段 5）：
 * 挂载时从主进程读取一次，之后监听 `refcanvas:found-settings` 事件即时更新。
 */
export function useFoundSettings(): FoundSettings {
  const [settings, setSettings] = useState<FoundSettings>(
    FOUND_SETTINGS_DEFAULTS,
  );

  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.system
        .getPreferences()
        .then((preferences) => {
          if (!cancelled) setSettings(preferences.foundSettings);
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有完整 preload API：保持默认值。
    }
    const onFoundSettings = (event: Event) => {
      const detail = (event as CustomEvent<FoundSettings>).detail;
      if (detail) setSettings(detail);
    };
    window.addEventListener("refcanvas:found-settings", onFoundSettings);
    return () => {
      cancelled = true;
      window.removeEventListener("refcanvas:found-settings", onFoundSettings);
    };
  }, []);

  return settings;
}

/** alphaBackground 设置 → CSS background 字符串。 */
export function alphaBackgroundStyle(settings: FoundSettings): string {
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
