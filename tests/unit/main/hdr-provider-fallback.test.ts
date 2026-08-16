import { describe, expect, it } from "vitest";
import {
  canUseSimpleExrsFallback,
} from "../../../src/main/providers/hdr-provider";
import type {
  ExrChannel,
  ExrDisplayLayer,
  ExrHeaderInfo,
} from "../../../src/main/services/media/exr-header";

/** Unreal MQR 多层 EXR 的典型通道集：顶层 RGBA + 7 个 AOV × 4 = 32 通道。 */
function unrealChannels(count = 32): ExrChannel[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `ch${String(index).padStart(2, "0")}`,
    pixelType: 1 as const,
    xSampling: 1,
    ySampling: 1,
  }));
}

function header(
  width: number,
  height: number,
  channels: ExrChannel[],
  overrides: Partial<ExrHeaderInfo> = {},
): ExrHeaderInfo {
  return {
    valid: true,
    error: null,
    width,
    height,
    channels,
    compression: "piz",
    bitDepth: 16,
    dataWindow: { xMin: 0, yMin: 0, xMax: width - 1, yMax: height - 1 },
    displayWindow: { xMin: 0, yMin: 0, xMax: width - 1, yMax: height - 1 },
    pixelAspectRatio: 1,
    chromaticities: null,
    lineOrder: "increasing-y",
    colorSpace: null,
    tiles: false,
    ...overrides,
  };
}

const mainLayer: ExrDisplayLayer = {
  name: "",
  channels: ["R", "G", "B", "A"],
  components: ["R", "G", "B", "A"],
};

const beautyLayer: ExrDisplayLayer = {
  name: "FinalImageMovieRenderQueue_Beauty",
  channels: [
    "FinalImageMovieRenderQueue_Beauty.R",
    "FinalImageMovieRenderQueue_Beauty.G",
    "FinalImageMovieRenderQueue_Beauty.B",
    "FinalImageMovieRenderQueue_Beauty.A",
  ],
  components: ["R", "G", "B", "A"],
};

const selection = (
  layer: ExrDisplayLayer | null,
  component: "R" | "G" | "B" | "A" | null = null,
) => ({
  subimage: 0,
  subimageCount: 1,
  layer,
  component,
});

describe("canUseSimpleExrsFallback", () => {
  it("allows the WASM fallback for a 4K multilayer EXR main layer", () => {
    // 2650×1080×32ch 的全通道像素量 91.6M 超过 64M 预算，但顶层 Beauty
    // 快速路径只解码 RGBA 4 通道（2.86M×4 = 11.4M），应放行。
    const exr = header(2650, 1080, unrealChannels(32));
    expect(canUseSimpleExrsFallback(exr, selection(mainLayer))).toBe(true);
  });

  it("keeps the full-channel budget for non-main layer selection", () => {
    // 非顶层 layer 走 decodeExr 全通道解码，预算仍按全部通道计。
    const exr = header(2650, 1080, unrealChannels(32));
    expect(canUseSimpleExrsFallback(exr, selection(beautyLayer))).toBe(false);
  });

  it("keeps the full-channel budget for an explicit channel selection", () => {
    const exr = header(2650, 1080, unrealChannels(32));
    expect(canUseSimpleExrsFallback(exr, selection(mainLayer, "R"))).toBe(false);
  });

  it("allows small files with many channels regardless of layer", () => {
    // 2×2×32 = 128 像素通道：非主 layer 也可走 WASM 兜底。
    const exr = header(2, 2, unrealChannels(32));
    expect(canUseSimpleExrsFallback(exr, selection(mainLayer))).toBe(true);
    expect(canUseSimpleExrsFallback(exr, selection(beautyLayer))).toBe(true);
  });

  it("rejects tiled and DWAA/DWAB files", () => {
    const tiled = header(2650, 1080, unrealChannels(32), { tiles: true });
    expect(canUseSimpleExrsFallback(tiled, selection(mainLayer))).toBe(false);
    const dwaa = header(2650, 1080, unrealChannels(32), { compression: "dwaa" });
    expect(canUseSimpleExrsFallback(dwaa, selection(mainLayer))).toBe(false);
    const dwab = header(2650, 1080, unrealChannels(32), { compression: "dwab" });
    expect(canUseSimpleExrsFallback(dwab, selection(mainLayer))).toBe(false);
  });

  it("rejects multi-subimage and oversized main layers", () => {
    const multi = header(2650, 1080, unrealChannels(32));
    expect(canUseSimpleExrsFallback({ ...multi }, selection(mainLayer))).toBe(true);
    // 8K 顶层 RGBA：像素量 33.2M×4 = 133M 超预算。
    const eightK = header(7680, 4320, unrealChannels(4));
    expect(canUseSimpleExrsFallback(eightK, selection(mainLayer))).toBe(false);
  });
});
