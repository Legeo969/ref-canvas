import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { exportVideoFrames } from "../../../src/main/services/media/video-frame-export";
import { packagedFfmpegPath } from "../../../src/main/services/media/ffmpeg-tools";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

describe("video frame export", () => {
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ));
  });

  it("exports only the requested range and never reuses an existing output folder", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-frames-test-"));
    directories.push(directory);
    const video = path.join(directory, "clip.mp4");
    await execFileAsync(packagedFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=20:d=1",
      "-pix_fmt", "yuv420p", video,
    ], { windowsHide: true });

    const first = await exportVideoFrames({
      inputPath: video,
      outputDirectory: directory,
      baseName: "clip",
      format: "jpeg",
      fps: 5,
      startMs: 200,
      endMs: 800,
      quality: 80,
    });
    const second = await exportVideoFrames({
      inputPath: video,
      outputDirectory: directory,
      baseName: "clip",
      format: "png",
      fps: 5,
      startMs: 200,
      endMs: 800,
    });

    expect(first.frameCount).toBe(3);
    expect((await readdir(first.outputDirectory)).every((name) => name.endsWith(".jpg"))).toBe(true);
    expect(second.outputDirectory).not.toBe(first.outputDirectory);
    expect(second.frameCount).toBe(3);
  });
});
