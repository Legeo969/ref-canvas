import { open } from "node:fs/promises";

/**
 * PSD/PSB 文件头解析（阶段 4：专业格式）。
 *
 * 只读头部结构：版本（PSD/PSB）、通道数、位深、色彩模式、画布尺寸、
 * 图层数量。不解码像素（composite 渲染走 ffmpeg psd 解码器）。
 */

export interface PsdHeaderInfo {
  valid: boolean;
  error: string | null;
  /** 1 = PSD，2 = PSB（Large Document Format）。 */
  version: number | null;
  channels: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  colorMode: string | null;
  /** layer/mask 段中声明的图层数（负值含 alpha 通道信息）。 */
  layerCount: number | null;
  /** 是否存在 layer/mask 段（有图层结构）。 */
  hasLayers: boolean;
}

const COLOR_MODES: Record<number, string> = {
  0: "Bitmap",
  1: "Grayscale",
  2: "Indexed",
  3: "RGB",
  4: "CMYK",
  7: "Multichannel",
  8: "Duotone",
  9: "Lab",
};

export async function parsePsdHeader(filename: string): Promise<PsdHeaderInfo> {
  let file;
  try {
    file = await open(filename, "r");
  } catch {
    return { valid: false, error: "READ_FAILED", version: null, channels: null, height: null, width: null, depth: null, colorMode: null, layerCount: null, hasLayers: false };
  }
  try {
    const header = Buffer.alloc(26);
    const { bytesRead } = await file.read(header, 0, 26, 0);
    if (bytesRead < 4 || header.toString("latin1", 0, 4) !== "8BPS") {
      return { valid: false, error: "NOT_PSD", version: null, channels: null, height: null, width: null, depth: null, colorMode: null, layerCount: null, hasLayers: false };
    }
    if (bytesRead < 26) {
      return { valid: false, error: "TRUNCATED_HEADER", version: null, channels: null, height: null, width: null, depth: null, colorMode: null, layerCount: null, hasLayers: false };
    }
    const version = header.readUInt16BE(4);
    if (version !== 1 && version !== 2) {
      return { valid: false, error: `UNSUPPORTED_VERSION:${version}`, version, channels: null, height: null, width: null, depth: null, colorMode: null, layerCount: null, hasLayers: false };
    }
    const channels = header.readUInt16BE(12);
    const height = header.readUInt32BE(14);
    const width = header.readUInt32BE(18);
    const depth = header.readUInt16BE(22);
    const colorModeCode = header.readUInt16BE(24);

    // 跳过三个变长段：color mode data、image resources、layer/mask。
    // PSD 段长度 4 字节，PSB 段长度 8 字节。
    const lengthBytes = version === 2 ? 8 : 4;
    let offset = 26;
    for (let section = 0; section < 3; section += 1) {
      const lengthBuffer = Buffer.alloc(lengthBytes);
      const read = await file.read(lengthBuffer, 0, lengthBytes, offset);
      if (read.bytesRead < lengthBytes) {
        return { valid: false, error: "TRUNCATED_SECTIONS", version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: null, hasLayers: false };
      }
      const sectionLength =
        lengthBytes === 8
          ? Number(lengthBuffer.readBigUInt64BE(0))
          : lengthBuffer.readUInt32BE(0);
      offset += lengthBytes + sectionLength;
      if (section === 2) {
        // layer/mask 段：若长度 > 0，读取 layer info 长度 + layer count。
        if (sectionLength <= 0) {
          return { valid: true, error: null, version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: 0, hasLayers: false };
        }
        const layerInfoLengthBuffer = Buffer.alloc(lengthBytes);
        const layerInfoRead = await file.read(layerInfoLengthBuffer, 0, lengthBytes, offset);
        if (layerInfoRead.bytesRead < lengthBytes) {
          return { valid: false, error: "TRUNCATED_LAYER_INFO", version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: null, hasLayers: true };
        }
        const layerInfoLength =
          lengthBytes === 8
            ? Number(layerInfoLengthBuffer.readBigUInt64BE(0))
            : layerInfoLengthBuffer.readUInt32BE(0);
        if (layerInfoLength <= 0) {
          return { valid: true, error: null, version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: 0, hasLayers: true };
        }
        // layer count：PSD 2 字节有符号，PSB 4 字节有符号。
        const countBytes = version === 2 ? 4 : 2;
        const countBuffer = Buffer.alloc(countBytes);
        const countRead = await file.read(countBuffer, 0, countBytes, offset + lengthBytes);
        if (countRead.bytesRead < countBytes) {
          return { valid: false, error: "TRUNCATED_LAYER_COUNT", version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: null, hasLayers: true };
        }
        const layerCount =
          countBytes === 4 ? countBuffer.readInt32BE(0) : countBuffer.readInt16BE(0);
        return { valid: true, error: null, version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: Math.abs(layerCount), hasLayers: true };
      }
    }
    return { valid: true, error: null, version, channels, height, width, depth, colorMode: COLOR_MODES[colorModeCode] ?? `UNKNOWN(${colorModeCode})`, layerCount: null, hasLayers: false };
  } finally {
    await file.close();
  }
}
