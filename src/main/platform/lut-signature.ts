import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * 无 LUT 或 LUT 不可用时的签名。空串让缓存键保持旧形态，
 * 避免升级后把所有历史缩略图缓存一次性作废。
 */
export const NO_LUT_SIGNATURE = "";

/**
 * 当前 3D LUT 的短缓存签名（路径 + mtime + size 的 sha256 前 10 位）。
 * 任一项变化都会换 key：用户替换同名 LUT 文件时也能自动失效。
 * 路径不存在/不是普通文件视为无 LUT。
 */
export async function lutCacheSignature(
  lutPath: string | null | undefined,
): Promise<string> {
  if (!lutPath) return NO_LUT_SIGNATURE;
  const info = await stat(lutPath).catch(() => null);
  if (!info?.isFile()) return NO_LUT_SIGNATURE;
  return createHash("sha256")
    .update(`${path.normalize(lutPath)}:${info.mtimeMs}:${info.size}`)
    .digest("hex")
    .slice(0, 10);
}
