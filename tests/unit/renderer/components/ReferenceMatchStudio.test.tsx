// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, ReferenceMatchResult } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { ReferenceMatchStudio } from "../../../../src/renderer/components/ReferenceMatchStudio";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN"); // 断言基于简体中文 catalog。

const asset = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "shot-010",
  kind: "image",
  path: "D:\\footage\\shot-010.png",
  extension: "png",
  size: 1024,
  mtimeMs: 1,
  fingerprint: "f",
  contentHash: null,
  lifecycle: "active",
  deletedAt: null,
  trashPath: null,
  favorite: false,
  rating: 0,
  colorLabel: null,
  linkState: "linked",
  notes: "",
  width: 1920,
  height: 1080,
  duration: null,
  metadataStatus: "ready",
  metadataError: null,
  metadataUpdatedAt: null,
  bpm: null,
  customFields: {},
  customThumbnailPath: null,
  tags: [],
} as unknown as AssetRecord;

const RESULT: ReferenceMatchResult = {
  previewUrl: "refbrowse://preview/matched",
  originalUrl: "refbrowse://preview/original",
  previewPath: "C:\\cache\\match-abc-preview.png",
  lutPath: "C:\\cache\\match-abc.cube",
  width: 1600,
  height: 900,
  workspace: "rec709",
  resolveOutputCompensation: false,
  baseline: "none",
};

const flush = async () => {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe("ReferenceMatchStudio", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("explains how the panel works before a reference is chosen", async () => {
    Object.assign(window, { refCanvas: { media: {}, system: {} } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ReferenceMatchStudio sourcePath={asset.path} />));
    expect(host.textContent).toContain("拖入或选择一张参考图");
    // 没选参考图时面板仍应是一块完整的工具：有投放区和置灰的参数。
    expect(host.querySelector(".match-dropzone")).not.toBeNull();
    expect(host.querySelector(".match-controls.is-idle")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('.match-controls input[type="range"]')?.disabled).toBe(true);
  });

  it("fits the frame once a reference is picked and exposes the cube export", async () => {
    const matchAnalysis = vi.fn(async () => ({
      url: "refbrowse://preview/reference",
      width: 800,
      height: 600,
      palette: [{ hex: "#D93340", rgb: [0.85, 0.2, 0.25] as [number, number, number], coverage: 1 }],
      brightness: { p10: 0.1, median: 0.4, p90: 0.8, contrastSpan: 0.7 },
      saturation: { mean: 0.3, p90: 0.6 },
      hue: { meanDegrees: 12, family: "warm-red" as const },
    }));
    const matchCreate = vi.fn(async () => RESULT);
    const exportMatchLut = vi.fn(async () => ({ path: "E:\\luts\\shot-010-match.cube" }));
    const setPreferences = vi.fn(async (patch: { previewSettings: Record<string, unknown> }) => ({
      previewSettings: { activeLut: null, ...patch.previewSettings },
    }));
    Object.assign(window, {
      refCanvas: {
        media: { matchAnalysis, matchCreate, exportMatchLut },
        system: {
          pickFile: vi.fn(async () => ["D:\\ref\\reference.png"]),
          pickDirectory: vi.fn(async () => "E:\\luts"),
          revealInFolder: vi.fn(async () => undefined),
          setPreferences,
        },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ReferenceMatchStudio sourcePath={asset.path} />));

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".match-reference-slot")?.click();
    });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flush();

    expect(matchAnalysis).toHaveBeenCalledWith("D:\\ref\\reference.png");
    expect(matchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "D:\\footage\\shot-010.png",
        referencePath: "D:\\ref\\reference.png",
        dimension: 33,
        controls: expect.objectContaining({ matchStrength: 90, protectSkin: true }),
      }),
    );
    expect(host.querySelector(".match-palette")).not.toBeNull();
    expect(host.textContent).toContain("暖红");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".match-export")?.click();
    });
    await flush();
    expect(exportMatchLut).toHaveBeenCalledWith({
      lutPath: RESULT.lutPath,
      targetDirectory: "E:\\luts",
      baseName: "shot-010-match",
    });
    expect(host.textContent).toContain("已保存到");

    // 导出后才能一键把这张 LUT 设成当前预览 LUT。
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".match-apply")?.click();
    });
    await flush();
    expect(setPreferences).toHaveBeenCalledWith({
      previewSettings: { activeLut: "E:\\luts\\shot-010-match.cube" },
    });
    expect(host.textContent).toContain("已应用");
  });

  it("accepts an image dragged from the app's own grid", async () => {
    const matchAnalysis = vi.fn(async () => ({
      url: "refbrowse://preview/reference",
      width: 800,
      height: 600,
      palette: [],
      brightness: { p10: 0.1, median: 0.4, p90: 0.8, contrastSpan: 0.7 },
      saturation: { mean: 0.3, p90: 0.6 },
      hue: { meanDegrees: null, family: "neutral" as const },
    }));
    const matchCreate = vi.fn(async () => RESULT);
    Object.assign(window, {
      refCanvas: {
        media: { matchAnalysis, matchCreate, exportMatchLut: vi.fn() },
        system: { pickFile: vi.fn(async () => []), pickDirectory: vi.fn(async () => null) },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ReferenceMatchStudio sourcePath={asset.path} />));

    // 网格拖拽只带自定义 MIME，没有 File 对象。
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        types: ["application/x-refcanvas-directory-entry"],
        files: [],
        getData: (type: string) =>
          type === "application/x-refcanvas-directory-entry"
            ? JSON.stringify({ path: "D:\\ref\\reference.png", isDirectory: false })
            : "",
      },
    });
    await act(async () => {
      host.querySelector(".reference-match-studio")?.dispatchEvent(drop);
    });
    await flush();

    expect(matchAnalysis).toHaveBeenCalledWith("D:\\ref\\reference.png");
  });

  it("re-fits when the match strength changes", async () => {
    const matchCreate = vi.fn(async () => RESULT);
    Object.assign(window, {
      refCanvas: {
        media: {
          matchAnalysis: vi.fn(async () => ({
            url: "refbrowse://preview/reference",
            width: 800,
            height: 600,
            palette: [],
            brightness: { p10: 0.1, median: 0.4, p90: 0.8, contrastSpan: 0.7 },
            saturation: { mean: 0.3, p90: 0.6 },
            hue: { meanDegrees: null, family: "neutral" as const },
          })),
          matchCreate,
          exportMatchLut: vi.fn(),
        },
        system: { pickFile: vi.fn(async () => ["D:\\ref\\reference.png"]) },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<ReferenceMatchStudio sourcePath={asset.path} />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".match-reference-slot")?.click();
    });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flush();
    const calls = matchCreate.mock.calls.length;

    const slider = host.querySelector<HTMLInputElement>('.match-controls input[type="range"]');
    expect(slider).not.toBeNull();
    await act(async () => {
      if (!slider) return;
      // React 用自身的 value 描述符跟踪受控输入，直接赋值不会触发 onChange。
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(slider, "40");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await flush();
    expect(matchCreate.mock.calls.length).toBeGreaterThan(calls);
    expect(matchCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ controls: expect.objectContaining({ matchStrength: 40 }) }),
    );
  });
});
