import { describe, expect, it } from "vitest";
import { assetPreviewSize } from "../../../src/main/platform/protocols";

describe("assetPreviewSize", () => {
  it("accepts 480/960/1920 from the ?size= parameter", () => {
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?size=1920"))).toBe(1920);
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?size=960"))).toBe(960);
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?size=480"))).toBe(480);
  });

  it("returns null for missing or unsupported sizes (legacy composite)", () => {
    expect(assetPreviewSize(new URL("refasset://thumbnail/id"))).toBeNull();
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?priority=preview"))).toBeNull();
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?size=999"))).toBeNull();
    expect(assetPreviewSize(new URL("refasset://thumbnail/id?size=abc"))).toBeNull();
  });
});
