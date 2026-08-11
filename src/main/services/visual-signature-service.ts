import sharp from "sharp";

export interface VisualSignature {
  visualHash: string;
  colorSignature: string;
  dominantColor: { r: number; g: number; b: number };
}

export async function imageVisualSignature(filename: string): Promise<VisualSignature> {
  const source = sharp(filename, { animated: false, failOn: "none" }).rotate();
  const [gray, color] = await Promise.all([
    source.clone().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer(),
    source
      .clone()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(4, 4, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      hash <<= 1n;
      if (gray[y * 9 + x] > gray[y * 9 + x + 1]) hash |= 1n;
    }
  }
  const channels = color.info.channels;
  const rgb = Buffer.alloc(48);
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let pixel = 0; pixel < 16; pixel += 1) {
    rgb[pixel * 3] = color.data[pixel * channels];
    rgb[pixel * 3 + 1] = color.data[pixel * channels + Math.min(1, channels - 1)];
    rgb[pixel * 3 + 2] = color.data[pixel * channels + Math.min(2, channels - 1)];
    red += rgb[pixel * 3];
    green += rgb[pixel * 3 + 1];
    blue += rgb[pixel * 3 + 2];
  }
  return {
    visualHash: hash.toString(16).padStart(16, "0"),
    colorSignature: rgb.toString("base64"),
    dominantColor: {
      r: Math.round(red / 16),
      g: Math.round(green / 16),
      b: Math.round(blue / 16),
    },
  };
}

function hammingDistance(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

export function visualSimilarity(
  left: Pick<VisualSignature, "visualHash" | "colorSignature">,
  right: Pick<VisualSignature, "visualHash" | "colorSignature">,
): number {
  const structureDifference = hammingDistance(left.visualHash, right.visualHash) / 64;
  const leftColor = Buffer.from(left.colorSignature, "base64");
  const rightColor = Buffer.from(right.colorSignature, "base64");
  const length = Math.min(leftColor.length, rightColor.length);
  if (!length) return 0;
  let colorDifference = 0;
  for (let index = 0; index < length; index += 1) {
    colorDifference += Math.abs(leftColor[index] - rightColor[index]);
  }
  colorDifference /= length * 255;
  return Math.max(
    0,
    Math.min(100, (1 - structureDifference * 0.8 - colorDifference * 0.2) * 100),
  );
}
