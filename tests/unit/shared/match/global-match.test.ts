import { describe, expect, it } from "vitest";
import { fitGlobalResidualLut } from "../../../../src/shared/match/global-match";
import { applyResidual } from "../../../../src/shared/match/residual-lut";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomImage(seed: number, pixels: number): Float32Array {
  const random = seededRandom(seed);
  const samples = new Float32Array(pixels * 3);
  for (let index = 0; index < samples.length; index += 1) samples[index] = random();
  return samples;
}

function ramp(width: number, height: number, start: number, end: number, power = 1): Float32Array {
  const samples = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (start + ((end - start) * x) / (width - 1)) ** power;
      const offset = (y * width + x) * 3;
      samples[offset] = value;
      samples[offset + 1] = value;
      samples[offset + 2] = value;
    }
  }
  return samples;
}

function lumaOf(samples: Float32Array, pixel: number): number {
  const offset = pixel * 3;
  return samples[offset] * 0.2126 + samples[offset + 1] * 0.7152 + samples[offset + 2] * 0.0722;
}

function mean(values: Float32Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function standardDeviation(values: Float32Array): number {
  const average = mean(values);
  let total = 0;
  for (const value of values) total += (value - average) ** 2;
  return Math.sqrt(total / values.length);
}

describe("fitGlobalResidualLut", () => {
  it("returns an identity volume when both images are the same", () => {
    const image = randomImage(11, 24 * 24);
    const lut = fitGlobalResidualLut(image, image, 9);
    expect(lut.dimension).toBe(9);
    expect(lut.data.every((value) => value === 0)).toBe(true);
  });

  it("is deterministic", () => {
    const source = randomImage(3, 20 * 20);
    const reference = randomImage(17, 18 * 18);
    const first = fitGlobalResidualLut(source, reference, 9);
    const second = fitGlobalResidualLut(source, reference, 9);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it("transfers warm and cool references in opposite colour directions", () => {
    const source = ramp(48, 24, 0.18, 0.82);
    const warm = new Float32Array(source.length);
    const cool = new Float32Array(source.length);
    for (let offset = 0; offset < source.length; offset += 3) {
      warm[offset] = Math.min(1, source[offset] + 0.075);
      warm[offset + 1] = Math.min(1, source[offset + 1] + 0.01);
      warm[offset + 2] = Math.max(0, source[offset + 2] - 0.055);
      cool[offset] = Math.max(0, source[offset] - 0.05);
      cool[offset + 1] = Math.min(1, source[offset + 1] + 0.015);
      cool[offset + 2] = Math.min(1, source[offset + 2] + 0.08);
    }
    const warmOutput = applyResidual(fitGlobalResidualLut(source, warm, 33), 0.5, 0.5, 0.5);
    const coolOutput = applyResidual(fitGlobalResidualLut(source, cool, 33), 0.5, 0.5, 0.5);
    expect(warmOutput[0] - warmOutput[2]).toBeGreaterThan(0.035);
    expect(coolOutput[2] - coolOutput[0]).toBeGreaterThan(0.035);
  });

  it("moves brightness and contrast toward the reference", () => {
    const source = ramp(256, 12, 0.22, 0.78);
    const reference = ramp(256, 12, 0.1, 0.9, 1.8);
    const output = new Float32Array(source.length);
    const lut = fitGlobalResidualLut(source, reference, 33);
    for (let pixel = 0; pixel < source.length / 3; pixel += 1) {
      const mapped = applyResidual(lut, source[pixel * 3], source[pixel * 3 + 1], source[pixel * 3 + 2]);
      output[pixel * 3] = mapped[0];
      output[pixel * 3 + 1] = mapped[1];
      output[pixel * 3 + 2] = mapped[2];
    }
    expect(mean(output)).toBeLessThan(mean(source) - 0.06);
    expect(standardDeviation(output)).toBeGreaterThan(standardDeviation(source) + 0.03);
  });

  it("keeps the tone mapping monotonic on a neutral ramp", () => {
    const source = ramp(128, 4, 0.08, 0.92);
    const reference = ramp(128, 4, 0.16, 0.84, 0.75);
    const lut = fitGlobalResidualLut(source, reference, 33);
    let previous = -Infinity;
    for (let pixel = 0; pixel < 128; pixel += 1) {
      const value = source[pixel * 3];
      const mapped = applyResidual(lut, value, value, value);
      const luma = mapped[0] * 0.2126 + mapped[1] * 0.7152 + mapped[2] * 0.0722;
      expect(luma).toBeGreaterThanOrEqual(previous - 1e-5);
      previous = luma;
    }
  });

  it("anchors neutral colours instead of fully tinting them", () => {
    const source = ramp(64, 12, 0.2, 0.8);
    const reference = new Float32Array(source.length);
    for (let offset = 0; offset < source.length; offset += 3) {
      reference[offset] = Math.min(1, source[offset] + 0.17);
      reference[offset + 1] = source[offset + 1];
      reference[offset + 2] = Math.max(0, source[offset + 2] - 0.13);
    }
    const output = applyResidual(fitGlobalResidualLut(source, reference, 33), 0.5, 0.5, 0.5);
    expect(output[0] - output[2]).toBeGreaterThan(0.05);
    expect(output[0] - output[2]).toBeLessThan(0.235);
  });

  it("collapses a degenerate chromatic axis to one stable response", () => {
    // A perfectly neutral source carries no chromatic spread. Interpolating
    // across that empty span would turn float noise into a random tint, so the
    // guard has to return one consistent shift for near-identical inputs.
    const source = ramp(64, 8, 0.2, 0.8);
    const reference = new Float32Array(source.length);
    for (let offset = 0; offset < source.length; offset += 3) {
      reference[offset] = Math.min(1, source[offset] * 1.2);
      reference[offset + 1] = source[offset + 1];
      reference[offset + 2] = source[offset + 2] * 0.75;
    }
    const lut = fitGlobalResidualLut(source, reference, 33);
    const neutral = applyResidual(lut, 0.5, 0.5, 0.5);
    const jittered = applyResidual(lut, 0.5 + 1e-6, 0.5 - 1e-6, 0.5 + 1e-6);
    expect(Math.abs(jittered[0] - neutral[0])).toBeLessThan(1e-3);
    expect(Math.abs(jittered[2] - neutral[2])).toBeLessThan(1e-3);
    // The shift itself must still follow the reference's colour direction.
    expect(neutral[0] - neutral[2]).toBeGreaterThan(0.02);
  });

  it("rejects malformed samples", () => {
    expect(() => fitGlobalResidualLut(new Float32Array(6), new Float32Array(30), 9)).toThrow(
      "SOURCE_SAMPLES_INVALID",
    );
    expect(() => fitGlobalResidualLut(new Float32Array(30), new Float32Array(30), 1)).toThrow(
      "LUT_DIMENSION_INVALID",
    );
  });

  it("produces a usable spread of lightness values", () => {
    const source = ramp(64, 8, 0.1, 0.9);
    const reference = ramp(64, 8, 0.2, 0.7);
    const lut = fitGlobalResidualLut(source, reference, 17);
    const lumas = [];
    for (let index = 0; index < 17; index += 1) {
      const value = index / 16;
      const mapped = applyResidual(lut, value, value, value);
      lumas.push(lumaOf(mapped as unknown as Float32Array, 0));
    }
    expect(lumas[0]).toBeGreaterThan(0.1);
    expect(lumas[lumas.length - 1]).toBeLessThan(0.9);
  });
});
