import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HdrProvider } from "../../../src/main/providers/hdr-provider";

const sample = "D:\\Unreal Projects\\山翼\\Saved\\MovieRenders\\01\\01_v002_0000.exr";

describe("real Unreal MovieRenders EXR", () => {
  it.skipIf(!existsSync(sample))(
    "decodes the 32-channel piz Beauty frame to a non-flat thumbnail quickly",
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-movierenders-exr-"));
      try {
        const outputPath = path.join(directory, "thumb.png");
        const source = await stat(sample);
        const provider = new HdrProvider();
        const probe = await provider.probe({
          path: sample,
          kind: "image",
          extension: "exr",
          size: source.size,
        });
        expect(probe.extra.compression).toBe("piz");
        expect(probe.extra.channels).toHaveLength(32);
        // 顶层 Beauty 默认层：文件名不含辅助 pass 关键字。
        expect(probe.extra.defaultLayer).toBe("");
        const started = performance.now();
        const result = await provider.thumbnail({
          path: sample,
          kind: "image",
          extension: "exr",
          width: 480,
          height: 480,
          outputPath,
        });
        const durationMs = performance.now() - started;
        const stats = await sharp(outputPath).stats();
        expect(result).toMatchObject({ width: 480, height: 196 });
        // 非平坦画面：三层都有方差。
        expect(stats.channels.slice(0, 3).every((channel) => channel.stdev > 10)).toBe(true);
        console.log(JSON.stringify({
          sourceBytes: source.size,
          compression: probe.extra.compression,
          defaultLayer: probe.extra.defaultLayer,
          output: { width: result.width, height: result.height },
          durationMs: Number(durationMs.toFixed(2)),
        }));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
