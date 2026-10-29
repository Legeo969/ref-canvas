/**
 * Summarise a reference image as a small, deterministic colour-style report.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match). Hue families are returned as
 * stable keys so the renderer can localise the labels.
 */

import { clamp01, luminance } from "./colour";

export type HueFamily =
  | "neutral"
  | "warm-red"
  | "warm-orange"
  | "warm-yellow"
  | "yellow-green"
  | "natural-green"
  | "cool-cyan"
  | "cool-blue"
  | "cool-violet"
  | "magenta"
  | "rose";

export interface PaletteEntry {
  rgb: [number, number, number];
  hex: string;
  /** Share of sampled pixels assigned to this cluster, 0–1. */
  coverage: number;
}

export interface ReferenceAnalysis {
  mainColours: PaletteEntry[];
  brightness: { p10: number; median: number; p90: number; contrastSpan: number };
  saturation: { mean: number; p90: number };
  hue: { meanDegrees: number | null; family: HueFamily };
  scopes: ScopeReport;
}

const MAX_PALETTE_SAMPLES = 80_000;
const KMEANS_ITERATIONS = 24;
const COLOURFUL_THRESHOLD = 0.12;

function hueFamily(degrees: number | null): HueFamily {
  if (degrees === null) return "neutral";
  const hue = ((degrees % 360) + 360) % 360;
  if (hue < 15 || hue >= 345) return "warm-red";
  if (hue < 45) return "warm-orange";
  if (hue < 70) return "warm-yellow";
  if (hue < 105) return "yellow-green";
  if (hue < 150) return "natural-green";
  if (hue < 185) return "cool-cyan";
  if (hue < 230) return "cool-blue";
  if (hue < 275) return "cool-violet";
  if (hue < 325) return "magenta";
  return "rose";
}

function toHex(red: number, green: number, blue: number): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** Deterministic k-means palette, ordered as a perceived-brightness ramp. */
export function extractReferencePalette(samples: Float32Array, count = 10): PaletteEntry[] {
  const pixels = samples.length / 3;
  if (pixels === 0) return [];
  const clusters = Math.max(1, Math.min(count, pixels));
  let points = samples;
  if (pixels > MAX_PALETTE_SAMPLES) {
    points = new Float32Array(MAX_PALETTE_SAMPLES * 3);
    const stride = (pixels - 1) / (MAX_PALETTE_SAMPLES - 1);
    for (let index = 0; index < MAX_PALETTE_SAMPLES; index += 1) {
      const source = Math.round(index * stride) * 3;
      points[index * 3] = samples[source];
      points[index * 3 + 1] = samples[source + 1];
      points[index * 3 + 2] = samples[source + 2];
    }
  }
  const total = points.length / 3;
  const centroids = new Float32Array(clusters * 3);
  for (let cluster = 0; cluster < clusters; cluster += 1) {
    const pick = clusters === 1 ? 0 : Math.round((cluster * (total - 1)) / (clusters - 1));
    centroids.set(points.subarray(pick * 3, pick * 3 + 3), cluster * 3);
  }
  const labels = new Int32Array(total);
  const sums = new Float32Array(clusters * 3);
  const counts = new Int32Array(clusters);
  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let point = 0; point < total; point += 1) {
      const offset = point * 3;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let cluster = 0; cluster < clusters; cluster += 1) {
        const deltaRed = points[offset] - centroids[cluster * 3];
        const deltaGreen = points[offset + 1] - centroids[cluster * 3 + 1];
        const deltaBlue = points[offset + 2] - centroids[cluster * 3 + 2];
        const distance = deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cluster;
        }
      }
      labels[point] = best;
    }
    sums.fill(0);
    counts.fill(0);
    for (let point = 0; point < total; point += 1) {
      const cluster = labels[point];
      const offset = point * 3;
      sums[cluster * 3] += points[offset];
      sums[cluster * 3 + 1] += points[offset + 1];
      sums[cluster * 3 + 2] += points[offset + 2];
      counts[cluster] += 1;
    }
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      if (!counts[cluster]) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const next = sums[cluster * 3 + channel] / counts[cluster];
        if (Math.abs(next - centroids[cluster * 3 + channel]) > 1e-5) moved = true;
        centroids[cluster * 3 + channel] = next;
      }
    }
    if (!moved) break;
  }
  const entries: PaletteEntry[] = [];
  for (let cluster = 0; cluster < clusters; cluster += 1) {
    if (!counts[cluster]) continue;
    const red = centroids[cluster * 3];
    const green = centroids[cluster * 3 + 1];
    const blue = centroids[cluster * 3 + 2];
    entries.push({
      rgb: [red, green, blue],
      hex: toHex(red, green, blue),
      coverage: counts[cluster] / total,
    });
  }
  return entries.sort(
    (left, right) =>
      luminance(left.rgb[0], left.rgb[1], left.rgb[2]) - luminance(right.rgb[0], right.rgb[1], right.rgb[2]) ||
      left.hex.localeCompare(right.hex),
  );
}

function percentileSorted(sorted: Float32Array, fraction: number): number {
  const last = sorted.length - 1;
  if (last < 0) return 0;
  const position = clamp01(fraction) * last;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, last);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function hueAndSaturation(red: number, green: number, blue: number): [number, number] {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (delta <= 1e-7) return [0, 0];
  let hue: number;
  if (maximum === red) hue = (((green - blue) / delta) % 6 + 6) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, maximum > 1e-7 ? delta / maximum : 0];
}

export interface ScopeReport {
  /** Three display series of 64 segments: 7-tap binomial smoothing, then 4 bins merged. */
  histogram: [number[], number[], number[]];
  /** Cb/Cr density, row-major with Cr as the row and Cb as the column. */
  density: number[];
  densitySize: number;
}

const SCOPE_BINS = 256;
const SCOPE_SEGMENTS = 64;
const SCOPE_DENSITY = 128;
const SMOOTHING_KERNEL = [1, 6, 15, 20, 15, 6, 1] as const;

function smoothHistogramChannel(counts: Uint32Array): number[] {
  const radius = 3;
  const smoothed = new Float64Array(SCOPE_BINS);
  for (let index = 0; index < SCOPE_BINS; index += 1) {
    let sum = 0;
    let weight = 0;
    for (let tap = 0; tap < SMOOTHING_KERNEL.length; tap += 1) {
      const source = index + tap - radius;
      if (source < 0 || source >= SCOPE_BINS) continue;
      sum += counts[source] * SMOOTHING_KERNEL[tap];
      weight += SMOOTHING_KERNEL[tap];
    }
    smoothed[index] = weight > 0 ? sum / weight : 0;
  }
  const segments: number[] = [];
  const merge = SCOPE_BINS / SCOPE_SEGMENTS;
  for (let segment = 0; segment < SCOPE_SEGMENTS; segment += 1) {
    let sum = 0;
    for (let step = 0; step < merge; step += 1) sum += smoothed[segment * merge + step];
    segments.push(sum / merge);
  }
  return segments;
}

/**
 * RGB histogram and Cb/Cr density for the reference image.
 *
 * The reference implementation computed these in the browser from an already
 * displayed image; doing it in the shared module keeps the numbers identical to
 * what the matcher saw and lets the renderer stay a dumb painter.
 */
export function analyseScopes(samples: Float32Array): ScopeReport {
  const pixels = samples.length / 3;
  if (pixels === 0) throw new Error("REFERENCE_SAMPLES_INVALID");
  const channels = [new Uint32Array(SCOPE_BINS), new Uint32Array(SCOPE_BINS), new Uint32Array(SCOPE_BINS)];
  const density = new Uint32Array(SCOPE_DENSITY * SCOPE_DENSITY);
  const last = SCOPE_DENSITY - 1;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 3;
    const red = Math.round(clamp01(samples[offset]) * 255);
    const green = Math.round(clamp01(samples[offset + 1]) * 255);
    const blue = Math.round(clamp01(samples[offset + 2]) * 255);
    channels[0][red] += 1;
    channels[1][green] += 1;
    channels[2][blue] += 1;
    // Rec.601 Cb/Cr is what video scopes show, and it is what the upstream
    // browser-side implementation used for this plot.
    const cb = (-0.168736 * red - 0.331264 * green + 0.5 * blue) / 255 + 0.5;
    const cr = (0.5 * red - 0.418688 * green - 0.081312 * blue) / 255 + 0.5;
    const cbIndex = Math.min(last, Math.max(0, Math.round(cb * last)));
    const crIndex = Math.min(last, Math.max(0, Math.round(cr * last)));
    density[crIndex * SCOPE_DENSITY + cbIndex] += 1;
  }
  return {
    histogram: [
      smoothHistogramChannel(channels[0]),
      smoothHistogramChannel(channels[1]),
      smoothHistogramChannel(channels[2]),
    ],
    density: Array.from(density),
    densitySize: SCOPE_DENSITY,
  };
}

/** Summarise major colours plus brightness, contrast and saturation tendencies. */
export function analyseReference(samples: Float32Array, colourCount = 10): ReferenceAnalysis {
  const pixels = samples.length / 3;
  if (pixels === 0) throw new Error("REFERENCE_SAMPLES_INVALID");
  const luma = new Float32Array(pixels);
  const saturation = new Float32Array(pixels);
  let sinSum = 0;
  let cosSum = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 3;
    const red = clamp01(samples[offset]);
    const green = clamp01(samples[offset + 1]);
    const blue = clamp01(samples[offset + 2]);
    luma[index] = luminance(red, green, blue);
    const [hue, sat] = hueAndSaturation(red, green, blue);
    saturation[index] = sat;
    if (sat > COLOURFUL_THRESHOLD) {
      // Hue is circular: an ordinary mean would call a mix around 359° and 1°
      // cyan. The saturation-weighted vector mean keeps it near red.
      const radians = (hue * Math.PI) / 180;
      sinSum += Math.sin(radians) * sat;
      cosSum += Math.cos(radians) * sat;
    }
  }
  const sortedLuma = luma.slice().sort();
  const sortedSaturation = saturation.slice().sort();
  const meanDegrees =
    sinSum === 0 && cosSum === 0
      ? null
      : ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
  let saturationSum = 0;
  for (let index = 0; index < pixels; index += 1) saturationSum += saturation[index];
  return {
    mainColours: extractReferencePalette(samples, colourCount),
    brightness: {
      p10: percentileSorted(sortedLuma, 0.1),
      median: percentileSorted(sortedLuma, 0.5),
      p90: percentileSorted(sortedLuma, 0.9),
      contrastSpan: percentileSorted(sortedLuma, 0.9) - percentileSorted(sortedLuma, 0.1),
    },
    saturation: {
      mean: saturationSum / pixels,
      p90: percentileSorted(sortedSaturation, 0.9),
    },
    hue: {
      meanDegrees: meanDegrees === null ? null : Math.round(meanDegrees * 10) / 10,
      family: hueFamily(meanDegrees),
    },
    scopes: analyseScopes(samples),
  };
}
