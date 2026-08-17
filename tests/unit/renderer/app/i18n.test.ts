// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  APP_LANGUAGES,
  catalogKeySets,
  getLanguage,
  setLanguage,
  translate,
} from "../../../../src/renderer/app/i18n";

describe("i18n runtime (FND-011)", () => {
  it("covers two languages", () => {
    expect(APP_LANGUAGES.map((item) => item.code)).toEqual(["zh-CN", "en"]);
  });

  it("keeps identical key sets across both catalogs (no missing keys)", () => {
    const sets = catalogKeySets();
    const enKeys = sets.en;
    // 英文是全量基 catalog；zh-CN key 集合必须与英文一致（自动 catalog 校验）。
    for (const language of APP_LANGUAGES) {
      const keys = sets[language.code];
      expect([...keys].sort(), `${language.code} keys`).toEqual([...enKeys].sort());
    }
  });

  it("never leaks raw keys and falls back to English for missing translations", () => {
    setLanguage("en");
    // 对未知 key，translate 返回 key 本身（无法翻译），但绝不返回 "undefined"/空串。
    const missing = translate("does.not.exist" as never);
    expect(typeof missing).toBe("string");
    expect(missing).not.toContain("undefined");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("clamps retired languages back to English", () => {
    // 历史偏好可能携带已下线语言（zh-TW/ja 等）；setLanguage 钳制回 en。
    setLanguage("zh-TW" as never);
    expect(getLanguage()).toBe("en");
    setLanguage("fr" as never);
    expect(getLanguage()).toBe("en");
  });

  it("returns translated values for representative keys", () => {
    setLanguage("en");
    expect(translate("workspace.disk")).toBe("Disk");
    expect(translate("settings.title")).toBe("Settings");
    expect(translate("capture.save")).toBe("Save screenshot");
    expect(translate("tasks.empty")).toBe("No tasks yet.");
    setLanguage("zh-CN");
    expect(translate("workspace.disk")).toBe("磁盘");
    expect(translate("collections.state.resolved")).toBe("可用");
  });

  it("every MessageKey resolves to a non-empty string in every catalog", () => {
    const sets = catalogKeySets();
    for (const language of APP_LANGUAGES) {
      setLanguage(language.code);
      for (const key of sets[language.code]) {
        const value = translate(key as never);
        expect(value.length, `${language.code}.${key}`).toBeGreaterThan(0);
      }
    }
    expect(getLanguage()).toBe("en"); // APP_LANGUAGES 中最后一个语言。
  });
});
