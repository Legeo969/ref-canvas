import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOK_CONTROLS,
  applyLookControls,
  scaleResidual,
  type LookControls,
} from "../../../../src/shared/match/look-controls";
import { createResidualLut } from "../../../../src/shared/match/residual-lut";

const NEUTRAL_CONTROLS: LookControls = {
  ...DEFAULT_LOOK_CONTROLS,
  protectSkin: false,
  protectSaturation: false,
  protectContrast: false,
};

function constantResidual(dimension: number, value: number) {
  const data = new Float32Array(dimension ** 3 * 3).fill(value);
  return createResidualLut(dimension, data);
}

describe("applyLookControls", () => {
  it("keeps a constant residual at full strength without safeguards", () => {
    const residual = constantResidual(3, 0.1);
    const output = applyLookControls(residual, { ...NEUTRAL_CONTROLS, matchStrength: 100 });
    expect(Array.from(output.data)).toEqual(Array.from(residual.data));
  });

  it("returns an empty volume at zero strength", () => {
    const output = applyLookControls(constantResidual(3, 0.1), { ...DEFAULT_LOOK_CONTROLS, matchStrength: 0 });
    expect(output.data.every((value) => value === 0)).toBe(true);
  });

  it("restores neutral luminance without a green cast", () => {
    const output = applyLookControls(constantResidual(3, -0.2), {
      ...DEFAULT_LOOK_CONTROLS,
      protectSkin: false,
      protectSaturation: false,
      protectContrast: true,
    });
    const offset = (1 * 9 + 1 * 3 + 1) * 3;
    const mapped = [output.data[offset], output.data[offset + 1], output.data[offset + 2]];
    expect(Math.max(...mapped) - Math.min(...mapped)).toBeLessThan(1e-6);
    // A negative residual gets part of its brightness back.
    expect(Math.max(...mapped)).toBeGreaterThan(-0.2);
  });

  it("scales the residual down with the match strength", () => {
    const residual = constantResidual(3, 0.2);
    const half = applyLookControls(residual, { ...NEUTRAL_CONTROLS, matchStrength: 50 });
    const offset = (1 * 9 + 1 * 3 + 1) * 3;
    expect(Math.abs(half.data[offset] - 0.1)).toBeLessThan(1e-6);
  });

  it("attenuates highlight residuals when the highlight weight is low", () => {
    const residual = constantResidual(3, 0.2);
    const bounded = applyLookControls(residual, {
      ...NEUTRAL_CONTROLS,
      highlights: 20,
    });
    const shadow = bounded.data[(0 * 9 + 0 * 3 + 0) * 3];
    const highlight = bounded.data[(2 * 9 + 2 * 3 + 2) * 3];
    expect(shadow).toBeGreaterThan(highlight);
  });

  it("damps skin-like colours only when skin protection is on", () => {
    const residual = constantResidual(9, 0.2);
    const skinNode = (2 * 81 + 4 * 9 + 6) * 3;
    const unprotected = applyLookControls(residual, { ...NEUTRAL_CONTROLS, matchStrength: 100 });
    const protectedRun = applyLookControls(residual, { ...DEFAULT_LOOK_CONTROLS, matchStrength: 100 });
    expect(protectedRun.data[skinNode]).toBeLessThan(unprotected.data[skinNode]);
  });

  it("rejects out-of-range controls", () => {
    expect(() => applyLookControls(constantResidual(3, 0.1), { ...DEFAULT_LOOK_CONTROLS, shadows: 120 })).toThrow(
      "LOOK_CONTROLS_OUT_OF_RANGE",
    );
  });
});

describe("scaleResidual", () => {
  it("scales every channel proportionally", () => {
    const residual = constantResidual(3, 0.4);
    const scaled = scaleResidual(residual, 0.25);
    expect(scaled.data.every((value) => Math.abs(value - 0.1) < 1e-6)).toBe(true);
  });

  it("clamps the strength to the unit range", () => {
    const residual = constantResidual(3, 0.4);
    expect(scaleResidual(residual, 4).data[0]).toBeCloseTo(0.4, 6);
    expect(scaleResidual(residual, -1).data[0]).toBe(0);
  });
});
