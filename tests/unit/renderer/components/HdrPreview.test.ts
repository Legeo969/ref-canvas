import { describe, expect, it } from "vitest";
import {
  hdrDisplayPreviewUrl,
  resolveHdrTransformSource,
} from "../../../../src/renderer/components/HdrPreview";

describe("HDR display preview source", () => {
  it("uses the high-resolution display-transform endpoint", () => {
    expect(hdrDisplayPreviewUrl("session-token")).toBe(
      "refbrowse://thumbnail/session-token?priority=preview&size=1920",
    );
  });

  it("accepts a display size for embedded sequence playback", () => {
    expect(hdrDisplayPreviewUrl("session-token", 960)).toBe(
      "refbrowse://thumbnail/session-token?priority=preview&size=960",
    );
  });
});

describe("HDR color scheme source resolution", () => {
  const source = "refbrowse://thumbnail/token?priority=preview&size=960";

  it("omits explicit transform parameters for the default sRGB scheme", () => {
    expect(resolveHdrTransformSource(source, "linear-srgb", null)).toBe(source);
  });

  it("appends input color space and display transform for ACES 1.3", () => {
    expect(resolveHdrTransformSource(source, "aces-1.3", null)).toBe(
      "refbrowse://thumbnail/token?priority=preview&size=960&inputColorSpace=ACEScg&displayTransform=aces-1.3",
    );
  });

  it("appends input color space and display transform for ACES 2.0", () => {
    expect(resolveHdrTransformSource(source, "aces-2.0", null)).toBe(
      "refbrowse://thumbnail/token?priority=preview&size=960&inputColorSpace=ACEScg&displayTransform=aces-2.0",
    );
  });

  it("appends the Raw scheme parameters", () => {
    expect(resolveHdrTransformSource(source, "raw", null)).toBe(
      "refbrowse://thumbnail/token?priority=preview&size=960&inputColorSpace=Raw&displayTransform=raw",
    );
  });

  it("treats a custom OCIO config as an explicit transform even with the default scheme", () => {
    expect(resolveHdrTransformSource(source, "linear-srgb", "D:\\ocio\\config.ocio")).toBe(
      "refbrowse://thumbnail/token?priority=preview&size=960&inputColorSpace=lin_srgb&displayTransform=linear-srgb",
    );
  });
});
