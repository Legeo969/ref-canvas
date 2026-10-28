import { open } from "node:fs/promises";

/**
 * .blend 文件内嵌预览图读取（无需启动 Blender）。
 *
 * Blender 保存 .blend 时默认写入一个场景缩略图（TEST 块，BlendFilePreview）：
 * 文件头 12 字节（"BLENDER" + 版本），随后是 24 字节块头
 * （code[4] + size[4] + old[8] + sdna_index[4] + count[4]），TEST 块数据
 * 为 12 字节头（size/rectx/recty 三个 int）+ 原始 BGRA 像素。
 *
 * 对大文件（几百 MB~数 GB）来说这是唯一不吃性能的缩略图路径：只读文件
 * 头几十 KB、不启动 Blender、毫秒级返回；滚轮浏览几十个文件内存零增长。
 * 注意：Blender 4.x 的 zstd 压缩 .blend（magic 28 B5 2F FD）内部块无法
 * 直接定位，必须回退 Blender 渲染。
 */

/** zstd 压缩 .blend 的魔数（Blender 4.x 压缩保存）。 */
export const ZSTD_BLENDER_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export interface BlendEmbeddedPreview {
  /** 原始 BGRA 像素（rectx × recty）。 */
  pixels: Buffer;
  rectx: number;
  recty: number;
}

/** 检测文件是否为 zstd 压缩的 .blend（内部块不可直接寻址）。 */
export async function isZstdCompressedBlend(filename: string): Promise<boolean> {
  const handle = await open(filename, "r");
  try {
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, 4, 0);
    return bytesRead === 4 && magic.equals(ZSTD_BLENDER_MAGIC);
  } finally {
    await handle.close();
  }
}

/**
 * 从普通（未压缩）.blend 读取内嵌预览图。找不到 TEST 块或块不完整时
 * 返回 null（调用方回落图标卡片）。
 *
 * TEST 块头布局随 Blender 版本变过：
 * - 2.80 起：w[4] + h[4]，像素从第 8 字节开始；
 * - 早期版本：previewSize[4] + w[4] + h[4]，像素从第 12 字节开始。
 * 只按 12 字节解会把 width 当成 previewSize、把首个像素的 RGBA 当成
 * height（实测算出 recty = -14671840），整类文件因此静默退回图标卡片。
 */
export async function readBlendEmbeddedPreview(
  filename: string,
): Promise<BlendEmbeddedPreview | null> {
  const handle = await open(filename, "r");
  try {
    const info = await handle.stat();
    // 头部最多扫 32MB（预览块通常紧跟在文件头附近；大场景文件可能
    // 把 GLOB/DNA 等块放在前面，放宽上限避免漏掉 TEST）。
    const scanLimit = Math.min(info.size, 32 * 1024 * 1024);
    const magic = Buffer.alloc(12);
    const { bytesRead } = await handle.read(magic, 0, 12, 0);
    if (bytesRead < 12 || magic.toString("latin1", 0, 7) !== "BLENDER") {
      return null;
    }
    let offset = 12;
    while (offset + 24 <= scanLimit) {
      const header = Buffer.alloc(24);
      const { bytesRead: headerRead } = await handle.read(header, 0, 24, offset);
      if (headerRead < 24) return null;
      const code = header.toString("latin1", 0, 4);
      const size = header.readInt32LE(4);
      if (!/^[A-Za-z0-9]{4}$/.test(code) || size <= 0 || size > 64 * 1024 * 1024) {
        return null;
      }
      if (code === "TEST" && size > 8) {
        const payload = Buffer.alloc(size);
        const { bytesRead: payloadRead } = await handle.read(payload, 0, size, offset + 24);
        if (payloadRead < size) return null;
        return decodeTestBlock(payload, size);
      }
      offset += 24 + size;
    }
    return null;
  } finally {
    await handle.close();
  }
}

/** 按 8 字节（2.80+）或 12 字节（早期）头解析 TEST 块：块长必须精确匹配。 */
function decodeTestBlock(
  payload: Buffer,
  size: number,
): BlendEmbeddedPreview | null {
  const candidates = [
    { headerSize: 8, width: payload.readInt32LE(0), height: payload.readInt32LE(4) },
  ];
  if (size >= 12) {
    candidates.push({
      headerSize: 12,
      width: payload.readInt32LE(4),
      height: payload.readInt32LE(8),
    });
  }
  for (const candidate of candidates) {
    const { headerSize, width, height } = candidate;
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) continue;
    const pixels = width * height * 4;
    // 只认精确匹配：错位布局算出的矩形不可能与块长吻合。
    if (size !== headerSize + pixels) continue;
    return {
      pixels: payload.subarray(headerSize, headerSize + pixels),
      rectx: width,
      recty: height,
    };
  }
  return null;
}

/** BGRA → RGBA（并转换为 PNG 的输入格式）。 */
export function bgraToRgba(pixels: Buffer): Buffer {
  const out = Buffer.alloc(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    out[i] = pixels[i + 2];
    out[i + 1] = pixels[i + 1];
    out[i + 2] = pixels[i];
    out[i + 3] = pixels[i + 3];
  }
  return out;
}

/** 根据扩展名判断是否尝试内嵌预览（.blend 与 .blend1 共用同一 TEST 块；.abc 无此机制）。 */
export function hasEmbeddedPreviewSupport(extension: string): boolean {
  const normalized = extension.toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  const raw = lastDot >= 0 ? normalized.slice(lastDot + 1) : normalized;
  return raw === "blend" || raw === "blend1";
}
