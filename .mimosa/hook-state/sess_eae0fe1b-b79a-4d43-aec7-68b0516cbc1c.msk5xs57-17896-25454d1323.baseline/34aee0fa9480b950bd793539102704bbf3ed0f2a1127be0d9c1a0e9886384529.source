import { open } from "node:fs/promises";

/**
 * Radiance HDR（RGBE）头解析（阶段 3 §9.2）。
 *
 * 头为 ASCII 文本，以空行结束；像素从空行后开始。这里只解析头，
 * 不解码像素（RGBE 像素编码由 thumbnail 管线负责）。
 */

export interface HdrHeaderInfo {
  valid: boolean;
  error: string | null;
  width: number | null;
  height: number | null;
  /** FORMAT 行内容（如 "32-bit_rle_rgbe"）。 */
  format: string | null;
  /** 曝光/色彩相关附加参数（如 EXPOSURE、GAMMA）。 */
  parameters: Record<string, string>;
  /** 头中声明的色彩空间（EXPOSURE/GAMMA 等之外的自定义键）。 */
  colorSpace: string | null;
}

const MAX_HEADER_BYTES = 64 * 1024;

export async function parseHdrHeader(
  filename: string,
): Promise<HdrHeaderInfo> {
  const info: HdrHeaderInfo = {
    valid: false,
    error: null,
    width: null,
    height: null,
    format: null,
    parameters: {},
    colorSpace: null,
  };
  const handle = await open(filename, "r");
  try {
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const view = buffer.subarray(0, bytesRead);
    // 找头结束（\n\n 或 \r\n\r\n）。分辨率行在空行之后。
    let headerEnd = -1;
    let resolutionStart = -1;
    for (let index = 0; index + 3 < view.length; index += 1) {
      if (view[index] === 0x0a && view[index + 1] === 0x0a) {
        headerEnd = index + 2;
        break;
      }
      if (
        view[index] === 0x0d &&
        view[index + 1] === 0x0a &&
        view[index + 2] === 0x0d &&
        view[index + 3] === 0x0a
      ) {
        headerEnd = index + 4;
        break;
      }
    }
    if (headerEnd < 0) {
      info.error = "HDR_HEADER_UNTERMINATED";
      return info;
    }
    // 分辨率行：空行后的下一行。
    const resolutionEnd = view.indexOf(0x0a, headerEnd);
    if (resolutionEnd < 0) {
      info.error = "HDR_RESOLUTION_MISSING";
      return info;
    }
    resolutionStart = headerEnd;
    const resolutionLine = view
      .subarray(resolutionStart, resolutionEnd)
      .toString("latin1")
      .trimEnd();
    const text = view.subarray(0, headerEnd).toString("latin1");
    const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
    // 首行必须是签名（#?RADIANCE 或 #?RGBE）。
    const signature = lines[0] ?? "";
    if (!signature.startsWith("#?RADIANCE") && !signature.startsWith("#?RGBE")) {
      info.error = "HDR_SIGNATURE_MISSING";
      return info;
    }
    for (const line of lines.slice(1)) {
      if (line.length === 0) continue;
      const upper = line.toUpperCase();
      if (upper.startsWith("FORMAT=")) {
        info.format = line.slice(7).trim();
      } else if (upper.startsWith("EXPOSURE=") || upper.startsWith("GAMMA=") || upper.startsWith("COLORCORR=") || upper.startsWith("PRIMARIES=") || upper.startsWith("COLORSPACE=")) {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim().toUpperCase();
        const value = line.slice(separator + 1).trim();
        info.parameters[key] = value;
        if (key === "COLORSPACE") info.colorSpace = value;
      }
    }
    // 分辨率行：[-Y H | +Y H] [+X W | -X W]，Y 先 X 后。
    const parts = resolutionLine.trim().split(/\s+/);
    if (parts.length !== 4 || !/^[+-][XY]$/.test(parts[0]) || !/^[+-][XY]$/.test(parts[2])) {
      info.error = "HDR_RESOLUTION_INVALID";
      return info;
    }
    const height = Number(parts[1]);
    const width = Number(parts[3]);
    if (!Number.isFinite(height) || !Number.isFinite(width) || height <= 0 || width <= 0) {
      info.error = "HDR_RESOLUTION_INVALID";
      return info;
    }
    info.width = width;
    info.height = height;
    info.valid = true;
    return info;
  } finally {
    await handle.close();
  }
}
