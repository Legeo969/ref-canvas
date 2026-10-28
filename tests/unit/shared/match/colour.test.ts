import { describe, expect, it } from "vitest";
import {
  linearToRec709Gamma24,
  linearToSrgb,
  matchDomainToSrgb,
  rec709Gamma24ToLinear,
  srgbToLinear,
  srgbToMatchDomain,
} from "../../../../src/shared/match/colour";

/** 查表的精确对照：表用 4096 点线性插值，误差必须远低于 8bit 的 1/255。 */
describe("transfer lookup tables", () => {
  it("matches the exact sRGB to Rec.709 Gamma 2.4 transform", () => {
    let worst = 0;
    for (let step = 0; step <= 10_000; step += 1) {
      const value = step / 10_000;
      const exact = linearToRec709Gamma24(srgbToLinear(value));
      worst = Math.max(worst, Math.abs(srgbToMatchDomain(value) - exact));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("matches the exact inverse transform", () => {
    let worst = 0;
    for (let step = 0; step <= 10_000; step += 1) {
      const value = step / 10_000;
      const exact = linearToSrgb(rec709Gamma24ToLinear(value));
      worst = Math.max(worst, Math.abs(matchDomainToSrgb(value) - exact));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("clamps inputs outside the LUT domain", () => {
    expect(srgbToMatchDomain(-0.4)).toBe(0);
    expect(srgbToMatchDomain(2)).toBe(1);
    expect(matchDomainToSrgb(-0.4)).toBe(0);
    expect(matchDomainToSrgb(2)).toBe(1);
  });
});
