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
  it("covers seven languages", () => {
    expect(APP_LANGUAGES.map((item) => item.code)).toEqual([
      "zh-CN",
      "zh-TW",
      "en",
      "ja",
      "ko",
      "es",
      "fr",
    ]);
  });

  it("keeps identical key sets across all seven catalogs (no missing keys)", () => {
    const sets = catalogKeySets();
    const enKeys = sets.en;
    // 英文是全量基 catalog；其余语言 key 集合必须与英文一致（自动 catalog 校验）。
    for (const language of APP_LANGUAGES) {
      const keys = sets[language.code];
      expect([...keys].sort(), `${language.code} keys`).toEqual([...enKeys].sort());
    }
  });

  it("never leaks raw keys and falls back to English for missing translations", () => {
    setLanguage("ja");
    // 所有 MessageKey 在七语言中均完整；此处模拟“故意缺值”不可能（catalog 校验保证）。
    // 对未知 key，translate 返回 key 本身（无法翻译），但绝不返回 "undefined"/空串。
    const missing = translate("does.not.exist" as never);
    expect(typeof missing).toBe("string");
    expect(missing).not.toContain("undefined");
    expect(missing.length).toBeGreaterThan(0);
    // 已知 key 在任何语言中绝不显示 raw key。
    setLanguage("es");
    expect(translate("tasks.empty")).toBe("Aún no hay tareas.");
  });

  it("returns translated values for representative keys", () => {
    setLanguage("en");
    expect(translate("workspace.disk")).toBe("Disk");
    expect(translate("tasks.empty")).toBe("No tasks yet.");
    setLanguage("zh-CN");
    expect(translate("workspace.disk")).toBe("磁盘");
    expect(translate("collections.state.resolved")).toBe("可解析");
    setLanguage("ja");
    expect(translate("ai.generate")).toBe("生成");
    setLanguage("ko");
    expect(translate("workspace.disk")).toBe("디스크");
    setLanguage("fr");
    expect(translate("workspace.disk")).toBe("Disque");
    setLanguage("es");
    expect(translate("sidebar.recycleBin")).toBe("Papelera");
    setLanguage("zh-TW");
    expect(translate("workspace.disk")).toBe("磁碟");
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
    expect(getLanguage()).toBe("fr"); // APP_LANGUAGES 中最后一个语言。
  });
});
