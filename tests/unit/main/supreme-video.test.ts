import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { PreviewTokenRegistry } from "../../../src/main/platform/refbrowse";
import type { SupremeVideoStatusResult } from "../../../src/main/services/media/supreme-video";
import {
  SUPREME_VIDEO_PIPELINE,
  SupremeVideoService,
} from "../../../src/main/services/media/supreme-video";
import { readFfprobeFullMetadata } from "../../../src/main/services/media/ffprobe-full";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../../../src/main/services/media/ffmpeg-tools", () => ({
  packagedFfmpegPath: () => "mock-ffmpeg",
}));
vi.mock("../../../src/main/services/media/ffprobe-full", () => ({
  readFfprobeFullMetadata: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const probeMock = vi.mocked(readFfprobeFullMetadata);

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => undefined);
  return child;
}

function probeResult(overrides: {
  width?: number | null;
  fps?: string | null;
  duration?: number | null;
  audio?: boolean;
} = {}): unknown {
  return {
    valid: true,
    error: null,
    filename: "clip.mp4",
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    formatLongName: null,
    duration: overrides.duration ?? 10,
    size: 100,
    bitRate: null,
    streams: [],
    video: {
      width: overrides.width ?? 1920,
      height: overrides.width ?? 1920 ? 1080 : null,
      avgFrameRate: overrides.fps ?? "30000/1001",
    },
    audio: overrides.audio === false ? null : { codecName: "aac" },
    formatTags: {},
  };
}

describe("SupremeVideoService（至臻画质增强代理）", () => {
  const tempDirectories: string[] = [];
  let cacheDirectory = "";
  let service: SupremeVideoService;
  let sourcePath = "";
  let children: FakeChild[] = [];

  beforeEach(async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-supreme-test-"));
    tempDirectories.push(directory);
    cacheDirectory = directory;
    sourcePath = path.join(directory, "clip.mp4");
    await writeFile(sourcePath, "fake-video-bytes");
    service = new SupremeVideoService({
      cacheDirectory: () => cacheDirectory,
      previewTokens: new PreviewTokenRegistry(),
    });
    children = [];
    spawnMock.mockImplementation(() => {
      const child = fakeChild();
      children.push(child);
      return child as unknown as ReturnType<typeof spawn>;
    });
    probeMock.mockResolvedValue(probeResult() as never);
  });

  afterEach(async () => {
    spawnMock.mockClear();
    probeMock.mockClear();
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function waitForState(expected: "ready" | "failed" | "generating"): Promise<SupremeVideoStatusResult> {
    let latest!: SupremeVideoStatusResult;
    await vi.waitFor(async () => {
      latest = await service.status(sourcePath);
      expect(latest.state).toBe(expected);
    }, { timeout: 2_000, interval: 10 });
    return latest;
  }

  /** status() 不等待生成：generate 先 await mkdir 才 spawn，须轮询等 spawn。 */
  async function waitForSpawns(count: number): Promise<void> {
    await vi.waitFor(() => {
      expect(spawnMock.mock.calls.length).toBeGreaterThanOrEqual(count);
      expect(children.length).toBeGreaterThanOrEqual(count);
    }, { timeout: 2_000, interval: 5 });
  }

  it("1080p30 源：上采样 4K + 补帧 60fps 生成 H.264 代理，缓存复用", async () => {
    const first = await service.status(sourcePath);
    expect(first.state).toBe("generating");
    expect(first.needsEnhancement).toBe(true);

    await waitForSpawns(1);
    const child = children[0]!;
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toContain("-vf");
    expect(args[args.indexOf("-vf") + 1]).toBe(
      `scale=${SUPREME_VIDEO_PIPELINE.targetWidth}:-2:flags=lanczos,unsharp=5:5:0.4:5:5:0.0,minterpolate=fps=${SUPREME_VIDEO_PIPELINE.targetFps}`,
    );
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args).toContain("-preset");
    expect(args[args.indexOf("-preset") + 1]).toBe("veryfast");
    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args).toContain("-movflags");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args).toContain("-progress");
    expect(args[args.indexOf("-progress") + 1]).toBe("pipe:1");
    expect(args.at(-1)).toMatch(/\.part$/);
    // 显式只映射一条视频轨 + 可选音频轨：字幕/数据轨不参与代理转码。
    const mapIndex = args.indexOf("-map");
    expect(args.slice(mapIndex, mapIndex + 4)).toEqual([
      "-map", "0:v:0",
      "-map", "0:a:0?",
    ]);
    // 长视频 muxing 队列上限显式加大，防「Too many packets buffered」。
    expect(args[args.indexOf("-max_muxing_queue_size") + 1]).toBe("1024");
    // 输出是 .part 临时文件（非 .mp4 扩展名）：ffmpeg 无法按扩展名推断
    // 容器，必须显式 -f mp4，否则 muxer 初始化即失败（生成必败）。
    expect(args[args.indexOf("-f") + 1]).toBe("mp4");
    expect(args[args.indexOf("-f") + 1]).toBeDefined();
    expect(args.indexOf("-f")).toBeLessThan(args.length - 1);

    // 进度：out_time_us 推进 → 轮询拿到 0..1。
    child.stdout.write("out_time_us=2500000\nprogress=continue\n");
    const generating = await waitForState("generating");
    expect(generating.progress).toBeCloseTo(0.25, 5);

    // 假 ffmpeg 不会写文件：模拟落盘后 close(0) → rename 成正式代理。
    await writeFile(args.at(-1)!, "proxy-bytes");
    child.emit("close", 0);
    const ready = await waitForState("ready");
    expect(ready.needsEnhancement).toBe(true);
    expect(ready.source).toMatch(/^refbrowse:\/\/preview\/[0-9a-f-]{36}$/);

    // 缓存命中：不再 spawn；token 按路径复用（URL 稳定）。
    const again = await service.status(sourcePath);
    expect(again.state).toBe("ready");
    expect(again.source).toBe(ready.source);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("已是 4K60：无需代理，直接 ready（不 spawn）", async () => {
    probeMock.mockResolvedValue(
      probeResult({ width: 4096, fps: "60/1" }) as never,
    );
    const status = await service.status(sourcePath);
    expect(status).toEqual({
      state: "ready",
      progress: null,
      needsEnhancement: false,
      source: null,
      error: null,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("1080p60：只上采样不补帧；无音轨时不带音频参数", async () => {
    probeMock.mockResolvedValue(
      probeResult({ width: 1920, fps: "60/1", audio: false }) as never,
    );
    await service.status(sourcePath);
    await waitForSpawns(1);
    const args = spawnMock.mock.calls[0]![1] as string[];
    const filter = args[args.indexOf("-vf") + 1]!;
    expect(filter).toContain("scale=");
    expect(filter).not.toContain("minterpolate");
    expect(args).not.toContain("-c:a");
  });

  it("4K30：只补帧不上采样", async () => {
    probeMock.mockResolvedValue(
      probeResult({ width: 4096, fps: "30/1" }) as never,
    );
    await service.status(sourcePath);
    await waitForSpawns(1);
    const args = spawnMock.mock.calls[0]![1] as string[];
    const filter = args[args.indexOf("-vf") + 1]!;
    expect(filter).not.toContain("scale=");
    expect(filter).toContain("minterpolate=fps=60");
  });

  it("生成失败：写失败标记，轮询不再重复 spawn；cancel 后可重试", async () => {
    await service.status(sourcePath);
    await waitForSpawns(1);
    children[0]!.emit("close", 1);

    const failed = await waitForState("failed");
    expect(failed.error).toContain("SUPREME_GENERATION_FAILED");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 失败标记防重试风暴：再次 status 仍 failed，不重启生成。
    const again = await service.status(sourcePath);
    expect(again.state).toBe("failed");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // cancel 清标记 → 下次 status 重新生成。
    service.cancel(sourcePath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restarted = await service.status(sourcePath);
    expect(restarted.state).toBe("generating");
    await waitForSpawns(2);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("cancel 中断进行中的生成并杀死 ffmpeg", async () => {
    await service.status(sourcePath);
    await waitForSpawns(1);
    const child = children[0]!;
    service.cancel(sourcePath);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(child.kill).toHaveBeenCalled();

    // 中断后释放 job：再次 status 可重新生成。
    child.emit("close", 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const restarted = await service.status(sourcePath);
    expect(restarted.state).toBe("generating");
    await waitForSpawns(2);
  });

  it("源文件缺失：failed 且不 spawn", async () => {
    await rm(sourcePath, { force: true });
    const status = await service.status(sourcePath);
    expect(status.state).toBe("failed");
    expect(status.error).toBe("SOURCE_UNAVAILABLE");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawn 同步失败（二进制缺失等）：写失败标记并透出原因，不悬空 generating", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("SPAWN_FAILED");
    });
    const first = await service.status(sourcePath);
    expect(first.state).toBe("generating");
    const failed = await waitForState("failed");
    expect(failed.error).toContain("SUPREME_GENERATION_FAILED");
    expect(failed.error).toContain("SPAWN_FAILED");
    // 失败标记防重试风暴：不会无限重启。
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
