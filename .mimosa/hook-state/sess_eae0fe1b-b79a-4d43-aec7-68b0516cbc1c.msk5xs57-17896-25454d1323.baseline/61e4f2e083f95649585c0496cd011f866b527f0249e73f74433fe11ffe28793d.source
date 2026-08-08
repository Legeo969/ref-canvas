import { describe, expect, it } from "vitest";
import {
  assetKindForExtension,
  browserImageExtensions,
} from "../../../src/shared/asset-kind";

describe("assetKindForExtension", () => {
  it.each(["glb", "gltf", "fbx", "obj", "stl"])(
    "classifies %s as a model",
    (extension) => {
      expect(assetKindForExtension(extension)).toBe("model3d");
    },
  );

  it.each(["psd", "psb", "abc", "blend", "ma", "mb", "max", "c4d"])(
    "routes %s through DCC preview support",
    (extension) => {
      expect(assetKindForExtension(extension)).toBe("dcc");
    },
  );

  it("uses proxy thumbnails for non-browser image formats", () => {
    expect(assetKindForExtension("tiff")).toBe("image");
    expect(assetKindForExtension("tga")).toBe("image");
    expect(assetKindForExtension("hdr")).toBe("image");
    expect(assetKindForExtension("exr")).toBe("image");
    expect(browserImageExtensions.has("tiff")).toBe(false);
  });
});
