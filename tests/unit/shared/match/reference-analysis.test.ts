import { describe, expect, it } from "vitest";
import { analyseReference, extractReferencePalette } from "../../../../src/shared/match/reference-analysis";

function solid(red: number, green: number, blue: number, pixels: number): Float32Array {
  const samples = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    samples[index * 3] = red;
    samples[index * 3 + 1] = green;
    samples[index * 3 + 2] = blue;
  }
  return samples;
}

describe("analysis", () => {
  it("reports brightness, contrast and saturation tendencies", () => {
    const samples = new Float32Array(64 * 3);
    for (let index = 0; index < 64; index += 1) {
      const value = index / 63;
      samples[index * 3] = value;
      samples[index * 3 + 1] = value;
      samples[index * 3 + 2] = value;
    }
    const analysis = analyseReference(samples);
    expect(analysis.brightness.p10).toBeLessThan(analysis.brightness.median);
    expect(analysis.brightness.median).toBeLessThan(analysis.brightness.p90);
    expect(analysis.brightness.contrastSpan).toBeGreaterThan(0.8);
    expect(analysis.saturation.mean).toBeCloseTo(0, 5);
    expect(analysis.hue.family).toBe("neutral");
  });

  it("names the hue family of a saturated colour", () => {
    const analysis = analyseReference(solid(0.9, 0.1, 0.1, 64));
    expect(analysis.hue.family).toBe("warm-red");
    expect(analysis.hue.meanDegrees).toBeCloseTo(0, 0);
  });

  it("averages hue circularly across the red seam", () => {
    const samples = new Float32Array(64 * 3);
    for (let index = 0; index < 64; index += 1) {
      const warm = index % 2 === 0;
      samples[index * 3] = 0.9;
      samples[index * 3 + 1] = warm ? 0.02 : 0.1;
      samples[index * 3 + 2] = warm ? 0.1 : 0.02;
    }
    const analysis = analyseReference(samples);
    const degrees = analysis.hue.meanDegrees ?? 0;
    expect(degrees < 10 || degrees > 350).toBe(true);
  });

  it("groups similar colours into coverage-weighted palette entries", () => {
    const samples = new Float32Array(100 * 3);
    for (let index = 0; index < 100; index += 1) {
      const blue = index >= 80;
      samples[index * 3] = blue ? 0.1 : 0.85;
      samples[index * 3 + 1] = blue ? 0.15 : 0.2;
      samples[index * 3 + 2] = blue ? 0.9 : 0.25;
    }
    const palette = extractReferencePalette(samples, 4);
    expect(palette).toHaveLength(2);
    // Ordered as a brightness ramp: the blue cluster is darker than the red one.
    expect(palette[0].hex).toBe("#1A26E5");
    expect(palette[1].hex).toBe("#D93340");
    expect(palette[0].coverage).toBeCloseTo(0.2, 2);
    expect(palette[1].coverage).toBeCloseTo(0.8, 2);
  });

  it("ranks the palette by perceived brightness", () => {
    const samples = new Float32Array(90 * 3);
    for (let index = 0; index < 90; index += 1) {
      const bucket = Math.floor(index / 30);
      const value = [0.9, 0.1, 0.5][bucket];
      samples[index * 3] = value;
      samples[index * 3 + 1] = value;
      samples[index * 3 + 2] = value;
    }
    const palette = extractReferencePalette(samples, 3);
    expect(palette.map((entry) => entry.hex)).toEqual(["#191919", "#808080", "#E5E5E5"]);
  });

  it("rejects empty input", () => {
    expect(() => analyseReference(new Float32Array(0))).toThrow("REFERENCE_SAMPLES_INVALID");
  });
});
