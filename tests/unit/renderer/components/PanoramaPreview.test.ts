import { describe, expect, it } from "vitest";
import {
  canRenderEnvironmentPreview,
  createEnvironmentTexture,
  environmentFallbackKind,
  environmentPreviewInteraction,
  resolveEnvironmentPreviewMode,
} from "../../../../src/renderer/components/PanoramaPreview";

describe("environment preview mode", () => {
  it("uses the forced panorama mode for both presentation and renderer startup", () => {
    expect(resolveEnvironmentPreviewMode("panorama", "flat")).toBe("panorama");
  });

  it("supports a dedicated reflection-ball mode", () => {
    expect(resolveEnvironmentPreviewMode("reflection", "flat")).toBe("reflection");
  });

  it("allows toolbar-forced environment modes for HDR images that are not 2:1", () => {
    expect(canRenderEnvironmentPreview("reflection", false)).toBe(true);
    expect(canRenderEnvironmentPreview("panorama", false)).toBe(true);
    expect(canRenderEnvironmentPreview(undefined, false)).toBe(false);
    expect(canRenderEnvironmentPreview(undefined, true)).toBe(true);
  });

  it("reuses the already loaded protocol image as the WebGL texture source", () => {
    const image = {} as HTMLImageElement;
    const texture = createEnvironmentTexture(image);
    expect(texture.image).toBe(image);
    expect(texture.version).toBeGreaterThan(0);
  });

  it("keeps a visible media fallback under every environment renderer", () => {
    expect(environmentFallbackKind("reflection")).toBe("reflection-ball");
    expect(environmentFallbackKind("panorama")).toBe("equirectangular");
    expect(environmentFallbackKind("flat")).toBe("flat");
  });

  it("keeps panorama draggable while locking dolly movement at the sphere center", () => {
    expect(environmentPreviewInteraction("panorama")).toEqual({ rotate: true, zoom: false });
    expect(environmentPreviewInteraction("reflection")).toEqual({ rotate: true, zoom: true });
    expect(environmentPreviewInteraction("flat")).toEqual({ rotate: false, zoom: false });
  });
});
