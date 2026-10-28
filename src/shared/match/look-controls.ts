/**
 * Global LUT-domain look controls: match strength, tonal-zone weights and
 * conservative safeguards.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match).
 *
 * These operate on the 3D LUT, not on image regions: a `.cube` cannot carry a
 * subject mask, so "skin protection" is a colour-domain guardrail rather than
 * face segmentation.
 */

import { clamp01, luminance, smoothstep } from "./colour";
import type { ResidualLut } from "./residual-lut";

export interface LookControls {
  /** 0–100; 100 keeps the fitted residual unchanged. */
  matchStrength: number;
  /** 0–100 zone weights for shadows, midtones and highlights. */
  shadows: number;
  midtones: number;
  highlights: number;
  protectSkin: boolean;
  protectSaturation: boolean;
  protectContrast: boolean;
}

export const DEFAULT_LOOK_CONTROLS: LookControls = {
  matchStrength: 90,
  shadows: 100,
  midtones: 100,
  highlights: 100,
  protectSkin: true,
  protectSaturation: true,
  protectContrast: true,
};

const PERCENT = 100;
const SKIN_RESTORE = 0.7;
const SATURATION_RESTORE = 0.55;
const CONTRAST_RESTORE = 0.65;

function validate(controls: LookControls): void {
  for (const value of [
    controls.matchStrength,
    controls.shadows,
    controls.midtones,
    controls.highlights,
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > PERCENT) {
      throw new Error("LOOK_CONTROLS_OUT_OF_RANGE");
    }
  }
}

function toneZoneStrength(red: number, green: number, blue: number, controls: LookControls): number {
  const luma = luminance(red, green, blue);
  const shadowMask = 1 - smoothstep(0.18, 0.48, luma);
  const highlightMask = smoothstep(0.52, 0.82, luma);
  const midtoneMask = 1 - shadowMask - highlightMask;
  return (
    (shadowMask * controls.shadows) / PERCENT +
    (midtoneMask * controls.midtones) / PERCENT +
    (highlightMask * controls.highlights) / PERCENT
  );
}

/**
 * Apply strength, zonal weights and safeguards to a fitted residual volume.
 *
 * Returns a new volume; the input is left untouched.
 */
export function applyLookControls(residualLut: ResidualLut, controls: LookControls): ResidualLut {
  validate(controls);
  const { dimension, data } = residualLut;
  const denominator = dimension - 1;
  const plane = dimension * dimension;
  const output = new Float32Array(data.length);
  const strength = controls.matchStrength / PERCENT;
  if (strength === 0) return { dimension, data: output };
  // RGB-domain envelope. A `.cube` can recognise a colour region, not a person.
  for (let blue = 0; blue < dimension; blue += 1) {
    const blueValue = blue / denominator;
    for (let green = 0; green < dimension; green += 1) {
      const greenValue = green / denominator;
      for (let red = 0; red < dimension; red += 1) {
        const offset = (plane * blue + green * dimension + red) * 3;
        const redValue = red / denominator;
        const luma = luminance(redValue, greenValue, blueValue);
        const chroma = Math.max(redValue, greenValue, blueValue) - Math.min(redValue, greenValue, blueValue);
        let guard = strength * toneZoneStrength(redValue, greenValue, blueValue, controls);
        if (controls.protectSkin) {
          const isSkin =
            redValue > 0.35 &&
            greenValue > 0.18 &&
            blueValue > 0.08 &&
            redValue > greenValue &&
            greenValue > blueValue &&
            chroma > 0.08 &&
            chroma < 0.62 &&
            luma > 0.1 &&
            luma < 0.92;
          if (isSkin) guard *= 1 - SKIN_RESTORE;
        }
        if (controls.protectSaturation) {
          guard *= 1 - SATURATION_RESTORE * smoothstep(0.42, 0.9, chroma);
        }
        let redDelta = data[offset] * guard;
        let greenDelta = data[offset + 1] * guard;
        let blueDelta = data[offset + 2] * guard;
        if (controls.protectContrast) {
          // Restore part of the source brightness along the neutral RGB axis.
          // Scaling per luma coefficient instead would add 71.5% of the
          // correction to green and 7.2% to blue, i.e. a green cast.
          const outputLuma = luminance(
            redValue + redDelta,
            greenValue + greenDelta,
            blueValue + blueDelta,
          );
          const lumaDelta = (outputLuma - luma) * CONTRAST_RESTORE;
          redDelta -= lumaDelta;
          greenDelta -= lumaDelta;
          blueDelta -= lumaDelta;
        }
        output[offset] = redDelta;
        output[offset + 1] = greenDelta;
        output[offset + 2] = blueDelta;
      }
    }
  }
  return { dimension, data: output };
}

/**
 * Scale a fitted residual by a normalized strength without touching zones.
 *
 * Used for the live strength slider preview, where re-running full controls
 * for every value would be wasteful.
 */
export function scaleResidual(residualLut: ResidualLut, strength: number): ResidualLut {
  const amount = clamp01(strength);
  const data = new Float32Array(residualLut.data.length);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = residualLut.data[index] * amount;
  }
  return { dimension: residualLut.dimension, data };
}
