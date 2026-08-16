import { open } from "node:fs/promises";
import path from "node:path";

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
 * 返回 null（调用方回退 Blender 渲染）。
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
      if (code === "TEST" && size > 12) {
        const payload = Buffer.alloc(size);
        const { bytesRead: payloadRead } = await handle.read(payload, 0, size, offset + 24);
        if (payloadRead < size) return null;
        const rectx = payload.readInt32LE(4);
        const recty = payload.readInt32LE(8);
        if (rectx <= 0 || recty <= 0 || rectx > 8192 || recty > 8192) return null;
        // 12 字节头 + 像素数据；块内剩余空间必须能容纳像素。
        if (size - 12 < rectx * recty * 4) return null;
        // 忽略 previewSize 与像素布局的细微差异，直接按 rect 读取。
        return { pixels: payload.subarray(12, 12 + rectx * recty * 4), rectx, recty };
      }
      offset += 24 + size;
    }
    return null;
  } finally {
    await handle.close();
  }
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

/** 根据扩展名判断是否尝试内嵌预览（仅 .blend；.abc 无此机制）。 */
export function hasEmbeddedPreviewSupport(extension: string): boolean {
  return path.extname(extension).toLowerCase() === ".blend" ||
    extension.toLowerCase() === "blend";
}
