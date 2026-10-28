/**
 * Residual 3D LUT storage, sampling and `.cube` serialisation.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match). Values are stored as residuals
 * (`output = input + residual`) in `[channel][blue][green][red]` order; a
 * Resolve `.cube` instead holds final output RGB with red changing fastest.
 */

import { clamp01 } from "./colour";

export interface ResidualLut {
  /** Number of lattice points per axis (33 or 65 in practice). */
  dimension: number;
  /** `3 * dimension^3` values in `[channel][blue][green][red]` order. */
  data: Float32Array;
}

export const LUT_AXIS_LIMIT = 128;

export function createIdentityLattice(dimension: number): Float32Array {
  assertDimension(dimension);
  const plane = dimension * dimension;
  const data = new Float32Array(plane * dimension * 3);
  for (let blue = 0; blue < dimension; blue += 1) {
    const blueValue = blue / (dimension - 1);
    for (let green = 0; green < dimension; green += 1) {
      const greenValue = green / (dimension - 1);
      for (let red = 0; red < dimension; red += 1) {
        const offset = (blue * plane + green * dimension + red) * 3;
        data[offset] = red / (dimension - 1);
        data[offset + 1] = greenValue;
        data[offset + 2] = blueValue;
      }
    }
  }
  return data;
}

export function createResidualLut(dimension: number, data?: Float32Array): ResidualLut {
  assertDimension(dimension);
  const expected = dimension * dimension * dimension * 3;
  if (!data) return { dimension, data: new Float32Array(expected) };
  if (data.length !== expected) throw new Error("LUT_DATA_LENGTH_INVALID");
  return { dimension, data };
}

function assertDimension(dimension: number): void {
  if (!Number.isInteger(dimension) || dimension < 2 || dimension > LUT_AXIS_LIMIT) {
    throw new Error("LUT_DIMENSION_INVALID");
  }
}

function interpolationBounds(value: number, dimension: number): [number, number, number] {
  const coordinate = clamp01(value) * (dimension - 1);
  const lower = Math.floor(coordinate);
  return [lower, Math.min(lower + 1, dimension - 1), coordinate - lower];
}

/** Trilinear sample of the residual volume; out-of-range inputs use border lookup. */
export function sampleResidual(
  lut: ResidualLut,
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const { dimension, data } = lut;
  const plane = dimension * dimension;
  const [red0, red1, redWeight] = interpolationBounds(red, dimension);
  const [green0, green1, greenWeight] = interpolationBounds(green, dimension);
  const [blue0, blue1, blueWeight] = interpolationBounds(blue, dimension);
  const result: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    let accumulator = 0;
    for (let blueStep = 0; blueStep < 2; blueStep += 1) {
      const blueIndex = blueStep === 0 ? blue0 : blue1;
      const blueFactor = blueStep === 0 ? 1 - blueWeight : blueWeight;
      for (let greenStep = 0; greenStep < 2; greenStep += 1) {
        const greenIndex = greenStep === 0 ? green0 : green1;
        const greenFactor = greenStep === 0 ? 1 - greenWeight : greenWeight;
        for (let redStep = 0; redStep < 2; redStep += 1) {
          const redIndex = redStep === 0 ? red0 : red1;
          const redFactor = redStep === 0 ? 1 - redWeight : redWeight;
          const value = data[(plane * blueIndex + greenIndex * dimension + redIndex) * 3 + channel];
          accumulator += value * blueFactor * greenFactor * redFactor;
        }
      }
    }
    result[channel] = accumulator;
  }
  return result;
}

/** Apply the residual volume to one normalized RGB colour (unclipped). */
export function applyResidual(
  lut: ResidualLut,
  red: number,
  green: number,
  blue: number,
): [number, number, number] {
  const residual = sampleResidual(lut, red, green, blue);
  return [red + residual[0], green + residual[1], blue + residual[2]];
}

/**
 * Apply the residual volume to packed RGB float samples in place.
 *
 * The inner loop is deliberately allocation-free: a 1280×960 preview is 1.2M
 * pixels and goes through here on every slider move, so the tuple-returning
 * sampler above would create millions of short-lived arrays per frame.
 */
export function applyResidualToSamples(lut: ResidualLut, samples: Float32Array): void {
  const { dimension, data } = lut;
  const plane = dimension * dimension;
  const denominator = dimension - 1;
  for (let offset = 0; offset + 2 < samples.length; offset += 3) {
    const redCoordinate = clamp01(samples[offset]) * denominator;
    const greenCoordinate = clamp01(samples[offset + 1]) * denominator;
    const blueCoordinate = clamp01(samples[offset + 2]) * denominator;
    const red0 = Math.floor(redCoordinate);
    const green0 = Math.floor(greenCoordinate);
    const blue0 = Math.floor(blueCoordinate);
    const redWeight = redCoordinate - red0;
    const greenWeight = greenCoordinate - green0;
    const blueWeight = blueCoordinate - blue0;
    const redLow = 1 - redWeight;
    const greenLow = 1 - greenWeight;
    const blueLow = 1 - blueWeight;
    // 八个格点的索引与三线性权重一次算好，循环里只剩乘加。
    // 边界上「下一个格点」并不存在，权重为 0；用 step=0 让它读回自身，
    // 否则最后一个格点会越界读到 undefined，乘 0 得到 NaN。
    const redStep = red0 === denominator ? 0 : 3;
    const greenStep = green0 === denominator ? 0 : dimension * 3;
    const blueStep = blue0 === denominator ? 0 : plane * 3;
    const base000 = (plane * blue0 + green0 * dimension + red0) * 3;
    const base001 = base000 + redStep;
    const base010 = base000 + greenStep;
    const base011 = base010 + redStep;
    const base100 = base000 + blueStep;
    const base101 = base100 + redStep;
    const base110 = base100 + greenStep;
    const base111 = base110 + redStep;
    const weight000 = blueLow * greenLow * redLow;
    const weight001 = blueLow * greenLow * redWeight;
    const weight010 = blueLow * greenWeight * redLow;
    const weight011 = blueLow * greenWeight * redWeight;
    const weight100 = blueWeight * greenLow * redLow;
    const weight101 = blueWeight * greenLow * redWeight;
    const weight110 = blueWeight * greenWeight * redLow;
    const weight111 = blueWeight * greenWeight * redWeight;
    for (let channel = 0; channel < 3; channel += 1) {
      const residual =
        data[base000 + channel] * weight000 +
        data[base001 + channel] * weight001 +
        data[base010 + channel] * weight010 +
        data[base011 + channel] * weight011 +
        data[base100 + channel] * weight100 +
        data[base101 + channel] * weight101 +
        data[base110 + channel] * weight110 +
        data[base111 + channel] * weight111;
      samples[offset + channel] += residual;
    }
  }
}

/**
 * Apply the residual and encode sRGB bytes in one pass.
 *
 * Used by the preview renderer: doing the transfer-function decode, the
 * residual sample and the byte quantisation in one traversal avoids two extra
 * full-image copies of a several-megapixel buffer.
 */
export function renderResidualToSrgbBytes(
  lut: ResidualLut,
  samples: Float32Array,
  bytes: Uint8Array,
  toSrgb: (value: number) => number,
): void {
  const { dimension, data } = lut;
  const plane = dimension * dimension;
  const denominator = dimension - 1;
  for (let offset = 0; offset + 2 < samples.length; offset += 3) {
    const redCoordinate = clamp01(samples[offset]) * denominator;
    const greenCoordinate = clamp01(samples[offset + 1]) * denominator;
    const blueCoordinate = clamp01(samples[offset + 2]) * denominator;
    const red0 = Math.floor(redCoordinate);
    const green0 = Math.floor(greenCoordinate);
    const blue0 = Math.floor(blueCoordinate);
    const redWeight = redCoordinate - red0;
    const greenWeight = greenCoordinate - green0;
    const blueWeight = blueCoordinate - blue0;
    const redLow = 1 - redWeight;
    const greenLow = 1 - greenWeight;
    const blueLow = 1 - blueWeight;
    // 边界上「下一个格点」并不存在，权重为 0；用 step=0 让它读回自身，
    // 否则最后一个格点会越界读到 undefined，乘 0 得到 NaN。
    const redStep = red0 === denominator ? 0 : 3;
    const greenStep = green0 === denominator ? 0 : dimension * 3;
    const blueStep = blue0 === denominator ? 0 : plane * 3;
    const base000 = (plane * blue0 + green0 * dimension + red0) * 3;
    const base001 = base000 + redStep;
    const base010 = base000 + greenStep;
    const base011 = base010 + redStep;
    const base100 = base000 + blueStep;
    const base101 = base100 + redStep;
    const base110 = base100 + greenStep;
    const base111 = base110 + redStep;
    const weight000 = blueLow * greenLow * redLow;
    const weight001 = blueLow * greenLow * redWeight;
    const weight010 = blueLow * greenWeight * redLow;
    const weight011 = blueLow * greenWeight * redWeight;
    const weight100 = blueWeight * greenLow * redLow;
    const weight101 = blueWeight * greenLow * redWeight;
    const weight110 = blueWeight * greenWeight * redLow;
    const weight111 = blueWeight * greenWeight * redWeight;
    for (let channel = 0; channel < 3; channel += 1) {
      const residual =
        data[base000 + channel] * weight000 +
        data[base001 + channel] * weight001 +
        data[base010 + channel] * weight010 +
        data[base011 + channel] * weight011 +
        data[base100 + channel] * weight100 +
        data[base101 + channel] * weight101 +
        data[base110 + channel] * weight110 +
        data[base111 + channel] * weight111;
      const value = toSrgb(samples[offset + channel] + residual);
      bytes[offset + channel] = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255);
    }
  }
}

export interface CubeOptions {
  title?: string;
  comments?: readonly string[];
  /** Clamp the baked output, e.g. `[0, 1]` for a display-referred export. */
  outputLimits?: readonly [number, number];
}

/** Serialise a residual volume as a Resolve-compatible `.cube` document. */
export function writeCubeText(lut: ResidualLut, options: CubeOptions = {}): string {
  const { dimension, data } = lut;
  const denominator = dimension - 1;
  const limits = options.outputLimits;
  if (limits && limits[0] > limits[1]) throw new Error("LUT_OUTPUT_LIMITS_INVALID");
  const lines: string[] = ["# Generated by RefCanvas reference matching"];
  for (const comment of options.comments ?? []) lines.push(`# ${comment}`);
  lines.push(
    `TITLE "${(options.title ?? "Reference match").replaceAll('"', "'")}"`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
    `LUT_3D_SIZE ${dimension}`,
    "",
  );
  const format = (value: number): string => {
    const bounded = limits ? Math.max(limits[0], Math.min(limits[1], value)) : value;
    return bounded.toFixed(7);
  };
  const plane = dimension * dimension;
  for (let blue = 0; blue < dimension; blue += 1) {
    const blueValue = blue / denominator;
    for (let green = 0; green < dimension; green += 1) {
      const greenValue = green / denominator;
      for (let red = 0; red < dimension; red += 1) {
        const offset = (plane * blue + green * dimension + red) * 3;
        const redValue = red / denominator;
        lines.push(
          `${format(redValue + data[offset])} ${format(greenValue + data[offset + 1])} ${format(blueValue + data[offset + 2])}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
