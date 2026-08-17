import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../../../../src/shared/contracts";
import {
  classifyPreviewPanel,
  environmentPreviewCapabilities,
  formatPreviewTimecode,
  previewToolbarCapabilities,
  previewToolbarProgressColor,
} from "../../../../src/renderer/components/preview-panel-model";

function entry(extension: string, sequence = false): DirectoryEntry {
  return {
    path: `D:\\refs\\asset.${extension}`,
    name: `asset.${extension}`,
    extension,
    isDirectory: false,
    sequence: sequence
      ? { key: "asset", frame: 1, count: 8, startFrame: 1, endFrame: 8 }
      : undefined,
  };
}

describe("classifyPreviewPanel", () => {
  it("classifies sequence, SVG and GIF before ordinary images", () => {
    expect(classifyPreviewPanel(entry("png", true), { kind: "image", extension: "png" })).toBe("sequence");
    expect(classifyPreviewPanel(entry("svg"), { kind: "image", extension: "svg" })).toBe("svg");
    expect(classifyPreviewPanel(entry("gif"), { kind: "image", extension: "gif" })).toBe("gif");
    expect(classifyPreviewPanel(entry("png"), { kind: "image", extension: "png" })).toBe("image");
  });

  it("maps non-image asset kinds directly", () => {
    expect(classifyPreviewPanel(entry("mp4"), { kind: "video", extension: "mp4" })).toBe("video");
    expect(classifyPreviewPanel(entry("wav"), { kind: "audio", extension: "wav" })).toBe("audio");
    expect(classifyPreviewPanel(entry("pdf"), { kind: "pdf", extension: "pdf" })).toBe("pdf");
    expect(classifyPreviewPanel(entry("obj"), { kind: "model3d", extension: "obj" })).toBe("model3d");
  });

  it("classifies PSD/PSB as image previews via their flattened provider preview", () => {
    expect(classifyPreviewPanel(entry("psd"), { kind: "dcc", extension: "psd" })).toBe("image");
    expect(classifyPreviewPanel(entry("psb"), { kind: "dcc", extension: "psb" })).toBe("image");
  });
});

describe("Preview toolbar model", () => {
  it("uses blue for video and GIF and green for sequences", () => {
    expect(previewToolbarProgressColor("video")).toBe("var(--preview-accent)");
    expect(previewToolbarProgressColor("gif")).toBe("var(--preview-accent)");
    expect(previewToolbarProgressColor("sequence")).toBe("var(--preview-sequence)");
  });

  it("defines the format-specific controls", () => {
    expect(previewToolbarCapabilities("image")).toMatchObject({ upper: true, timeline: false, volume: false, gifExport: false });
    expect(previewToolbarCapabilities("svg")).toMatchObject({ upper: true, timeline: false, layers: true });
    expect(previewToolbarCapabilities("gif")).toMatchObject({ timeline: true, volume: false, gifExport: false });
    expect(previewToolbarCapabilities("video")).toMatchObject({ timeline: true, volume: true, trim: true, gifExport: true });
    expect(previewToolbarCapabilities("sequence")).toMatchObject({ timeline: true, volume: false, gifExport: true });
  });

});

describe("formatPreviewTimecode", () => {
  it("uses fixed-width hours, minutes and seconds", () => {
    expect(formatPreviewTimecode(68)).toBe("00:01:08");
    expect(formatPreviewTimecode(3661)).toBe("01:01:01");
  });

  it("adds a frame field when an FPS is supplied", () => {
    expect(formatPreviewTimecode(1.5, 24)).toBe("00:00:01:12");
  });
});

describe("environmentPreviewCapabilities", () => {
  it("allows panorama and reflection for standard 2:1 equirectangular EXR", () => {
    expect(environmentPreviewCapabilities(12288, 6144)).toEqual({ panorama: true, reflection: true });
    expect(environmentPreviewCapabilities(10000, 5000)).toEqual({ panorama: true, reflection: true });
    expect(environmentPreviewCapabilities(2048, 1024)).toEqual({ panorama: true, reflection: true });
  });

  it("allows reflection but not panorama for 1:1 HDR environment maps", () => {
    // 柔光箱等 1:1 环境贴图：PMREM 反射球可用，equirectangular 全景不适用。
    expect(environmentPreviewCapabilities(2048, 2048)).toEqual({ panorama: false, reflection: true });
  });

  it("returns null when the probe yields no usable dimensions", () => {
    expect(environmentPreviewCapabilities(null, null)).toBeNull();
    expect(environmentPreviewCapabilities(0, 0)).toBeNull();
    expect(environmentPreviewCapabilities(undefined, undefined)).toBeNull();
  });
});
