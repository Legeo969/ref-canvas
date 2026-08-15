import { describe, expect, it } from "vitest";
import { hdrColorVariant } from "../../../src/main/platform/protocols";

describe("hdrColorVariant", () => {
  it("versions color-managed variants so stale caches regenerate", () => {
    expect(hdrColorVariant(new URL("refbrowse://thumbnail/token?priority=preview&size=1920&inputColorSpace=ACEScg&displayTransform=aces-2.0"))).toBe(
      "-display-aces-2.0-input-acescg-v1",
    );
  });

  it("includes the custom OCIO signature", () => {
    expect(hdrColorVariant(new URL("refbrowse://thumbnail/token?priority=preview&size=1920&inputColorSpace=lin_srgb&displayTransform=linear-srgb&ocio=abc123"))).toContain(
      "-ocio-abc123-v1",
    );
  });

  it("stays empty for the default path so base cache variants are shared", () => {
    expect(hdrColorVariant(new URL("refbrowse://thumbnail/token?priority=preview&size=1920"))).toBe("");
  });

  it("ignores unknown display transform values", () => {
    expect(hdrColorVariant(new URL("refbrowse://thumbnail/token?displayTransform=filmic&inputColorSpace=ACEScg"))).toBe(
      "-input-acescg-v1",
    );
  });
});
