import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportSequenceToGif,
  exportVideoToGif,
  exportVideosToGif,
} from "../../../src/main/services/media/gif-export";
import { packagedFfmpegPath } from "../../../src/main/services/media/ffmpeg-tools";
import { readFfprobeFullMetadata } from "../../../src/main/services/media/ffprobe-full";
import { writeExrFixture } from "../../fixtures/media-fixtures";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

async function withTemp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-gif-test-"));
  tempDirectories.push(directory);
  return directory;
}

async function makeFrame(directory: string, name: string, color: string): Promise<string> {
  const output = path.join(directory, name);
  await execFileAsync(packagedFfmpegPath(), [
    "-y", "-f", "lavfi", "-i", `color=${color}:s=320x180`, "-frames:v", "1", output,
  ], { windowsHide: true });
  return output;
}

describe("GIF export", () => {
  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ));
  });

  it("exports an image sequence as an animated GIF", async () => {
    const directory = await withTemp();
    const files = [
      await makeFrame(directory, "shot.0001.png", "red"),
      await makeFrame(directory, "shot.0002.png", "green"),
      await makeFrame(directory, "shot.0003.png", "blue"),
    ];
    const outputPath = path.join(directory, "sequence.gif");

    const result = await exportSequenceToGif({
      files,
      fps: 12,
      maxWidth: 960,
      outputPath,
    });

    const probe = await readFfprobeFullMetadata(outputPath);
    expect(probe.video?.codecName).toBe("gif");
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it("exports a video as a looping GIF", async () => {
    const directory = await withTemp();
    const videoPath = path.join(directory, "clip.mp4");
    await execFileAsync(packagedFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=0.5",
      "-pix_fmt", "yuv420p", videoPath,
    ], { windowsHide: true });
    const outputPath = path.join(directory, "video.gif");

    const result = await exportVideoToGif({
      inputPath: videoPath,
      fps: 12,
      maxWidth: 240,
      outputPath,
    });

    const probe = await readFfprobeFullMetadata(outputPath);
    expect(probe.video?.codecName).toBe("gif");
    expect(result.width).toBe(240);
    expect(result.height).toBe(135);
  });

  it("concatenates trimmed ranges from multiple videos", async () => {
    const directory = await withTemp();
    const first = path.join(directory, "first.mp4");
    const second = path.join(directory, "second.mp4");
    await execFileAsync(packagedFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "color=red:s=320x180:r=24:d=0.6",
      "-pix_fmt", "yuv420p", first,
    ], { windowsHide: true });
    await execFileAsync(packagedFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "color=blue:s=180x320:r=24:d=0.6",
      "-pix_fmt", "yuv420p", second,
    ], { windowsHide: true });
    const outputPath = path.join(directory, "joined.gif");

    const result = await exportVideosToGif({
      clips: [
        { inputPath: first, startMs: 100, endMs: 500 },
        { inputPath: second, startMs: 0, endMs: 400 },
      ],
      fps: 10,
      maxWidth: 240,
      colors: 64,
      dither: "none",
      outputPath,
    });

    expect(result.width).toBe(240);
    expect(result.height).toBe(136);
    expect(result.durationSeconds).toBeGreaterThan(0.6);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("uses the Beauty layer when exporting a multi-layer EXR sequence", async () => {
    const directory = await withTemp();
    const channels = [
      "FinalImageMovieRenderQueue_WorldDepth.R",
      "FinalImageMovieRenderQueue_WorldDepth.G",
      "FinalImageMovieRenderQueue_WorldDepth.B",
      "FinalImageMovieRenderQueue_Beauty.R",
      "FinalImageMovieRenderQueue_Beauty.G",
      "FinalImageMovieRenderQueue_Beauty.B",
    ];
    const values: Record<string, 0 | 0.5> = {};
    for (const channel of channels) {
      values[channel] = channel.includes("_Beauty.") ? 0.5 : 0;
    }
    const files = [
      await writeExrFixture(directory, "shot.0001.exr", 0, channels, values),
      await writeExrFixture(directory, "shot.0002.exr", 0, channels, values),
    ];
    const outputPath = path.join(directory, "beauty.gif");

    const result = await exportSequenceToGif({
      files,
      fps: 12,
      maxWidth: 960,
      outputPath,
    });

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect((await readFfprobeFullMetadata(outputPath)).video?.codecName).toBe("gif");
  });
});
