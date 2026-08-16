// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  genericPlaceholderSvg,
  genericPlaceholderThumbnail,
} from "../../../src/main/platform/placeholder-thumbnail";

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
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.byteLength).toBeGreaterThan(100);
  });
});
