import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePsdFixture } from "../../fixtures/media-fixtures";
import { parsePsdHeader } from "../../../src/main/services/media/psd-header";

let tempDirectory: string | null = null;

async function withTemp(): Promise<string> {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-psd-"));
  return tempDirectory;
}

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = null;
  }
});

describe("parsePsdHeader（阶段 4：PSD 文件头解析）", () => {
  it("解析最小 PSD：画布/通道/位深/RGB/无图层", async () => {
    const directory = await withTemp();
    const target = await writePsdFixture(directory);
    const parsed = await parsePsdHeader(target);
    expect(parsed.valid).toBe(true);
    expect(parsed.version).toBe(1);
    expect(parsed.width).toBe(8);
    expect(parsed.height).toBe(6);
    expect(parsed.channels).toBe(3);
    expect(parsed.depth).toBe(8);
    expect(parsed.colorMode).toBe("RGB");
    expect(parsed.layerCount).toBe(0);
    expect(parsed.hasLayers).toBe(false);
  });

  it("拒绝非 PSD 文件", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "not.psd");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(target, Buffer.from("RIFF....WAVEfmt ", "latin1"));
    const parsed = await parsePsdHeader(target);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("NOT_PSD");
  });

  it("拒绝截断的文件头", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "tiny.psd");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(target, Buffer.from("8BPS\x00\x01", "latin1"));
    const parsed = await parsePsdHeader(target);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBe("TRUNCATED_HEADER");
  });

  it("不存在的文件返回 READ 错误（valid=false）", async () => {
    const directory = await withTemp();
    const parsed = await parsePsdHeader(path.join(directory, "missing.psd"));
    expect(parsed.valid).toBe(false);
  });
});
