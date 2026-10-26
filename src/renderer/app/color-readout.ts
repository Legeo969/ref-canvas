/**
 * 取色结果的纯计算部分：把主进程采样回来的 hex/alpha 转成面板要展示的几组读数。
 * 独立成模块以便单测——不得引入 DOM 或 IPC 依赖。
 */

export interface ColorReadout {
  /** 规范大写 #RRGGBB。 */
  readonly hex: string;
  /** CSS rgb()，与 hex 同源。 */
  readonly rgb: string;
  /** CSS hsl()，色相取整、饱和度与明度保留一位小数。 */
  readonly hsl: string;
  /** 像素 alpha 百分比（主进程返回 0–255）。 */
  readonly alphaPercent: number;
  /** 该底色上可读的文字色（黑或白），按 WCAG 相对亮度取。 */
  readonly contrastHex: string;
}

const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;

/**
 * 解析 #RRGGBB。非法输入返回 null，由调用方决定不展示面板——
 * 不做"兜底成黑色"之类的静默替换，否则用户会把解析失败当成真实取到的颜色。
 */
export function parseHexColor(value: string): [number, number, number] | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const numeric = Number.parseInt(match[1], 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function toHexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

/** sRGB 相对亮度（WCAG 2.1），用于挑对比色。 */
function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** RGB → HSL，色相单位为度，饱和度/明度为百分比。 */
export function rgbToHsl([red, green, blue]: [number, number, number]): {
  h: number;
  s: number;
  l: number;
} {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / delta + 2) * 60;
  else h = ((r - g) / delta + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

/**
 * HSV，供颜色面板的 SV 平面与色相条使用：h ∈ [0,360)，s/v ∈ [0,1]。
 * 面板拖拽直接产出 HSV 再换算回 RGB；不要反向从 hex 推 s/v，
 * 灰度色（s=0）或极值（v=0/1）上会因量化丢位置。
 */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export function rgbToHsv([red, green, blue]: [number, number, number]): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / delta + 2) * 60;
    else h = ((r - g) / delta + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHexColor(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, s));
  const value = Math.max(0, Math.min(1, v));
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = value - chroma;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector];
  return [
    Math.round((r + offset) * 255),
    Math.round((g + offset) * 255),
    Math.round((b + offset) * 255),
  ];
}

export function hsvToHex(hsv: Hsv): string {
  const [red, green, blue] = hsvToRgb(hsv);
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

/** 色相条上手柄的颜色：该色相对应的纯色。 */
export function hueSwatch(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 });
}

export function colorReadoutFromHex(
  hex: string,
  alpha = 255,
): ColorReadout | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const [red, green, blue] = rgb;
  const { h, s, l } = rgbToHsl(rgb);
  const normalizedAlpha = Math.max(0, Math.min(255, Math.round(alpha)));
  return {
    hex: `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`,
    rgb: `rgb(${red}, ${green}, ${blue})`,
    hsl: `hsl(${Math.round(h)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`,
    alphaPercent: Math.round((normalizedAlpha / 255) * 100),
    contrastHex: relativeLuminance(rgb) > 0.5 ? "#000000" : "#FFFFFF",
  };
}

/**
 * 采样点在源文件上的像素坐标。仅当解码尺寸与资产源尺寸一致时才成立：
 * EXR/HDR 走缩略图缓存、视频取首帧，解码尺寸与源尺寸不同，此时坐标
 * 属于缓存图而非源文件，必须返回 null 而不是给出会误导人的数字。
 */
export function sourcePixelFromUv(
  u: number,
  v: number,
  decodedWidth: number,
  decodedHeight: number,
  assetWidth: number | null,
  assetHeight: number | null,
): { x: number; y: number } | null {
  if (!assetWidth || !assetHeight) return null;
  if (decodedWidth !== assetWidth || decodedHeight !== assetHeight) return null;
  if (decodedWidth <= 0 || decodedHeight <= 0) return null;
  return {
    x: Math.min(decodedWidth - 1, Math.max(0, Math.floor(u * decodedWidth))),
    y: Math.min(decodedHeight - 1, Math.max(0, Math.floor(v * decodedHeight))),
  };
}
