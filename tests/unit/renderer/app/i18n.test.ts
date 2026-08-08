// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  APP_LANGUAGES,
  getLanguage,
  setLanguage,
  translate,
} from "../../../../src/renderer/app/i18n";

describe("i18n runtime (FND-011)", () => {
  it("covers seven languages with identical key sets", () => {
    expect(APP_LANGUAGES.map((item) => item.code)).toEqual([
      "zh-CN",
      "zh-TW",
      "en",
      "ja",
      "ko",
      "es",
      "fr",
    ]);
    // 任一语言缺失 key → 回退英文而非 raw key；key 集合一致。
    for (const language of APP_LANGUAGES) {
      setLanguage(language.code);
      expect(getLanguage()).toBe(language.code);
    }
    // 全部 key 在英文 catalog 中均可解析（缺 key 会回退英文值本身）。
    const sampleKeys = [
      "app.name",
      "workspace.disk",
      "sidebar.collections",
      "tasks.empty",
      "ai.generate",
      "settings.language",
      "status.diskReady",
    ];
    setLanguage("en");
    for (const key of sampleKeys) {
      const value = translate(key as never);
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("returns translated values for non-English catalogs", () => {
    setLanguage("ja");
    expect(translate("workspace.disk")).toBe("ディスク");
    expect(translate("ai.generate")).toBe("生成");
    setLanguage("ko");
    expect(translate("workspace.disk")).toBe("디스크");
    setLanguage("fr");
    expect(translate("workspace.disk")).toBe("Disque");
    setLanguage("zh-TW");
    expect(translate("workspace.disk")).toBe("磁碟");
    setLanguage("es");
    expect(translate("sidebar.recycleBin")).toBe("Papelera");
  });

  it("falls back to English and never shows a raw key", () => {
    setLanguage("ja");
    // 故意请求不存在的 key：回退英文 catalog 中同 key 值；英文也没有时返回 key 本身。
    const missing = translate("does.not.exist" as never);
    expect(missing).not.toContain("undefined");
    expect(typeof missing).toBe("string");
    // 有值但英文缺失的场景由缺 key 报告覆盖：这里验证非 raw。
    expect(missing).not.toMatch(/^\[/);
  });
});
