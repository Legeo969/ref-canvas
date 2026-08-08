import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeAudioFixture } from "../../fixtures/media-fixtures";
import { extractWaveform } from "../../../src/main/services/media/waveform-extract";

let tempDirectory: string | null = null;

async function withTemp(): Promise<string> {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-waveform-"));
  return tempDirectory;
}

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = null;
  }
});

describe("extractWaveform（阶段 4：音频波形）", () => {
  it("从 440Hz sine WAV 提取峰值包络", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const data = await extractWaveform(target, 2400);
    expect(data.peaks.length).toBeGreaterThan(0);
    expect(data.peaks.length).toBeLessThanOrEqual(2400);
    for (const peak of data.peaks) {
      expect(peak).toBeGreaterThanOrEqual(0);
      expect(peak).toBeLessThanOrEqual(1);
    }
    // 1 秒音频：至少 30 个桶（64ms/桶 → ~15 桶；440Hz sine 有波峰波谷）。
    expect(data.peaks.length).toBeGreaterThan(10);
    expect(data.durationSeconds).toBeGreaterThan(0.8);
    expect(data.durationSeconds).toBeLessThan(1.5);
  });

  it("归并压缩到 maxPoints 上限", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const data = await extractWaveform(target, 8);
    expect(data.peaks.length).toBeLessThanOrEqual(8);
    expect(data.peaks.length).toBeGreaterThan(0);
  });

  it("非音频文件返回空波形（降级而非抛错）", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "not-audio.bin");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(target, Buffer.from("this is not audio content at all", "latin1"));
    const data = await extractWaveform(target);
    expect(data.peaks).toEqual([]);
    expect(data.durationSeconds).toBeNull();
  });
});
