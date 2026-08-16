import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_ICON_DATA_URL,
  resolveNativeDragIcon,
  type NativeDragIconImage,
  type NativeDragIconSources,
  type NativeDragThumbnailLookup,
} from "../../../src/main/platform/native-drag-icon";
import { thumbnailCacheFilename } from "../../../src/main/platform/thumbnail-cache";

class FakeImage implements NativeDragIconImage {
  constructor(
    private readonly empty: boolean,
    readonly source = "",
  ) {}
  isEmpty(): boolean {
    return this.empty;
  }
}

const image = (source: string) => new FakeImage(false, source);
const missing = () => new FakeImage(true);

const sourcesOf = (
  files: Record<string, FakeImage>,
  dataUrl: FakeImage = new FakeImage(false, "data-url"),
): NativeDragIconSources<FakeImage> => ({
  createFromPath: (filePath) => files[filePath] ?? missing(),
  createFromDataUrl: () => dataUrl,
});

const asset = (overrides: Partial<{ id: string; mtimeMs: number; size: number; fingerprint: string }> = {}) => ({
  id: "asset-1",
  mtimeMs: 1_700_000_000_000,
  size: 1024,
  fingerprint: "abc",
  ...overrides,
});

const lookupOf = (
  record: ReturnType<typeof asset> | null,
  cacheDir: string,
): NativeDragThumbnailLookup => ({
  getAssetByPath: () => record,
  thumbnailCacheDirectory: cacheDir,
});

describe("resolveNativeDragIcon", () => {
  const appPath = "C:/app";

  it("直接命中：图片文件原样返回", () => {
    const file = "C:/lib/hero.png";
    const direct = image("direct");
    const icon = resolveNativeDragIcon(
      file,
      sourcesOf({ [file]: direct }),
      undefined,
      appPath,
    );
    expect(icon).toBe(direct);
  });

  it("非图片但已索引：优先返回缩略图缓存图标", () => {
    const file = "C:/lib/model.blend";
    const record = asset();
    const thumbPath = path.join(
      "C:/cache/thumbnails",
      thumbnailCacheFilename(record),
    );
    const thumb = image("thumbnail");
    const icon = resolveNativeDragIcon(
      file,
      sourcesOf({ [thumbPath]: thumb }),
      lookupOf(record, "C:/cache/thumbnails"),
      appPath,
    );
    expect(icon).toBe(thumb);
  });

  it("非图片、未索引：回退到应用图标", () => {
    const file = "C:/lib/model.obj";
    const appIcon = image("app-icon");
    const icon = resolveNativeDragIcon(
      file,
      sourcesOf({ [path.join(appPath, "assets", "app", "refcanvas.png")]: appIcon }),
      undefined,
      appPath,
    );
    expect(icon).toBe(appIcon);
  });

  it("已索引但缩略图缓存为空：跳过缓存，回退到应用图标", () => {
    const file = "C:/lib/model.fbx";
    const record = asset();
    const thumbPath = path.join(
      "C:/cache/thumbnails",
      thumbnailCacheFilename(record),
    );
    const appIcon = image("app-icon");
    const icon = resolveNativeDragIcon(
      file,
      sourcesOf({
        [thumbPath]: missing(),
        [path.join(appPath, "assets", "app", "refcanvas.png")]: appIcon,
      }),
      lookupOf(record, "C:/cache/thumbnails"),
      appPath,
    );
    expect(icon).toBe(appIcon);
  });

  it("应用图标也缺失：回退到内嵌兜底图标", () => {
    const fallback = image("fallback-data-url");
    const icon = resolveNativeDragIcon(
      "C:/lib/model.abc",
      sourcesOf({}, fallback),
      undefined,
      appPath,
    );
    expect(icon).toBe(fallback);
  });

  it("契约：内嵌兜底图标必须是有效的非空 PNG（64×64）", () => {
    const base64 = FALLBACK_ICON_DATA_URL.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(base64, "base64");
    // PNG 魔数
    expect([...bytes.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    // IHDR：width=64, height=64（大端序）
    expect(bytes.readUInt32BE(16)).toBe(64);
    expect(bytes.readUInt32BE(20)).toBe(64);
  });
});
