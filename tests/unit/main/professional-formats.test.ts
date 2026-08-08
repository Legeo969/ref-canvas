import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeAudioFixture,
  writeAudioWithCoverFixture,
  writeJxlFixture,
  writePsdFixture,
  writeRawFixture,
} from "../../fixtures/media-fixtures";
import { AudioProvider } from "../../../src/main/providers/audio-provider";
import { DccProvider } from "../../../src/main/providers/dcc-provider";
import { DocumentProvider } from "../../../src/main/providers/document-provider";
import { FontProvider } from "../../../src/main/providers/font-provider";
import { ImageProvider } from "../../../src/main/providers/image-provider";

let tempDirectory: string | null = null;

async function withTemp(): Promise<string> {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-stage4-"));
  return tempDirectory;
}

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = null;
  }
});

const probeInput = (target: string) => ({
  path: target,
  kind: "image" as const,
  extension: path.extname(target).replace(/^\./, "").toLowerCase(),
  size: 0,
});

describe("ImageProvider（阶段 4：PSD/HEIC/JXL/RAW）", () => {
  it("PSD probe：画布/通道/位深/色彩模式", async () => {
    const directory = await withTemp();
    const target = await writePsdFixture(directory);
    const provider = new ImageProvider();
    const result = await provider.probe(probeInput(target));
    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(result.extra.channels).toBe(3);
    expect(result.extra.bitDepth).toBe(8);
    expect(result.extra.colorMode).toBe("RGB");
    expect(result.extra.layerCount).toBe(0);
    await provider.dispose();
  });

  it("PSD metadata：字段表", async () => {
    const directory = await withTemp();
    const target = await writePsdFixture(directory);
    const provider = new ImageProvider();
    const result = await provider.metadata({ path: target, extension: "psd", kind: "image" });
    expect(result.fields.format).toBe("PSD");
    expect(result.fields.width).toBe(8);
    expect(result.fields.colorMode).toBe("RGB");
    await provider.dispose();
  });

  it("HEIC probe：真实 HEIC fixture（sharp/libvips 解码 metadata）", async () => {
    const target = path.resolve("tests/fixtures/professional/sample.heic");
    const provider = new ImageProvider();
    const result = await provider.probe(probeInput(target));
    expect(result.width).toBe(1280);
    expect(result.height).toBe(854);
    expect(result.extra.format).toBe("heif");
    await provider.dispose();
    // 首次加载 libvips/libheif 需要编译并注册 HEIC 解码器，完整并行测试中可能
    // 超过默认超时；这里只给本用例定向超时（不提高全局超时，见 FND-001 基线）。
  }, 60_000);

  it("JXL：明确降级（unsupportedReason，不伪装支持）", async () => {
    const directory = await withTemp();
    const target = await writeJxlFixture(directory);
    const provider = new ImageProvider();
    const result = await provider.probe(probeInput(target));
    expect(result.extra.unsupportedReason).toContain("JPEG XL");
    await expect(provider.thumbnail({ ...probeInput(target), width: 480, height: 320 })).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    await provider.dispose();
  });

  it("相机 RAW：明确降级", async () => {
    const directory = await withTemp();
    const target = await writeRawFixture(directory);
    const provider = new ImageProvider();
    const result = await provider.probe(probeInput(target));
    expect(result.extra.unsupportedReason).toContain("RAW");
    await provider.dispose();
  });

  it("非 PSD 扩展名返回失败", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "broken.psd");
    await writeFile(target, Buffer.from("not a psd file at all", "latin1"));
    const provider = new ImageProvider();
    await expect(provider.probe(probeInput(target))).rejects.toThrow("IMAGE_PROBE_FAILED");
    await provider.dispose();
  });
});

describe("AudioProvider（阶段 4：音频）", () => {
  it("probe：codec/sample rate/channels/bit depth/duration", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const provider = new AudioProvider();
    const result = await provider.probe({ path: target, kind: "audio", extension: "wav", size: 0 });
    expect(result.extra.codec).toBe("pcm_s16le");
    expect(result.extra.sampleRate).toBe(44100);
    expect(result.extra.channels).toBe(1);
    expect(result.extra.bitDepth).toBe(16);
    expect(result.duration).toBeGreaterThan(0.8);
    await provider.dispose();
  });

  it("metadata：包含时长与格式", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const provider = new AudioProvider();
    const result = await provider.metadata({ path: target, kind: "audio", extension: "wav" });
    expect(result.fields.sampleRate).toBe(44100);
    expect(result.fields.duration).toBeGreaterThan(0);
    await provider.dispose();
  });

  it("waveform：峰值包络", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const provider = new AudioProvider();
    const result = await provider.waveform({ path: target, kind: "audio", extension: "wav", samples: 2400 });
    expect(result.peaks.length).toBeGreaterThan(10);
    expect(result.duration).toBeGreaterThan(0.8);
    await provider.dispose();
  });

  it("带封面 MP3：thumbnail 提取封面", async () => {
    const directory = await withTemp();
    const target = await writeAudioWithCoverFixture(directory);
    const provider = new AudioProvider();
    const probeResult = await provider.probe({ path: target, kind: "audio", extension: "mp3", size: 0 });
    expect(probeResult.extra.hasCoverArt).toBe(true);
    const outputPath = path.join(directory, "thumb.png");
    const result = await provider.thumbnail({
      path: target, kind: "audio", extension: "mp3", width: 480, height: 320, outputPath,
    });
    expect(result.path).toBe(outputPath);
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    await provider.dispose();
  });

  it("无封面 WAV：thumbnail 生成波形样张", async () => {
    const directory = await withTemp();
    const target = await writeAudioFixture(directory);
    const provider = new AudioProvider();
    const outputPath = path.join(directory, "thumb.png");
    await provider.thumbnail({
      path: target, kind: "audio", extension: "wav", width: 480, height: 320, outputPath,
    });
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(480);
    await provider.dispose();
  });
});

describe("FontProvider（阶段 4：字体）", () => {
  const systemFontPath = (): string | null => {
    const candidates = ["C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf"];
    return candidates.find((candidate) => {
      try {
        return Boolean(globalThis.process.getBuiltinModule("fs").statSync(candidate));
      } catch (error) {
        void error;
        return false;
      }
    }) ?? null;
  };

  const font = systemFontPath();
  it("probe：系统字体 family/weight/glyph 数", async () => {
    if (!font) return;
    const provider = new FontProvider();
    const result = await provider.probe({ path: font, kind: "font", extension: "ttf", size: 0 });
    expect(result.extra.family).toBeTruthy();
    expect(result.extra.glyphCount).toBeGreaterThan(0);
    await provider.dispose();
  });

  it("thumbnail：样张 SVG 渲染为 PNG", async () => {
    const font = systemFontPath();
    if (!font) return;
    const directory = await withTemp();
    const outputPath = path.join(directory, "thumb.png");
    const provider = new FontProvider();
    await provider.thumbnail({
      path: font, kind: "font", extension: "ttf", width: 480, height: 320, outputPath,
    });
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(480);
    await provider.dispose();
  });

  it("非字体文件 probe 失败", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "fake.ttf");
    await writeFile(target, Buffer.from("garbage", "latin1"));
    const provider = new FontProvider();
    await expect(provider.probe({ path: target, kind: "font", extension: "ttf", size: 0 })).rejects.toThrow("FONT_PROBE_FAILED");
    await provider.dispose();
  });
});

describe("DccProvider（阶段 4：Alembic/DCC 降级）", () => {
  it("Alembic probe：明确降级说明", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "shot.abc");
    await writeFile(target, Buffer.from("Ogawa\u0000", "latin1"));
    const provider = new DccProvider();
    const result = await provider.probe({ path: target, kind: "dcc", extension: "abc", size: 0 });
    expect(result.extra.unsupportedReason).toContain("Alembic");
    await provider.dispose();
  });

  it("Blender probe：明确降级说明（不静默依赖本机软件）", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "scene.blend");
    await writeFile(target, Buffer.from("BLENDER", "latin1"));
    const provider = new DccProvider();
    const result = await provider.probe({ path: target, kind: "dcc", extension: "blend", size: 0 });
    expect(result.extra.unsupportedReason).toContain("Blender");
    await provider.dispose();
  });
});

describe("DocumentProvider（阶段 4：文档）", () => {
  it("文本 probe：行数/字符数/首行/编码", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "notes.md");
    await writeFile(target, "标题\n\n第一行内容\n第二行内容", "utf8");
    const provider = new DocumentProvider();
    const result = await provider.probe({ path: target, kind: "generic", extension: "md", size: 0 });
    expect(result.extra.format).toBe("text");
    expect(result.extra.lineCount).toBe(4);
    expect(result.extra.charCount).toBeGreaterThan(0);
    expect(result.extra.firstLine).toBe("标题");
    expect(result.extra.encoding).toBe("utf-8");
    await provider.dispose();
  });

  it("文本 thumbnail：文本卡片 SVG → PNG", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "notes.md");
    await writeFile(target, "第一行\n第二行\n", "utf8");
    const provider = new DocumentProvider();
    const outputPath = path.join(directory, "thumb.png");
    await provider.thumbnail({
      path: target, kind: "generic", extension: "md", width: 480, height: 320, outputPath,
    });
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(480);
    await provider.dispose();
  });

  it("PDF：明确降级（不伪装支持）", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "doc.pdf");
    await writeFile(target, "%PDF-1.4\n%%EOF", "latin1");
    const provider = new DocumentProvider();
    const result = await provider.probe({ path: target, kind: "pdf", extension: "pdf", size: 0 });
    expect(result.extra.unsupportedReason).toContain("PDF");
    await expect(provider.thumbnail({ path: target, kind: "pdf", extension: "pdf", width: 480, height: 320 })).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    await provider.dispose();
  });

  it("Office 文档：明确降级", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "doc.docx");
    await writeFile(target, Buffer.from("PK\u0003\u0004 fake zip", "latin1"));
    const provider = new DocumentProvider();
    const result = await provider.probe({ path: target, kind: "generic", extension: "docx", size: 0 });
    expect(result.extra.unsupportedReason).toContain("Word");
    await provider.dispose();
  });

  it("二进制文件 probe 失败（不当作文本）", async () => {
    const directory = await withTemp();
    const target = path.join(directory, "bin.txt");
    const bytes = Buffer.alloc(256);
    for (let i = 0; i < 128; i += 1) bytes[i] = 0;
    for (let i = 128; i < 256; i += 1) bytes[i] = 0x41;
    await writeFile(target, bytes);
    const provider = new DocumentProvider();
    await expect(provider.probe({ path: target, kind: "generic", extension: "txt", size: 0 })).rejects.toThrow("READ_FAILED");
    await provider.dispose();
  });
});
