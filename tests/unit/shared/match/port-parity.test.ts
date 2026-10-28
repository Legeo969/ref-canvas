import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitGlobalResidualLut } from "../../../../src/shared/match/global-match";
import { applyLookControls, type LookControls } from "../../../../src/shared/match/look-controls";
import { analyseReference } from "../../../../src/shared/match/reference-analysis";
import { applyResidual } from "../../../../src/shared/match/residual-lut";

interface ResidualCase {
  name: string;
  dimension: number;
  source: number[];
  reference: number[];
  residual: number[];
  controls?: LookControls;
  adjustResidual?: number[];
  probe?: [number, number, number];
  probeResult?: [number, number, number];
}

interface AnalysisCase {
  name: string;
  source: number[];
  brightness: { p10: number; median: number; p90: number; contrast_span: number };
  saturation: { mean: number; p90: number };
  hueMean: number | null;
  palette: { hex: string; coverage: number; rgb: [number, number, number] }[];
}

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/match/reference-match-cases.json", import.meta.url), "utf8"),
) as { cases: (ResidualCase | AnalysisCase)[] };

const residualCases = fixture.cases.filter((entry): entry is ResidualCase => "residual" in entry);
const analysisCases = fixture.cases.filter((entry): entry is AnalysisCase => "palette" in entry);

function maxDelta(actual: ArrayLike<number>, expected: readonly number[]): number {
  let worst = 0;
  for (let index = 0; index < expected.length; index += 1) {
    worst = Math.max(worst, Math.abs(actual[index] - expected[index]));
  }
  return worst;
}

/**
 * Parity fixtures are generated from the upstream `reference-match` core so a
 * later change to the port cannot silently drift away from the reference
 * implementation.
 */
describe("reference match port parity", () => {
  for (const entry of residualCases) {
    it(`matches the upstream residual for ${entry.name}`, () => {
      const source = Float32Array.from(entry.source);
      const reference = Float32Array.from(entry.reference);
      const lut = fitGlobalResidualLut(source, reference, entry.dimension);
      expect(lut.dimension).toBe(entry.dimension);
      expect(maxDelta(lut.data, entry.residual)).toBeLessThan(2e-3);
    });

    if (entry.controls && entry.adjustResidual) {
      it(`matches the upstream look controls for ${entry.name}`, () => {
        const source = Float32Array.from(entry.source);
        const reference = Float32Array.from(entry.reference);
        const lut = fitGlobalResidualLut(source, reference, entry.dimension);
        const adjusted = applyLookControls(lut, entry.controls!);
        expect(maxDelta(adjusted.data, entry.adjustResidual!)).toBeLessThan(2e-3);
      });
    }

    if (entry.probe && entry.probeResult) {
      it(`matches the upstream trilinear sample for ${entry.name}`, () => {
        const source = Float32Array.from(entry.source);
        const reference = Float32Array.from(entry.reference);
        const lut = fitGlobalResidualLut(source, reference, entry.dimension);
        const sampled = applyResidual(lut, ...entry.probe!);
        expect(Math.abs(sampled[0] - entry.probeResult![0])).toBeLessThan(2e-3);
        expect(Math.abs(sampled[1] - entry.probeResult![1])).toBeLessThan(2e-3);
        expect(Math.abs(sampled[2] - entry.probeResult![2])).toBeLessThan(2e-3);
      });
    }
  }

  for (const entry of analysisCases) {
    it(`matches the upstream reference analysis for ${entry.name}`, () => {
      const analysis = analyseReference(Float32Array.from(entry.source), entry.palette.length);
      expect(analysis.brightness.p10).toBeCloseTo(entry.brightness.p10, 4);
      expect(analysis.brightness.median).toBeCloseTo(entry.brightness.median, 4);
      expect(analysis.brightness.p90).toBeCloseTo(entry.brightness.p90, 4);
      expect(analysis.brightness.contrastSpan).toBeCloseTo(entry.brightness.contrast_span, 4);
      expect(analysis.saturation.mean).toBeCloseTo(entry.saturation.mean, 4);
      expect(analysis.saturation.p90).toBeCloseTo(entry.saturation.p90, 4);
      if (entry.hueMean === null) expect(analysis.hue.meanDegrees).toBeNull();
      else expect(analysis.hue.meanDegrees).toBeCloseTo(entry.hueMean, 1);
      // k-means runs in float32 upstream, so cluster centres and their order
      // drift slightly; compare the distribution rather than individual rows.
      expect(analysis.mainColours).toHaveLength(entry.palette.length);
      const weighted = (colours: { rgb: [number, number, number]; coverage: number }[]) => {
        const total = colours.reduce((sum, colour) => sum + colour.coverage, 0);
        return [0, 1, 2].map(
          (channel) =>
            colours.reduce((sum, colour) => sum + colour.rgb[channel] * colour.coverage, 0) / total,
        );
      };
      const actualMean = weighted(analysis.mainColours);
      const expectedMean = weighted(entry.palette);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(actualMean[channel] - expectedMean[channel])).toBeLessThan(0.02);
      }
      const coverage = analysis.mainColours.reduce((sum, colour) => sum + colour.coverage, 0);
      expect(coverage).toBeCloseTo(1, 2);
    });
  }
});
