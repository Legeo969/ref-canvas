// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  isExportableImageExtension,
  isExportableVideoExtension,
  pathNameOf,
  pathStemOf,
} from "../../../../../src/renderer/features/directory/asset-export-formats";

describe("asset-export-formats（右键菜单 GIF/导出 MP4 格式判定）", () => {
  it("识别 ffmpeg 可解码、可参与序列导出的图片格式", () => {
    for (const extension of ["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff", "bmp", "exr", "hdr", "tga", "dpx", "jxl"]) {
      expect(isExportableImageExtension(extension), extension).toBe(true);
    }
  });

  it("浏览器可显示但 ffmpeg 无法参与序列导出的格式不视为可导出图片", () => {
    for (const extension of ["svg", "psd", "psb", "heic", "heif", "avif"]) {
      expect(isExportableImageExtension(extension), extension).toBe(false);
    }
  });

  it("识别视频格式", () => {
    for (const extension of ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mpg", "mpeg"]) {
      expect(isExportableVideoExtension(extension), extension).toBe(true);
    }
  });

  it("音频 / 文档 / 其他格式两者都不匹配", () => {
    for (const extension of ["mp3", "wav", "pdf", "txt", "blend", "obj"]) {
      expect(isExportableImageExtension(extension), extension).toBe(false);
      expect(isExportableVideoExtension(extension), extension).toBe(false);
    }
  });

  it("大小写与点前缀不敏感", () => {
    expect(isExportableImageExtension(".PNG")).toBe(true);
    expect(isExportableVideoExtension("MOV")).toBe(true);
    expect(isExportableImageExtension("ExR")).toBe(true);
  });

  it("导出 baseName 辅助函数去掉目录与扩展名", () => {
    expect(pathNameOf("D:\\refs\\shot_0001.exr")).toBe("shot_0001.exr");
    expect(pathStemOf("D:/refs/shot_0001.exr")).toBe("shot_0001");
    expect(pathStemOf("D:\\refs\\clip.mov")).toBe("clip");
  });
});
