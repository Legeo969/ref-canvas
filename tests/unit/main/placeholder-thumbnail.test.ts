// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("electron", () => ({
  app: {
    getFileIcon: vi.fn(),
  },
}));

import { app } from "electron";
import {
  fileIconPlaceholderThumbnail,
  genericPlaceholderSvg,
  genericPlaceholderThumbnail,
  shouldUseFileIcon,
  systemFileIconThumbnail,
} from "../../../src/main/platform/placeholder-thumbnail";

beforeEach(() => {
  vi.mocked(app.getFileIcon).mockReset();
});

describe("genericPlaceholderSvg", () => {
  it("labels the card with the uppercased extension", () => {
    const svg = genericPlaceholderSvg("aep", 480, 320);
    expect(svg).toContain("AEP");
    expect(svg).toContain("无可用缩略图");
    expect(svg).toContain('<rect width="480" height="320"');
  });

  it("escapes XML metacharacters and caps long labels", () => {
    // 去掉前导点后截断到 8 字符再转义：<script>.tar → <SCRIPT> → &lt;SCRIPT&gt;
    const svg = genericPlaceholderSvg("<script>.tar", 480, 320);
    expect(svg).toContain("&lt;SCRIPT&gt;");
    expect(svg).not.toContain("<SCRIPT>");
  });

  it("falls back to FILE for empty extensions", () => {
    expect(genericPlaceholderSvg("", 480, 320)).toContain("FILE");
  });

  it("shows DCC format hints for proprietary scene files", () => {
    expect(genericPlaceholderSvg("max", 480, 320)).toContain("MAX");
    expect(genericPlaceholderSvg("max", 480, 320)).toContain("3ds Max 场景");
    expect(genericPlaceholderSvg("ma", 480, 320)).toContain("Maya 场景");
    expect(genericPlaceholderSvg("c4d", 480, 320)).toContain("Cinema 4D 场景");
    expect(genericPlaceholderSvg("hip", 480, 320)).toContain("Houdini 场景");
    // 非 DCC 的格式保持通用文案。
    expect(genericPlaceholderSvg("aep", 480, 320)).toContain("无可用缩略图");
  });
});

describe("genericPlaceholderThumbnail", () => {
  it("renders a valid PNG buffer capped at 640x480", async () => {
    const png = await genericPlaceholderThumbnail("aep", {
      width: 1920,
      height: 1920,
    });
    expect(Buffer.isBuffer(png)).toBe(true);
    // PNG 魔数。
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
    expect(png.byteLength).toBeGreaterThan(100);
  });
});

describe("fileIconPlaceholderThumbnail", () => {
  it("uses the file-association icon when the app provides one", async () => {
    // mock electron.app.getFileIcon：返回一个 32x32 红色 PNG。
    const iconPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAFElEQVR42mNk+M9Qz0AEYBxVSF+FAP2kBBLxQzX4AAAAAElFTkSuQmCC",
      "base64",
    );
    vi.mocked(app.getFileIcon).mockResolvedValue({
      isEmpty: () => false,
      resize: () => ({
        toPNG: () => iconPng,
      }),
    } as never);
    const png = await fileIconPlaceholderThumbnail(
      "D:\\refs\\shot.max",
      "max",
      { width: 480, height: 320 },
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
    expect(app.getFileIcon).toHaveBeenCalledWith("D:\\refs\\shot.max", {
      size: "large",
    });
  });

  it("falls back to text placeholder when the icon is unavailable", async () => {
    vi.mocked(app.getFileIcon).mockRejectedValue(new Error("no icon"));
    const png = await fileIconPlaceholderThumbnail(
      "D:\\refs\\shot.c4d",
      "c4d",
      { width: 480, height: 320 },
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
  });

  it("marks DCC extensions for icon placeholders", () => {
    for (const ext of ["blend", "max", "ma", "mb", "c4d", "abc", "hip", "hipnc"]) {
      expect(shouldUseFileIcon(ext)).toBe(true);
    }
    expect(shouldUseFileIcon("png")).toBe(false);
    expect(shouldUseFileIcon("aep")).toBe(false);
    // .blend1 不走合成卡片：systemFileIconThumbnail 分支直接显示系统文件图标。
    expect(shouldUseFileIcon("blend1")).toBe(false);
  });
});

describe("systemFileIconThumbnail", () => {
  // mock electron.app.getFileIcon：返回一个 32x32 红色 PNG 图标
  // （由 sharp 生成，保证 libpng 可解析——直接嵌入 SVG 的 base64
  // 不需要解析，但 systemFileIconThumbnail 会把图标 PNG 交给 sharp）。
  let iconPng: Buffer;

  beforeAll(async () => {
    iconPng = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  it("lays the system file icon out on a white canvas at the target size", async () => {
    vi.mocked(app.getFileIcon).mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => iconPng,
    } as never);
    const png = await systemFileIconThumbnail(
      "D:\\refs\\shot.blend1",
      "blend1",
      { width: 480, height: 320 },
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
    expect(app.getFileIcon).toHaveBeenCalledWith("D:\\refs\\shot.blend1", {
      size: "large",
    });
    const metadata = await sharp(png).metadata();
    expect(metadata.width).toBe(480);
    expect(metadata.height).toBe(320);
  });

  it("falls back to the generic placeholder when the icon is empty", async () => {
    vi.mocked(app.getFileIcon).mockResolvedValue({
      isEmpty: () => true,
      toPNG: () => iconPng,
    } as never);
    const png = await systemFileIconThumbnail(
      "D:\\refs\\shot.blend1",
      "blend1",
      { width: 480, height: 320 },
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
  });

  it("falls back to the generic placeholder when getFileIcon throws", async () => {
    vi.mocked(app.getFileIcon).mockRejectedValue(new Error("no icon"));
    const png = await systemFileIconThumbnail(
      "D:\\refs\\shot.blend1",
      "blend1",
      { width: 480, height: 320 },
    );
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4).toString("hex")).toBe("52494646");
    expect(png.subarray(8, 12).toString("hex")).toBe("57454250");
  });
});
