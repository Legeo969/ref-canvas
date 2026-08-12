import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../../../../src/shared/contracts";
import {
  classifyFoundPreview,
  formatFoundTimecode,
  foundToolbarCapabilities,
  foundToolbarProgressColor,
} from "../../../../src/renderer/components/found-preview-model";

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

describe("classifyFoundPreview", () => {
  it("classifies sequence, SVG and GIF before ordinary images", () => {
    expect(classifyFoundPreview(entry("png", true), { kind: "image", extension: "png" })).toBe("sequence");
    expect(classifyFoundPreview(entry("svg"), { kind: "image", extension: "svg" })).toBe("svg");
    expect(classifyFoundPreview(entry("gif"), { kind: "image", extension: "gif" })).toBe("gif");
    expect(classifyFoundPreview(entry("png"), { kind: "image", extension: "png" })).toBe("image");
  });

  it("maps non-image asset kinds directly", () => {
    expect(classifyFoundPreview(entry("mp4"), { kind: "video", extension: "mp4" })).toBe("video");
    expect(classifyFoundPreview(entry("wav"), { kind: "audio", extension: "wav" })).toBe("audio");
    expect(classifyFoundPreview(entry("pdf"), { kind: "pdf", extension: "pdf" })).toBe("pdf");
    expect(classifyFoundPreview(entry("obj"), { kind: "model3d", extension: "obj" })).toBe("model3d");
  });
});

describe("Found toolbar model", () => {
  it("uses blue for video and GIF and green for sequences", () => {
    expect(foundToolbarProgressColor("video")).toBe("var(--found-accent)");
    expect(foundToolbarProgressColor("gif")).toBe("var(--found-accent)");
    expect(foundToolbarProgressColor("sequence")).toBe("var(--found-sequence)");
  });

  it("defines the format-specific controls", () => {
    expect(foundToolbarCapabilities("image")).toMatchObject({ upper: true, timeline: false, volume: false, gifExport: false });
    expect(foundToolbarCapabilities("svg")).toMatchObject({ upper: true, timeline: false, layers: true });
    expect(foundToolbarCapabilities("gif")).toMatchObject({ timeline: true, volume: false, gifExport: false });
    expect(foundToolbarCapabilities("video")).toMatchObject({ timeline: true, volume: true, trim: true, gifExport: true });
    expect(foundToolbarCapabilities("sequence")).toMatchObject({ timeline: true, volume: false, gifExport: true });
  });
});

describe("formatFoundTimecode", () => {
  it("uses fixed-width hours, minutes and seconds", () => {
    expect(formatFoundTimecode(68)).toBe("00:01:08");
    expect(formatFoundTimecode(3661)).toBe("01:01:01");
  });

  it("adds a frame field when an FPS is supplied", () => {
    expect(formatFoundTimecode(1.5, 24)).toBe("00:00:01:12");
  });
});
