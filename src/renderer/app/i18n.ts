/**
 * 内部 i18n runtime（FND-011）。
 *
 * - 双语 catalog（zh-CN / en）。
 * - `en` 为完整基 catalog（覆盖全部 MessageKey）；zh-CN spread en 并覆盖
 *   已翻译项——key 集合与英文一致，值可回退但 key 不可缺失（自动测试校验）。
 * - 缺失 key 回退英文，绝不显示 raw key；开发期 console 缺 key 报告。
 * - 语言选择存主进程 settings（AppPreferences.language），切换即时生效。
 */
import type { AppLanguage } from "../../shared/contracts";
import { useEffect, useState } from "react";
import { catalogsByLanguage, catalogKeySetsByLanguage } from "./i18n-catalogs";
import type { MessageKey } from "./i18n-keys";

export type { MessageKey } from "./i18n-keys";

/** 应用语言 Hook：初始化时从 preferences 读取，监听切换事件即时生效。 */
export function useAppLanguage(): AppLanguage {
  const [language, setLanguageState] = useState<AppLanguage>("en");

  useEffect(() => {
    let cancelled = false;
    try {
      void window.refCanvas.system
        .getPreferences()
        .then((preferences) => {
          if (!cancelled && preferences.language) {
            setLanguage(preferences.language);
            setLanguageState(preferences.language);
            document.documentElement.lang = preferences.language;
          }
        })
        .catch(() => undefined);
    } catch {
      // 测试或受限环境没有完整 preload API：保持默认。
    }
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<AppLanguage>).detail;
      if (next) {
        setLanguage(next);
        setLanguageState(next);
        document.documentElement.lang = next;
      }
    };
    window.addEventListener("refcanvas:language-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("refcanvas:language-changed", onChange);
    };
  }, []);

  return language;
}

export const APP_LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en", label: "English" },
];

type Catalog = Record<MessageKey, string>;
const CATALOGS: Record<AppLanguage, Catalog> = catalogsByLanguage;



let currentLanguage: AppLanguage = "en";

export function setLanguage(language: AppLanguage): void {
  // 防御：历史偏好可能携带已下线语言（如 zh-TW）→ 钳制回 en。
  currentLanguage = language === "zh-CN" || language === "en" ? language : "en";
}

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function translate(key: MessageKey): string {
  const catalog = CATALOGS[currentLanguage];
  const value = catalog?.[key];
  if (value !== undefined && value !== "") return value;
  // 缺失 key：回退英文；开发期报告缺 key。
  if (import.meta.env?.DEV) {
    console.warn(`[i18n] missing key "${key}" in "${currentLanguage}"`);
  }
  return CATALOGS.en[key] ?? key;
}

/** 所有语言的 key 集合（供自动 catalog 校验测试使用）。 */
export function catalogKeySets(): Record<AppLanguage, string[]> {
  return catalogKeySetsByLanguage();
}
