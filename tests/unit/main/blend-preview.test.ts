import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bgraToRgba,
  hasEmbeddedPreviewSupport,
  isZstdCompressedBlend,
  readBlendEmbeddedPreview,
} from "../../../src/main/services/media/blend-preview";

/** 构造一个最小合成 .blend：BLENDER 头 + TEST 块（原始 BGRA 像素）。 */
function buildFakeBlend(rectx: number, recty: number): Buffer {
  const pixels = Buffer.alloc(rectx * recty * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    // BGRA：蓝=1 绿=2 红=3 不透明。
    pixels[i] = 1;
    pixels[i + 1] = 2;
    pixels[i + 2] = 3;
    pixels[i + 3] = 255;
  }
  const header = Buffer.alloc(12);
  header.write("BLENDER", 0, "latin1");
  header.write("v405", 7, "latin1");
  const testPayload = Buffer.alloc(12 + pixels.length);
  testPayload.writeInt32LE(pixels.length, 0); // preview size
  testPayload.writeInt32LE(rectx, 4);
  testPayload.writeInt32LE(recty, 8);
  pixels.copy(testPayload, 12);
  const block = Buffer.alloc(24);
  block.write("TEST", 0, "latin1");
  block.writeInt32LE(testPayload.length, 4);
  // old(8) 全零；sdna_index=1；count=1
  block.writeInt32LE(1, 16);
  block.writeInt32LE(1, 20);
  return Buffer.concat([header, block, testPayload]);
}

describe("blend-preview", () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = null;
  });

  async function writeScratch(name: string, data: Buffer): Promise<string> {
    scratch ??= await mkdtemp(path.join(tmpdir(), "refcanvas-blend-preview-"));
    const filename = path.join(scratch, name);
    await writeFile(filename, data);
    return filename;
  }

  it("reads embedded TEST preview from a plain .blend", async () => {
    const filename = await writeScratch("cube.blend", buildFakeBlend(128, 67));
    const preview = await readBlendEmbeddedPreview(filename);
    expect(preview).not.toBeNull();
    expect(preview!.rectx).toBe(128);
    expect(preview!.recty).toBe(67);
    expect(preview!.pixels).toHaveLength(128 * 67 * 4);
    // 首像素 BGRA(1,2,3,255) → RGBA(3,2,1,255)。
    const rgba = bgraToRgba(preview!.pixels);
    expect([...rgba.subarray(0, 4)]).toEqual([3, 2, 1, 255]);
  });

  it("returns null for non-BLENDER magic", async () => {
    const filename = await writeScratch("not-blend.blend", Buffer.from("garbage"));
    await expect(readBlendEmbeddedPreview(filename)).resolves.toBeNull();
  });

  it("returns null for truncated TEST payload", async () => {
    const fake = buildFakeBlend(128, 67);
    const truncated = fake.subarray(0, fake.length - 10);
    const filename = await writeScratch("truncated.blend", truncated);
    await expect(readBlendEmbeddedPreview(filename)).resolves.toBeNull();
  });

  it("detects zstd-compressed blend magic", async () => {
    const filename = await writeScratch(
      "compressed.blend",
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0x41, 0x06]),
    );
    await expect(isZstdCompressedBlend(filename)).resolves.toBe(true);
    const plain = await writeScratch("plain.blend", buildFakeBlend(16, 16));
    await expect(isZstdCompressedBlend(plain)).resolves.toBe(false);
  });

  it("hasEmbeddedPreviewSupport 仅覆盖 .blend（.blend1 不再读内嵌预览）", () => {
    expect(hasEmbeddedPreviewSupport("scene.blend")).toBe(true);
    expect(hasEmbeddedPreviewSupport("blend")).toBe(true);
    expect(hasEmbeddedPreviewSupport("scene.blend1")).toBe(false);
    expect(hasEmbeddedPreviewSupport(".blend1")).toBe(false);
    expect(hasEmbeddedPreviewSupport(".BLEND1")).toBe(false);
    expect(hasEmbeddedPreviewSupport("scene.abc")).toBe(false);
    expect(hasEmbeddedPreviewSupport("scene.max")).toBe(false);
  });
});
