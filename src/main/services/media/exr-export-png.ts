import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defaultExrLayer } from "./exr-header";
import { packagedOiiotoolPath } from "./openimageio-tools";

const execFileAsync = promisify(execFile);

export interface ExrSequencePngResult {
  /** 替换后的帧路径（临时 PNG）；与原列表长度一致。 */
  files: string[];
  /** 临时目录，调用方 finally 清理。 */
  tempDirectory: string;
}

/**
 * Unreal MovieRenderQueue 等多层 EXR 常用 PIZ/DWAA 压缩，ffmpeg 内置 EXR
 * 解码器无法解码（decode_block() failed，序列 GIF/MP4 导出生成 0 字节/空白
 * 文件）。此工具在 concat 前用项目自带的 OpenImageIO（oiiotool）逐帧把
 * EXR 解码成临时 PNG，再交给 ffmpeg 合成。
 *
 * 非 EXR 序列、OIIO 侧车缺失或解码失败时返回 null，调用方按原路径（ffmpeg
 * 直读）处理——解码失败不吞错，也不悄悄产出空白产物。
 */
export async function prepareExrSequenceForConcat(
  files: string[],
  maxWidth: number | null,
  signal?: AbortSignal,
): Promise<ExrSequencePngResult | null> {
  if (!files.length) return null;
  if (path.extname(files[0] ?? "").toLowerCase() !== ".exr") return null;
  const oiiotool = await packagedOiiotoolPath();
  if (!oiiotool) return null;

  const layer = await defaultExrLayer(files);
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "refcanvas-exr-seq-"),
  );
  const outputs: string[] = [];
  try {
    // 并发逐帧解码（限制并发，避免大 EXR 同时解码导致内存峰值）。
    const concurrency = 3;
    for (let index = 0; index < files.length; index += concurrency) {
      const batch = files.slice(index, index + concurrency);
      const decoded = await Promise.all(batch.map(async (file) => {
        signal?.throwIfAborted();
        const outputPath = path.join(
          tempDirectory,
          `frame-${randomUUID()}.png`,
        );
        await mkdir(path.dirname(outputPath), { recursive: true });
        // 顶层图层（layer 为空）默认取 R,G,B；命名图层显式选该层 RGB。
        const channelArgs = layer
          ? ["--ch", `${layer}.R,${layer}.G,${layer}.B`]
          : [];
        // 缩放：GIF 传 maxWidth 缩到目标宽；MP4 传 null 保持源尺寸
        // （H.264 要求偶数尺寸，源 EXR 通常已是偶数）。
        const resizeArgs = maxWidth
          ? ["--resize", `${Math.max(1, Math.round(maxWidth))}x0`]
          : [];
        await execFileAsync(
          oiiotool,
          [
            file,
            ...channelArgs,
            ...resizeArgs,
            "--colorconvert", "linear", "sRGB",
            "-d", "uint8",
            "-o", outputPath,
          ],
          {
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
            timeout: 120_000,
            signal,
          },
        );
        return outputPath;
      }));
      outputs.push(...decoded);
    }
    return { files: outputs, tempDirectory };
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (signal?.aborted) throw error;
    // 解码失败：回退原文件（ffmpeg 尝试并报错），不产出空白产物。
    return null;
  }
}
