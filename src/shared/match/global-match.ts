/**
 * Perceptual tone and colour-distribution matching baked into a 3D residual LUT.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match).
 *
 * The source and reference samples are transformed into Oklab. A monotonic
 * curve first matches their perceptual lightness distribution (the exposure,
 * contrast, black/white point and highlight-rolloff part of the look). The two
 * chromatic axes are then matched per tonal zone, so warm highlights and cool
 * shadows can stay independent trends. Sampling that continuous transform on an
 * RGB lattice produces a portable 33- or 65-point LUT.
 */

import {
  clamp01,
  displayRgbToOklab,
  oklabToDisplayRgb,
  smoothstep,
} from "./colour";
import { createIdentityLattice, createResidualLut, type ResidualLut } from "./residual-lut";

const SAMPLE_LIMIT = 80_000;
const QUANTILE_STEPS = 2_049;
const TONE_QUANTILES = [
  0, 0.003, 0.01, 0.03, 0.07, 0.15, 0.25, 0.5, 0.75, 0.85, 0.93, 0.97, 0.99, 0.997, 1,
] as const;
const ZONE_CENTRES = [0.18, 0.5, 0.82] as const;
const ZONE_WIDTH = 0.3;
/** Intrinsic stability limits, independent of the optional user safeguards. */
const TONE_MATCH_AMOUNT = 0.86;
const CHROMA_MATCH_AMOUNT = 0.9;
const NEUTRAL_CHROMA_AMOUNT = 0.8;
/** A zone holding fewer samples than this is not statistically meaningful. */
const MIN_ZONE_SAMPLES = 128;
/**
 * A source axis whose whole distribution is narrower than this carries no
 * usable information. Interpolating across such a span turns float rounding
 * into an arbitrary tint, so the mapping collapses to the reference median.
 * Neutral sources (grey walls, paper, overcast footage) hit exactly this case.
 */
const DEGENERATE_SPAN = 1e-4;

export interface MappingKnots {
  source: Float32Array;
  reference: Float32Array;
}

export interface OklabSamples {
  lightness: Float32Array;
  axisA: Float32Array;
  axisB: Float32Array;
}

function assertSamples(samples: Float32Array, label: string): void {
  if (samples.length < 24 || samples.length % 3 !== 0) throw new Error(`${label}_SAMPLES_INVALID`);
}

/** Deterministic even-stride subsample of packed RGB triplets. */
export function samplePixels(samples: Float32Array): Float32Array {
  const pixels = samples.length / 3;
  if (pixels <= SAMPLE_LIMIT) return samples;
  const result = new Float32Array(SAMPLE_LIMIT * 3);
  const stride = (pixels - 1) / (SAMPLE_LIMIT - 1);
  for (let index = 0; index < SAMPLE_LIMIT; index += 1) {
    const source = Math.round(index * stride) * 3;
    result[index * 3] = samples[source];
    result[index * 3 + 1] = samples[source + 1];
    result[index * 3 + 2] = samples[source + 2];
  }
  return result;
}

export function toOklabSamples(samples: Float32Array): OklabSamples {
  const count = samples.length / 3;
  const lightness = new Float32Array(count);
  const axisA = new Float32Array(count);
  const axisB = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    // Samples outside the LUT input domain carry no usable distribution
    // information, so they are bounded the way the reference implementation
    // bounds them.
    const lab = displayRgbToOklab(
      clamp01(samples[offset]),
      clamp01(samples[offset + 1]),
      clamp01(samples[offset + 2]),
    );
    lightness[index] = lab.l;
    axisA[index] = lab.a;
    axisB[index] = lab.b;
  }
  return { lightness, axisA, axisB };
}

function sortedCopy(values: Float32Array): Float32Array {
  return values.slice().sort();
}

/** Linear-interpolation quantile of an ascending array (numpy's default). */
function quantileSorted(sorted: Float32Array, fraction: number): number {
  const last = sorted.length - 1;
  if (last <= 0) return sorted[0] ?? 0;
  const position = clamp01(fraction) * last;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, last);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function quantileKnots(source: Float32Array, reference: Float32Array, steps: number): MappingKnots {
  const sortedSource = sortedCopy(source);
  const sortedReference = sortedCopy(reference);
  const knotSource: number[] = [];
  const knotReference: number[] = [];
  for (let step = 0; step < steps; step += 1) {
    const fraction = steps === 1 ? 0 : step / (steps - 1);
    const sourceValue = quantileSorted(sortedSource, fraction);
    // Duplicated source knots would make the piecewise mapping ambiguous;
    // keep the first occurrence, exactly like the upstream implementation.
    if (knotSource.length && sourceValue <= knotSource[knotSource.length - 1]) continue;
    knotSource.push(sourceValue);
    knotReference.push(quantileSorted(sortedReference, fraction));
  }
  if (!knotSource.length) {
    knotSource.push(sortedSource[0] ?? 0);
    knotReference.push(sortedReference[0] ?? 0);
  }
  if (knotSource[knotSource.length - 1] - knotSource[0] < DEGENERATE_SPAN) {
    return degenerateKnots(knotSource[0], sortedReference);
  }
  return { source: Float32Array.from(knotSource), reference: Float32Array.from(knotReference) };
}

/** Constant mapping used when the source distribution has no usable spread. */
function degenerateKnots(sourceValue: number, sortedReference: Float32Array): MappingKnots {
  return {
    source: Float32Array.from([sourceValue]),
    reference: Float32Array.from([quantileSorted(sortedReference, 0.5)]),
  };
}

/** Sparse monotonic lightness knots: denser near black, white and rolloff. */
export function fitToneMapping(sourceLightness: Float32Array, referenceLightness: Float32Array): MappingKnots {
  const sortedSource = sortedCopy(sourceLightness);
  const sortedReference = sortedCopy(referenceLightness);
  const knotSource: number[] = [];
  const knotReference: number[] = [];
  for (const fraction of TONE_QUANTILES) {
    const sourceValue = quantileSorted(sortedSource, fraction);
    if (knotSource.length && sourceValue <= knotSource[knotSource.length - 1]) continue;
    knotSource.push(sourceValue);
    knotReference.push(quantileSorted(sortedReference, fraction));
  }
  if (!knotSource.length) {
    knotSource.push(sortedSource[0] ?? 0);
    knotReference.push(sortedReference[0] ?? 0);
  }
  if (knotSource[knotSource.length - 1] - knotSource[0] < DEGENERATE_SPAN) {
    return degenerateKnots(knotSource[0], sortedReference);
  }
  return { source: Float32Array.from(knotSource), reference: Float32Array.from(knotReference) };
}

/** Piecewise-linear mapping with clamped ends (numpy `interp` semantics). */
export function applyMapping(value: number, knots: MappingKnots): number {
  const { source, reference } = knots;
  const last = source.length - 1;
  if (last < 0) return value;
  if (source.length === 1) return reference[0];
  if (value <= source[0]) return reference[0];
  if (value >= source[last]) return reference[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (source[middle] <= value) low = middle;
    else high = middle;
  }
  const span = source[high] - source[low];
  if (span <= 0) return reference[low];
  const weight = (value - source[low]) / span;
  return reference[low] + (reference[high] - reference[low]) * weight;
}

function zoneMemberships(lightness: number, out: Float32Array): void {
  let total = 0;
  for (let zone = 0; zone < 3; zone += 1) {
    const distance = (lightness - ZONE_CENTRES[zone]) / ZONE_WIDTH;
    const weight = Math.exp(-0.5 * distance * distance);
    out[zone] = weight;
    total += weight;
  }
  const divisor = Math.max(total, 1e-8);
  out[0] /= divisor;
  out[1] /= divisor;
  out[2] /= divisor;
}

function maskedColumn(
  axis: Float32Array,
  lightness: Float32Array,
  zone: number,
  threshold = 0.22,
): Float32Array | null {
  const weights = new Float32Array(3);
  const selected: number[] = [];
  for (let index = 0; index < axis.length; index += 1) {
    zoneMemberships(lightness[index], weights);
    if (weights[zone] >= threshold) selected.push(axis[index]);
  }
  return selected.length >= MIN_ZONE_SAMPLES ? Float32Array.from(selected) : null;
}

/**
 * Fit one chromatic-axis CDF mapping per tonal zone.
 *
 * The zone masks overlap on purpose: a hard split would leave hue
 * discontinuities at a particular code value.
 */
export function fitZoneMappings(
  sourceAxis: Float32Array,
  sourceLightness: Float32Array,
  referenceAxis: Float32Array,
  referenceLightness: Float32Array,
): MappingKnots[] {
  const mappings: MappingKnots[] = [];
  for (let zone = 0; zone < 3; zone += 1) {
    const sourceMasked = maskedColumn(sourceAxis, sourceLightness, zone);
    const referenceMasked = maskedColumn(referenceAxis, referenceLightness, zone);
    mappings.push(
      sourceMasked && referenceMasked
        ? quantileKnots(sourceMasked, referenceMasked, QUANTILE_STEPS)
        : quantileKnots(sourceAxis, referenceAxis, QUANTILE_STEPS),
    );
  }
  return mappings;
}

function applyZoneMapping(
  value: number,
  lightness: number,
  mappings: readonly MappingKnots[],
  weights: Float32Array,
): number {
  zoneMemberships(lightness, weights);
  return (
    applyMapping(value, mappings[0]) * weights[0] +
    applyMapping(value, mappings[1]) * weights[1] +
    applyMapping(value, mappings[2]) * weights[2]
  );
}

/**
 * Fit a smooth Oklab tone-and-colour residual LUT.
 *
 * `source` and `reference` are packed RGB triplets already in the Rec.709
 * Gamma 2.4 match domain (use `srgbToMatchDomain` for sRGB inputs).
 */
export function fitGlobalResidualLut(
  source: Float32Array,
  reference: Float32Array,
  dimension = 33,
): ResidualLut {
  assertSamples(source, "SOURCE");
  assertSamples(reference, "REFERENCE");
  const sourceSamples = samplePixels(source);
  const referenceSamples = samplePixels(reference);
  if (
    sourceSamples.length === referenceSamples.length &&
    sourceSamples.every((value, index) => value === referenceSamples[index])
  ) {
    return createResidualLut(dimension);
  }

  const sourceLab = toOklabSamples(sourceSamples);
  const referenceLab = toOklabSamples(referenceSamples);
  const toneMapping = fitToneMapping(sourceLab.lightness, referenceLab.lightness);
  const chromaMappings = [
    fitZoneMappings(sourceLab.axisA, sourceLab.lightness, referenceLab.axisA, referenceLab.lightness),
    fitZoneMappings(sourceLab.axisB, sourceLab.lightness, referenceLab.axisB, referenceLab.lightness),
  ];

  const identity = createIdentityLattice(dimension);
  const residual = new Float32Array(identity.length);
  const weights = new Float32Array(3);
  for (let offset = 0; offset < identity.length; offset += 3) {
    const lab = displayRgbToOklab(identity[offset], identity[offset + 1], identity[offset + 2]);
    const rawLightness = applyMapping(lab.l, toneMapping);
    // Retaining part of the source curve keeps an unrelated reference
    // composition from forcing a brittle exposure/contrast change.
    const mappedLightness = lab.l + (rawLightness - lab.l) * TONE_MATCH_AMOUNT;
    const sourceChroma = Math.hypot(lab.a, lab.b);
    // Near-neutral RGB values include walls, paper and practical highlights.
    // Anchor them to their source colour; strongly chromatic inputs keep the
    // full reference-style response.
    const chromaAmount =
      CHROMA_MATCH_AMOUNT *
      (NEUTRAL_CHROMA_AMOUNT + (1 - NEUTRAL_CHROMA_AMOUNT) * smoothstep(0.018, 0.16, sourceChroma));
    const rawA = applyZoneMapping(lab.a, lab.l, chromaMappings[0], weights);
    const rawB = applyZoneMapping(lab.b, lab.l, chromaMappings[1], weights);
    const mapped = oklabToDisplayRgb(
      mappedLightness,
      lab.a + (rawA - lab.a) * chromaAmount,
      lab.b + (rawB - lab.b) * chromaAmount,
    );
    residual[offset] = clamp01(mapped[0]) - identity[offset];
    residual[offset + 1] = clamp01(mapped[1]) - identity[offset + 1];
    residual[offset + 2] = clamp01(mapped[2]) - identity[offset + 2];
  }
  return createResidualLut(dimension, residual);
}
