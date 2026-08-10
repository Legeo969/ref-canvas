export interface PaletteColor {
  rgb: [number, number, number];
  hex: string;
  count: number;
}

function hex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** Fast deterministic palette extraction for preview-sized RGBA buffers. */
export function extractDominantPalette(
  data: Uint8Array | Uint8ClampedArray,
  limit = 6,
): PaletteColor[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index + 3 < data.length; index += 4) {
    if (data[index + 3] < 96) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  return [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.max(1, limit))
    .map((item) => {
      const rgb: [number, number, number] = [
        Math.round(item.r / item.count),
        Math.round(item.g / item.count),
        Math.round(item.b / item.count),
      ];
      return {
        rgb,
        hex: `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`,
        count: item.count,
      };
    });
}
