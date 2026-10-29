/**
 * Colour-management transforms for the LUT input domains that DaVinci Resolve
 * actually uses.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match). Matrices and transfer
 * functions are taken from the published specifications:
 *
 * - DaVinci Wide Gamut + DaVinci Intermediate, Blackmagic Design, rev 1.1.
 * - S-Log3 / S-Gamut3 / S-Gamut3.Cine, Sony "Technical Summary for
 *   S-Gamut3.Cine/S-Log3 and S-Gamut3/S-Log3".
 *
 * The matching model itself always works in a Rec.709 Gamma 2.4 display
 * domain, because that is what the reference image and the human eye agree on.
 * A LUT that will sit in a DWG + DI node or on native S-Log3 footage therefore
 * needs the same look re-expressed in that domain, which is what the `bake*`
 * helpers below do.
 */

import {
  clamp01,
  linearToRec709Gamma24,
  linearToSrgb,
  rec709Gamma24ToLinear,
  type Oklab,
} from "./colour";
import {
  createIdentityLattice,
  createResidualLut,
  sampleResidual,
  type ResidualLut,
} from "./residual-lut";

export type MatchWorkspace = "rec709" | "dwg" | "slog3";
export type Slog3Gamut = "sgamut3-cine" | "sgamut3";
export type Slog3InputRange = "full" | "video";

type Rgb = [number, number, number];
type Matrix = readonly [Rgb, Rgb, Rgb];

const REC709_TO_XYZ: Matrix = [
  [0.4123908, 0.35758434, 0.18048079],
  [0.21263901, 0.71516868, 0.07219232],
  [0.01933082, 0.11919478, 0.95053215],
];
const XYZ_TO_REC709: Matrix = [
  [3.24096994, -1.53738318, -0.49861076],
  [-0.96924364, 1.8759675, 0.04155506],
  [0.05563008, -0.20397696, 1.05697151],
];
const DWG_TO_XYZ: Matrix = [
  [0.70062239, 0.14877482, 0.10105872],
  [0.27411851, 0.8736319, -0.14775041],
  [-0.09896291, -0.13789533, 1.32591599],
];
const XYZ_TO_DWG: Matrix = [
  [1.51667204, -0.28147805, -0.14696363],
  [-0.4649171, 1.25142378, 0.17488461],
  [0.06484905, 0.10913934, 0.76141462],
];
const S_GAMUT3_TO_XYZ: Matrix = [
  [0.7064827132, 0.1288010498, 0.1151721641],
  [0.2709796708, 0.7866064112, -0.057586082],
  [-0.0096778454, 0.0046000375, 1.0941355587],
];
const S_GAMUT3_CINE_TO_XYZ: Matrix = [
  [0.5990839208, 0.2489255161, 0.1024464902],
  [0.2150758201, 0.8850685017, -0.1001443219],
  [-0.0320658495, -0.0276583907, 1.148781991],
];

const SLOG3_LINEAR_CUT = 0.01125;
const SLOG3_LOG_CUT = 171.2102946929 / 1023;
const SLOG3_BLACK_CODE = 95;
const SLOG3_MID_GREY_CODE = 420;
const SLOG3_LOG_SLOPE = 261.5;
const SLOG3_TOE_CODE = 171.2102946929;
const VIDEO_RANGE_MIN = 64 / 1023;
const VIDEO_RANGE_MAX = 940 / 1023;

const DI_A = 0.0075;
const DI_B = 7;
const DI_C = 0.07329248;
const DI_M = 10.44426855;
const DI_LINEAR_CUT = 0.00262409;
const DI_LOG_CUT = 0.02740668;

/**
 * Measured Resolve DWG/DI -> Rec.709 Gamma 2.4 output response.
 *
 * The active Resolve output chain adds a smooth display roll-off on top of the
 * mathematically direct conversion. These paired luminance knots model that
 * response, so a DWG LUT can be precompensated with their inverse and the app
 * preview can show the post-output image the editor will actually see.
 */
const RESOLVE_709_CALIBRATION_INPUT = [
  0.013008, 0.082726, 0.095465, 0.110166, 0.130877, 0.165866, 0.206379, 0.311328,
  0.428005, 0.534343, 0.697033, 0.805503, 1.161946, 1.340291, 1.689948,
];
const RESOLVE_709_CALIBRATION_OUTPUT = [
  0.009959, 0.018216, 0.025439, 0.03525, 0.051845, 0.085751, 0.129193, 0.244167,
  0.362749, 0.459052, 0.583667, 0.651135, 0.800904, 0.849449, 0.903124,
];

function multiply(matrix: Matrix, values: Rgb): Rgb {
  return [
    matrix[0][0] * values[0] + matrix[0][1] * values[1] + matrix[0][2] * values[2],
    matrix[1][0] * values[0] + matrix[1][1] * values[1] + matrix[1][2] * values[2],
    matrix[2][0] * values[0] + matrix[2][1] * values[1] + matrix[2][2] * values[2],
  ];
}

function signedPower(value: number, exponent: number): number {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

export function davinciIntermediateToLinear(value: number): number {
  return value <= DI_LOG_CUT ? value / DI_M : 2 ** (value / DI_C - DI_B) - DI_A;
}

export function linearToDavinciIntermediate(value: number): number {
  return value <= DI_LINEAR_CUT ? value * DI_M : (Math.log2(Math.max(value + DI_A, 1e-12)) + DI_B) * DI_C;
}

/** Rec.709 Gamma 2.4 display code values -> DaVinci Intermediate. */
export function rec709Gamma24ToDwgIntermediate(red: number, green: number, blue: number): Rgb {
  const linear = multiply(REC709_TO_XYZ, [
    rec709Gamma24ToLinear(red),
    rec709Gamma24ToLinear(green),
    rec709Gamma24ToLinear(blue),
  ]);
  const intermediate = multiply(XYZ_TO_DWG, linear);
  return [
    linearToDavinciIntermediate(intermediate[0]),
    linearToDavinciIntermediate(intermediate[1]),
    linearToDavinciIntermediate(intermediate[2]),
  ];
}

/** DaVinci Intermediate code values -> Rec.709 Gamma 2.4 display code values. */
export function dwgIntermediateToRec709Gamma24(red: number, green: number, blue: number): Rgb {
  const linear = multiply(DWG_TO_XYZ, [
    davinciIntermediateToLinear(red),
    davinciIntermediateToLinear(green),
    davinciIntermediateToLinear(blue),
  ]);
  const rec709 = multiply(XYZ_TO_REC709, linear);
  return [
    linearToRec709Gamma24(rec709[0]),
    linearToRec709Gamma24(rec709[1]),
    linearToRec709Gamma24(rec709[2]),
  ];
}

export function dwgIntermediateToSrgb(red: number, green: number, blue: number): Rgb {
  const display = dwgIntermediateToRec709Gamma24(red, green, blue);
  return [linearToSrgb(rec709Gamma24ToLinear(display[0])), linearToSrgb(rec709Gamma24ToLinear(display[1])), linearToSrgb(rec709Gamma24ToLinear(display[2]))];
}

/** Normalized 10-bit legal-range code values -> full-range code values. */
export function videoRangeToFull(value: number): number {
  return (value - VIDEO_RANGE_MIN) / (VIDEO_RANGE_MAX - VIDEO_RANGE_MIN);
}

/** Decode normalized S-Log3 code values into scene-linear reflection. */
export function slog3ToLinear(value: number): number {
  if (value >= SLOG3_LOG_CUT) {
    return 10 ** ((value * 1023 - SLOG3_MID_GREY_CODE) / SLOG3_LOG_SLOPE) * 0.19 - 0.01;
  }
  return ((value * 1023 - SLOG3_BLACK_CODE) * SLOG3_LINEAR_CUT) / (SLOG3_TOE_CODE - SLOG3_BLACK_CODE);
}

function slog3GamutMatrix(gamut: Slog3Gamut): Matrix {
  return gamut === "sgamut3" ? S_GAMUT3_TO_XYZ : S_GAMUT3_CINE_TO_XYZ;
}

/**
 * Map scene-linear S-Log3 highlights into an SDR Rec.709 display range.
 *
 * Values up to 90% reflection pass unchanged; above that one smooth,
 * luminance-preserving knee compresses the shoulder. This is the restoration
 * half of the analytical S-Log3 baseline; matching happens afterwards in the
 * display domain.
 */
function slog3SdrHighlightRolloff(linearRec709: Rgb): Rgb {
  const luminance =
    linearRec709[0] * 0.2126 + linearRec709[1] * 0.7152 + linearRec709[2] * 0.0722;
  const safe = Math.max(luminance, 1e-6);
  const shoulder = 0.9 + 0.1 * (1 - Math.exp(-Math.max(safe - 0.9, 0) / 0.9));
  const mapped = luminance > 0.9 ? shoulder : luminance;
  const gain = mapped / safe;
  return [linearRec709[0] * gain, linearRec709[1] * gain, linearRec709[2] * gain];
}

/** Analytical S-Log3 -> Rec.709 Gamma 2.4 restoration. */
export function slog3ToRec709Gamma24(
  red: number,
  green: number,
  blue: number,
  options: { gamut: Slog3Gamut; inputRange: Slog3InputRange },
): Rgb {
  const expand = (value: number) => (options.inputRange === "full" ? value : videoRangeToFull(value));
  const linearSgamut: Rgb = [
    slog3ToLinear(expand(red)),
    slog3ToLinear(expand(green)),
    slog3ToLinear(expand(blue)),
  ];
  const xyz = multiply(slog3GamutMatrix(options.gamut), linearSgamut);
  const rec709 = slog3SdrHighlightRolloff(multiply(XYZ_TO_REC709, xyz));
  return [
    clamp01(linearToRec709Gamma24(rec709[0])),
    clamp01(linearToRec709Gamma24(rec709[1])),
    clamp01(linearToRec709Gamma24(rec709[2])),
  ];
}

/** Whether the input pair exactly matches Sony's shipped Cine/Full Look Profile. */
export function usesSonyLc709Baseline(gamut: Slog3Gamut, inputRange: Slog3InputRange): boolean {
  return gamut === "sgamut3-cine" && inputRange === "full";
}

/**
 * S-Log3 -> display match domain.
 *
 * Cine/Full prefers Sony's own LC-709 Look Profile when the caller has that
 * cube on disk; every other combination (and a missing cube) falls back to the
 * analytical Rec.709 Gamma 2.4 restoration rather than misapplying a Cine/Full
 * LUT to a different gamut or range.
 */
export function slog3ToDisplayMatchDomain(
  red: number,
  green: number,
  blue: number,
  options: { gamut: Slog3Gamut; inputRange: Slog3InputRange; sonyBaseline?: ResidualLut | null },
): Rgb {
  if (usesSonyLc709Baseline(options.gamut, options.inputRange) && options.sonyBaseline) {
    const residual = sampleResidual(options.sonyBaseline, red, green, blue);
    return [clamp01(red + residual[0]), clamp01(green + residual[1]), clamp01(blue + residual[2])];
  }
  return slog3ToRec709Gamma24(red, green, blue, options);
}

/** One monotonic curve evaluated with linear extrapolation only at its ends. */
function piecewiseCurve(value: number, inputs: number[], outputs: number[]): number {
  const last = inputs.length - 1;
  if (value <= inputs[0]) {
    return outputs[0] + ((value - inputs[0]) * (outputs[1] - outputs[0])) / (inputs[1] - inputs[0]);
  }
  if (value >= inputs[last]) {
    return (
      outputs[last] +
      ((value - inputs[last]) * (outputs[last] - outputs[last - 1])) / (inputs[last] - inputs[last - 1])
    );
  }
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (inputs[middle] <= value) low = middle;
    else high = middle;
  }
  const span = inputs[high] - inputs[low];
  if (span <= 0) return outputs[low];
  return outputs[low] + ((value - inputs[low]) * (outputs[high] - outputs[low])) / span;
}

/** Fade the output calibration in only once usable SDR shadow detail begins. */
function resolveCalibrationGate(luminance: number): number {
  const fraction = clamp01((luminance - 0.015) / (0.08 - 0.015));
  return fraction * fraction * (3 - 2 * fraction);
}

function codeLuminance(values: Rgb): number {
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

/** Model the measured Resolve DWG -> Rec.709 output response (app preview). */
export function resolveDwgToRec709Gamma24(red: number, green: number, blue: number): Rgb {
  const direct = dwgIntermediateToRec709Gamma24(red, green, blue);
  const luminance = codeLuminance(direct);
  const safe = Math.max(luminance, 0.015);
  const resolved = piecewiseCurve(safe, RESOLVE_709_CALIBRATION_INPUT, RESOLVE_709_CALIBRATION_OUTPUT);
  const target = clamp01(resolved / safe);
  const gain = 1 + (target - 1) * resolveCalibrationGate(luminance);
  return [direct[0] * gain, direct[1] * gain, direct[2] * gain];
}

/**
 * Precompensate DWG/DI values so Resolve's measured output reaches the direct
 * look. The gain is bounded to [1, 2] so lattice corners that no SDR reference
 * can measure stay physically stable inside a Resolve cube.
 */
export function precompensateDwgForResolveRec709(red: number, green: number, blue: number): Rgb {
  const direct = dwgIntermediateToRec709Gamma24(red, green, blue);
  const luminance = codeLuminance(direct);
  const safe = Math.max(luminance, 0.015);
  const required = piecewiseCurve(safe, RESOLVE_709_CALIBRATION_OUTPUT, RESOLVE_709_CALIBRATION_INPUT);
  const gain = Math.min(Math.max(required / safe, 1), 2);
  const gated = 1 + (gain - 1) * resolveCalibrationGate(luminance);
  return rec709Gamma24ToDwgIntermediate(direct[0] * gated, direct[1] * gated, direct[2] * gated);
}

/** Apply the Resolve-output inverse curve to the final values of a DI residual LUT. */
export function precompensateDwgLutResidualForResolveRec709(lut: ResidualLut): ResidualLut {
  const identity = createIdentityLattice(lut.dimension);
  const result = new Float32Array(lut.data.length);
  for (let offset = 0; offset < lut.data.length; offset += 3) {
    const compensated = precompensateDwgForResolveRec709(
      identity[offset] + lut.data[offset],
      identity[offset + 1] + lut.data[offset + 1],
      identity[offset + 2] + lut.data[offset + 2],
    );
    result[offset] = compensated[0] - identity[offset];
    result[offset + 1] = compensated[1] - identity[offset + 1];
    result[offset + 2] = compensated[2] - identity[offset + 2];
  }
  return createResidualLut(lut.dimension, result);
}

/**
 * Bake an SDR display-domain residual into a DWG/DI residual LUT.
 *
 * A DWG cube also contains wide-gamut and HDR coordinates that no SDR
 * reference image can describe. Normal-luminance wide-gamut colours still get
 * the display look (a saturated green can sit outside Rec.709 primaries
 * without being HDR), while luminance outside the SDR viewing range fades back
 * to identity so genuine DI headroom is preserved.
 */
export function bakeDwgIntermediateResidual(displayResidual: ResidualLut, dimension: number): ResidualLut {
  if (displayResidual.dimension !== dimension) throw new Error("LUT_DIMENSION_MISMATCH");
  const identity = createIdentityLattice(dimension);
  const result = new Float32Array(identity.length);
  for (let offset = 0; offset < identity.length; offset += 3) {
    const display = dwgIntermediateToRec709Gamma24(
      identity[offset],
      identity[offset + 1],
      identity[offset + 2],
    );
    const clamped: Rgb = [clamp01(display[0]), clamp01(display[1]), clamp01(display[2])];
    const residual = sampleResidual(displayResidual, clamped[0], clamped[1], clamped[2]);
    const luminance = codeLuminance(display);
    const shadowGate = clamp01((luminance + 0.08) / 0.08);
    const highlightGate = clamp01((1.18 - luminance) / 0.18);
    const gate = shadowGate * highlightGate;
    const outputDisplay: Rgb = [
      display[0] + residual[0] * gate,
      display[1] + residual[1] * gate,
      display[2] + residual[2] * gate,
    ];
    const encoded = rec709Gamma24ToDwgIntermediate(
      outputDisplay[0],
      outputDisplay[1],
      outputDisplay[2],
    );
    result[offset] = clamp01(encoded[0]) - identity[offset];
    result[offset + 1] = clamp01(encoded[1]) - identity[offset + 1];
    result[offset + 2] = clamp01(encoded[2]) - identity[offset + 2];
  }
  return createResidualLut(dimension, result);
}

/**
 * Bake an SDR display residual into a direct S-Log3 -> display residual LUT.
 *
 * Each S-Log3 lattice position is restored through the selected display
 * baseline, receives the same residual the preview uses, and is written back as
 * its final display RGB value. No extra colour-space node is needed after the
 * exported cube.
 */
export function bakeSlog3ToRec709Residual(
  displayResidual: ResidualLut,
  dimension: number,
  options: { gamut: Slog3Gamut; inputRange: Slog3InputRange; sonyBaseline?: ResidualLut | null },
): ResidualLut {
  if (displayResidual.dimension !== dimension) throw new Error("LUT_DIMENSION_MISMATCH");
  const identity = createIdentityLattice(dimension);
  const result = new Float32Array(identity.length);
  for (let offset = 0; offset < identity.length; offset += 3) {
    const restored = slog3ToDisplayMatchDomain(
      identity[offset],
      identity[offset + 1],
      identity[offset + 2],
      options,
    );
    const residual = sampleResidual(displayResidual, restored[0], restored[1], restored[2]);
    result[offset] = clamp01(restored[0] + residual[0]) - identity[offset];
    result[offset + 1] = clamp01(restored[1] + residual[1]) - identity[offset + 1];
    result[offset + 2] = clamp01(restored[2] + residual[2]) - identity[offset + 2];
  }
  return createResidualLut(dimension, result);
}

/** Oklab view of DWG/DI code values, used by the direct DWG lattice fit. */
export function dwgIntermediateToOklab(red: number, green: number, blue: number): Oklab {
  const linear = multiply(DWG_TO_XYZ, [
    davinciIntermediateToLinear(red),
    davinciIntermediateToLinear(green),
    davinciIntermediateToLinear(blue),
  ]);
  const rec709 = multiply(XYZ_TO_REC709, linear);
  return linearRec709ToOklab(rec709);
}

/** Inverse of {@link dwgIntermediateToOklab}. */
export function oklabToDwgIntermediate(lightness: number, axisA: number, axisB: number): Rgb {
  const rec709 = oklabToLinearRec709(lightness, axisA, axisB);
  const linear = multiply(REC709_TO_XYZ, rec709);
  const intermediate = multiply(XYZ_TO_DWG, linear);
  return [
    linearToDavinciIntermediate(intermediate[0]),
    linearToDavinciIntermediate(intermediate[1]),
    linearToDavinciIntermediate(intermediate[2]),
  ];
}

/** Rec.709 Gamma 2.4 display values -> DWG/DI code values. */
export function displayToDwgIntermediate(red: number, green: number, blue: number): Rgb {
  const linear = multiply(REC709_TO_XYZ, [
    signedPower(red, 2.4),
    signedPower(green, 2.4),
    signedPower(blue, 2.4),
  ]);
  const intermediate = multiply(XYZ_TO_DWG, linear);
  return [
    linearToDavinciIntermediate(intermediate[0]),
    linearToDavinciIntermediate(intermediate[1]),
    linearToDavinciIntermediate(intermediate[2]),
  ];
}

// Oklab conversions live here rather than in `colour.ts` because they are
// linear-light (not display-gamma) based; `colour.ts` owns the display-domain
// pair the rest of the matcher uses.
const LINEAR_TO_LMS: Matrix = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB: Matrix = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const OKLAB_TO_LMS: Matrix = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];
const LMS_TO_LINEAR: Matrix = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

function linearRec709ToOklab(linear: Rgb): Oklab {
  const lms = multiply(LINEAR_TO_LMS, linear);
  const lab = multiply(LMS_TO_OKLAB, [
    Math.cbrt(lms[0]),
    Math.cbrt(lms[1]),
    Math.cbrt(lms[2]),
  ]);
  return { l: lab[0], a: lab[1], b: lab[2] };
}

function oklabToLinearRec709(lightness: number, axisA: number, axisB: number): Rgb {
  const lms = multiply(OKLAB_TO_LMS, [lightness, axisA, axisB]);
  return multiply(LMS_TO_LINEAR, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

/**
 * Parse Sony's bundled S-Log3/S-Gamut3.Cine -> LC-709 Look Profile cube into a
 * residual volume. The file is not redistributable, so it is optional: the
 * caller supplies it from disk when present.
 */
export function parseBaselineCube(text: string): ResidualLut {
  let dimension = 0;
  const rows: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length === 2 && fields[0] === "LUT_3D_SIZE") {
      dimension = Number.parseInt(fields[1], 10);
      continue;
    }
    if (fields.length !== 3) continue;
    const values = fields.map((field) => Number.parseFloat(field));
    if (values.some((value) => !Number.isFinite(value))) continue;
    rows.push(values[0], values[1], values[2]);
  }
  if (dimension < 2 || rows.length !== dimension * dimension * dimension * 3) {
    throw new Error("BASELINE_CUBE_INVALID");
  }
  // Cube rows are final values with red changing fastest; store the residual in
  // [channel][blue][green][red] order so the shared sampler can read it.
  const identity = createIdentityLattice(dimension);
  const residual = new Float32Array(rows.length);
  const plane = dimension * dimension;
  for (let blue = 0; blue < dimension; blue += 1) {
    for (let green = 0; green < dimension; green += 1) {
      for (let red = 0; red < dimension; red += 1) {
        const rowIndex = ((blue * dimension + green) * dimension + red) * 3;
        const target = (blue * plane + green * dimension + red) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          residual[target + channel] = rows[rowIndex + channel] - identity[target + channel];
        }
      }
    }
  }
  return createResidualLut(dimension, residual);
}
