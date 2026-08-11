import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HdrProvider } from "../../../src/main/providers/hdr-provider";

const sample = "D:\\地形练习\\render\\shamo\\shamo0015.exr";

describe("real production EXR", () => {
  it.skipIf(!existsSync(sample))(
    "decodes the DWAA multilayer Beauty pass to a non-flat preview",
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-real-exr-"));
      try {
        const outputPath = path.join(directory, "beauty.png");
        const source = await stat(sample);
        expect(source.size).toBe(22_506_311);
        const provider = new HdrProvider();
        const probe = await provider.probe({
          path: sample,
          kind: "image",
          extension: "exr",
          size: source.size,
        });
        expect(probe.extra.compression).toBe("dwaa");
        expect(probe.extra.defaultLayer).toBe("Beauty");
        const started = performance.now();
        const result = await provider.thumbnail({
          path: sample,
          kind: "image",
          extension: "exr",
          width: 960,
          height: 960,
          outputPath,
        });
        const durationMs = performance.now() - started;
        const stats = await sharp(outputPath).stats();
        expect(result).toMatchObject({ width: 960, height: 402 });
        expect(stats.channels.slice(0, 3).every((channel) => channel.max > channel.min)).toBe(true);
        expect(stats.channels.slice(0, 3).every((channel) => channel.stdev > 20)).toBe(true);
        console.log(JSON.stringify({
          sourceBytes: source.size,
          compression: probe.extra.compression,
          defaultLayer: probe.extra.defaultLayer,
          output: { width: result.width, height: result.height },
          durationMs: Number(durationMs.toFixed(2)),
          channels: stats.channels.slice(0, 3).map((channel) => ({
            min: channel.min,
            max: channel.max,
            mean: Number(channel.mean.toFixed(2)),
            stdev: Number(channel.stdev.toFixed(2)),
          })),
        }));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
