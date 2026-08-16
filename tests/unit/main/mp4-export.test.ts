import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportSequenceToMp4, exportVideoToMp4 } from "../../../src/main/services/media/mp4-export";
import { packagedFfmpegPath } from "../../../src/main/services/media/ffmpeg-tools";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

async function withTemp(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "refcanvas-mp4-test-"),
  );
  tempDirectories.push(directory);
  return directory;
}

async function makeFrame(
  directory: string,
  name: string,
  color: string,
): Promise<string> {
  const output = path.join(directory, name);
  await execFileAsync(
    packagedFfmpegPath(),
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=${color}:s=320x180`,
      "-frames:v", "1",
      output,
    ],
    { windowsHide: true },
  );
  return output;
}

describe("exportSequenceToMp4（阶段 5：序列导出 MP4）", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("把 3 帧合成 H.264 MP4（concat demuxer + duration）", async () => {
    const directory = await withTemp();
    const frames = [
      await makeFrame(directory, "frame_0001.png", "red"),
      await makeFrame(directory, "frame_0002.png", "green"),
      await makeFrame(directory, "frame_0003.png", "blue"),
    ];
    const output = path.join(directory, "out.mp4");
    const result = await exportSequenceToMp4({
      files: frames,
      fps: 24,
      codec: "h264",
      quality: "high",
      resolution: "original",
      outputPath: output,
    });
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.durationSeconds).toBeGreaterThan(0.05);
    expect(result.durationSeconds).toBeLessThan(0.5);
    const entries = await readdir(directory);
    expect(entries).toContain("out.mp4");
  });

  it("缺帧时只编码存在的帧", async () => {
    const directory = await withTemp();
    const frames = [
      await makeFrame(directory, "frame_0001.png", "red"),
      await makeFrame(directory, "frame_0003.png", "blue"),
    ];
    const output = path.join(directory, "sparse.mp4");
    const result = await exportSequenceToMp4({
      files: frames,
      fps: 12,
      codec: "h264",
      quality: "medium",
      resolution: "half",
      outputPath: output,
    });
    expect(result.width).toBe(160);
    expect(result.height).toBe(90);
  });

  it("空文件列表拒绝导出", async () => {
    const directory = await withTemp();
    await expect(
      exportSequenceToMp4({
        files: [],
        fps: 24,
        codec: "h264",
        quality: "high",
        resolution: "original",
        outputPath: path.join(directory, "empty.mp4"),
      }),
    ).rejects.toThrow("MP4_EXPORT_EMPTY");
  });

  it("临时 concat 文件被清理", async () => {
    const directory = await withTemp();
    const frames = [await makeFrame(directory, "a_0001.png", "red")];
    const osTemp = path.join(os.tmpdir());
    // 并行 vitest worker 中其他用例可能同时在 os.tmpdir 创建 refcanvas-mp4-*
    // 目录；因此先快照导出前的同名条目，只断言“本次导出没有新增残留”，
    // 而不是对整个临时目录做全局计数。
    const before = new Set(
      (await readdir(osTemp)).filter((entry) => entry.startsWith("refcanvas-mp4-")),
    );
    await exportSequenceToMp4({
      files: frames,
      fps: 24,
      codec: "h264",
      quality: "high",
      resolution: "original",
      outputPath: path.join(directory, "clean.mp4"),
    });
    const after = (await readdir(osTemp)).filter(
      (entry) => entry.startsWith("refcanvas-mp4-") && !before.has(entry),
    );
    // 本次导出不得留下新的 refcanvas-mp4-* 目录（本测试自身目录由 afterEach 清理）。
    expect(after).toEqual([]);
  });

  it("支持 H.265 与四分之一分辨率预设", async () => {
    const directory = await withTemp();
    const frame = await makeFrame(directory, "frame_0001.png", "purple");
    const output = path.join(directory, "h265.mp4");
    const result = await exportSequenceToMp4({
      files: [frame],
      fps: 24,
      codec: "h265",
      quality: "best",
      resolution: "quarter",
      outputPath: output,
    });
    expect(result.width).toBe(80);
    expect(result.height).toBe(44);
  });

  it("把单视频转码为 H.264 MP4（右键菜单「导出 MP4」）", async () => {
    const directory = await withTemp();
    const input = path.join(directory, "source.mov");
    // 生成一段 1 秒 testsrc 视频作为输入（QuickTime 容器，ffmpeg 原生支持）。
    await execFileAsync(
      packagedFfmpegPath(),
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=1:size=320x180:rate=24",
        "-pix_fmt", "yuv420p",
        input,
      ],
      { windowsHide: true },
    );
    const output = path.join(directory, "converted.mp4");
    const result = await exportVideoToMp4({
      inputPath: input,
      codec: "h264",
      quality: "high",
      resolution: "original",
      outputPath: output,
    });
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.durationSeconds).toBeGreaterThan(0.5);
    const entries = await readdir(directory);
    expect(entries).toContain("converted.mp4");
  });

  it("视频转码支持半分辨率预设", async () => {
    const directory = await withTemp();
    const input = path.join(directory, "source.webm");
    await execFileAsync(
      packagedFfmpegPath(),
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=0.5:size=640x360:rate=24",
        "-pix_fmt", "yuv420p",
        input,
      ],
      { windowsHide: true },
    );
    const output = path.join(directory, "half.mp4");
    const result = await exportVideoToMp4({
      inputPath: input,
      codec: "h264",
      quality: "medium",
      resolution: "half",
      outputPath: output,
    });
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
  });
});
