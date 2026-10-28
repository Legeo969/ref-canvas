/**
 * Display-transfer and OKLab transforms for reference matching.
 *
 * Ported from the MIT-licensed `reference-match` project (© 2026 xrz,
 * https://github.com/xrz1411/reference-match). The match model works in a
 * Rec.709 Gamma 2.4 display domain; reference images arrive as sRGB, which
 * shares D65 primaries with Rec.709 and only differs in transfer function.
 */

export const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

// Oklab matrices from Björn Ottosson's reference implementation.
const LINEAR_TO_LMS = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619,
  0.2817188376, 0.6299787005,
] as const;
const LMS_TO_OKLAB = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371,
  0.7827717662, -0.808675766,
] as const;
const OKLAB_TO_LMS = [
  1, 0.3963377774, 0.2158037573, 1, -0.1055613458, -0.0638541728, 1, -0.0894841775, -1.291485548,
] as const;
const LMS_TO_LINEAR = [
  4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.707614701,
] as const;

/** Sign-preserving power, matching the upstream `signed_power` helper. */
export function signedPower(value: number, exponent: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 0;
  return value < 0 ? -(magnitude ** exponent) : magnitude ** exponent;
}

export function srgbToLinear(value: number): number {
  const magnitude = Math.abs(value);
  const linear =
    magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4;
  return value < 0 ? -linear : linear;
}

export function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  const encoded =
    magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return value < 0 ? -encoded : encoded;
}

export function linearToRec709Gamma24(value: number): number {
  return signedPower(value, 1 / 2.4);
}

export function rec709Gamma24ToLinear(value: number): number {
  return signedPower(value, 2.4);
}

/**
 * 转换查表：显示域转换要逐通道做两次幂运算，一张 1280px 预览就是 370 万
 * 次 `Math.pow`，滑杆每动一次都要重跑一遍。4097 点表 + 线性插值把误差压
 * 在 1e-6 量级（远低于 8bit 的 1/255）。
 *
 * 近黑区例外：Gamma 2.4 编码在 0 附近斜率无穷大，任何均匀表在那里都会
 * 出 1 个码值的偏差，所以 0.02 以下直接算公式。
 */
const TRANSFER_TABLE_SIZE = 4096;
const TABLE_EXACT_BELOW = 0.02;

function buildTable(transform: (value: number) => number): Float32Array {
  const table = new Float32Array(TRANSFER_TABLE_SIZE + 1);
  for (let index = 0; index <= TRANSFER_TABLE_SIZE; index += 1) {
    table[index] = transform(index / TRANSFER_TABLE_SIZE);
  }
  return table;
}

function lookupTable(table: Float32Array, value: number): number {
  const scaled = clamp01(value) * TRANSFER_TABLE_SIZE;
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const low = table[index];
  return low + (table[Math.min(index + 1, TRANSFER_TABLE_SIZE)] - low) * fraction;
}

let srgbToMatchTable: Float32Array | null = null;
let matchToSrgbTable: Float32Array | null = null;

/** Convert one sRGB-encoded code value into the Rec.709 Gamma 2.4 match domain. */
export function srgbToMatchDomain(value: number): number {
  const bounded = clamp01(value);
  if (bounded < TABLE_EXACT_BELOW) return linearToRec709Gamma24(srgbToLinear(bounded));
  srgbToMatchTable ??= buildTable((sample) => linearToRec709Gamma24(srgbToLinear(sample)));
  return lookupTable(srgbToMatchTable, bounded);
}

/** Convert one match-domain value back to sRGB for display or PNG output. */
export function matchDomainToSrgb(value: number): number {
  const bounded = clamp01(value);
  if (bounded < TABLE_EXACT_BELOW) return linearToSrgb(rec709Gamma24ToLinear(bounded));
  matchToSrgbTable ??= buildTable((sample) => linearToSrgb(rec709Gamma24ToLinear(sample)));
  return lookupTable(matchToSrgbTable, bounded);
}

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

/**
 * Convert one display-domain RGB triplet into Oklab.
 *
 * The decode is a signed gamma 2.4 power, not the sRGB piecewise curve: input
 * values are already Rec.709 Gamma 2.4 display code values.
 */
export function displayRgbToOklab(red: number, green: number, blue: number): Oklab {
  const linearRed = signedPower(red, 2.4);
  const linearGreen = signedPower(green, 2.4);
  const linearBlue = signedPower(blue, 2.4);
  const l = LINEAR_TO_LMS[0] * linearRed + LINEAR_TO_LMS[1] * linearGreen + LINEAR_TO_LMS[2] * linearBlue;
  const m = LINEAR_TO_LMS[3] * linearRed + LINEAR_TO_LMS[4] * linearGreen + LINEAR_TO_LMS[5] * linearBlue;
  const s = LINEAR_TO_LMS[6] * linearRed + LINEAR_TO_LMS[7] * linearGreen + LINEAR_TO_LMS[8] * linearBlue;
  const rootL = Math.cbrt(l);
  const rootM = Math.cbrt(m);
  const rootS = Math.cbrt(s);
  return {
    l: LMS_TO_OKLAB[0] * rootL + LMS_TO_OKLAB[1] * rootM + LMS_TO_OKLAB[2] * rootS,
    a: LMS_TO_OKLAB[3] * rootL + LMS_TO_OKLAB[4] * rootM + LMS_TO_OKLAB[5] * rootS,
    b: LMS_TO_OKLAB[6] * rootL + LMS_TO_OKLAB[7] * rootM + LMS_TO_OKLAB[8] * rootS,
  };
}

/** Convert one Oklab triplet back into display-domain RGB (unclipped). */
export function oklabToDisplayRgb(l: number, a: number, b: number): [number, number, number] {
  const rootL = OKLAB_TO_LMS[0] * l + OKLAB_TO_LMS[1] * a + OKLAB_TO_LMS[2] * b;
  const rootM = OKLAB_TO_LMS[3] * l + OKLAB_TO_LMS[4] * a + OKLAB_TO_LMS[5] * b;
  const rootS = OKLAB_TO_LMS[6] * l + OKLAB_TO_LMS[7] * a + OKLAB_TO_LMS[8] * b;
  const lm = rootL * rootL * rootL;
  const mm = rootM * rootM * rootM;
  const sm = rootS * rootS * rootS;
  const linearRed = LMS_TO_LINEAR[0] * lm + LMS_TO_LINEAR[1] * mm + LMS_TO_LINEAR[2] * sm;
  const linearGreen = LMS_TO_LINEAR[3] * lm + LMS_TO_LINEAR[4] * mm + LMS_TO_LINEAR[5] * sm;
  const linearBlue = LMS_TO_LINEAR[6] * lm + LMS_TO_LINEAR[7] * mm + LMS_TO_LINEAR[8] * sm;
  return [
    signedPower(linearRed, 1 / 2.4),
    signedPower(linearGreen, 1 / 2.4),
    signedPower(linearBlue, 1 / 2.4),
  ];
}

export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

export function luminance(red: number, green: number, blue: number): number {
  return LUMINANCE_WEIGHTS[0] * red + LUMINANCE_WEIGHTS[1] * green + LUMINANCE_WEIGHTS[2] * blue;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const fraction = clamp01((value - edge0) / (edge1 - edge0));
  return fraction * fraction * (3 - 2 * fraction);
}
