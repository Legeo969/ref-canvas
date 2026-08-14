import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeExrWithOpenImageIo,
  buildOpenImageIoDecodeArgs,
  fitPreviewDimensions,
  packagedOiiotoolCandidates,
  packagedOiiotoolPath,
  parseOpenImageIoInfoXml,
  validateOcioConfigWithOpenImageIo,
} from "../../../src/main/services/media/openimageio-tools";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("OpenImageIO sidecar", () => {
  it("fits previews without enlargement or aspect-ratio drift", () => {
    expect(fitPreviewDimensions(2390, 1000, 960, 960)).toEqual({
      width: 960,
      height: 402,
    });
    expect(fitPreviewDimensions(320, 200, 960, 960)).toEqual({
      width: 320,
      height: 200,
    });
  });

  it("uses only the app-owned unpacked runtime in packaged builds", () => {
    expect(packagedOiiotoolCandidates({
      resourcesPath: "C:\\Program Files\\RefCanvas\\resources",
      defaultApp: false,
      override: "C:\\attacker\\oiiotool.exe",
      cwd: "C:\\attacker",
    })).toEqual([
      path.join("C:\\Program Files\\RefCanvas\\resources", "app.asar.unpacked", "assets", "native", "openimageio", "win32-x64", "oiiotool.exe"),
    ]);
  });

  it("parses all XML ImageSpec parts", () => {
    const parts = parseOpenImageIoInfoXml(`<?xml version="1.0"?><ImageSpec version="1"><attrib name="name" type="string">Utility</attrib><x>0</x><y>0</y><z>0</z><width>32</width><height>16</height><depth>1</depth><full_x>0</full_x><full_y>0</full_y><full_z>0</full_z><full_width>32</full_width><full_height>16</full_height><full_depth>1</full_depth><tile_width>0</tile_width><tile_height>0</tile_height><tile_depth>0</tile_depth><nchannels>1</nchannels><channelnames><channelname>Z</channelname></channelnames><format>float</format><deep>0</deep></ImageSpec><ImageSpec version="1"><attrib name="name" type="string">Beauty</attrib><x>0</x><y>0</y><z>0</z><width>16</width><height>8</height><depth>1</depth><full_x>0</full_x><full_y>0</full_y><full_z>0</full_z><full_width>16</full_width><full_height>8</full_height><full_depth>1</full_depth><tile_width>16</tile_width><tile_height>16</tile_height><tile_depth>1</tile_depth><nchannels>3</nchannels><channelnames><channelname>R</channelname><channelname>G</channelname><channelname>B</channelname></channelnames><format>half</format><deep>0</deep></ImageSpec>`);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ index: 1, name: "Beauty", width: 16, height: 8, tileWidth: 16, channels: ["R", "G", "B"] });
  });

  it("passes an explicitly selected OCIO config into the display transform", () => {
    const args = buildOpenImageIoDecodeArgs({
      inputPath: "D:\\images\\studio.exr",
      outputPath: "D:\\cache\\unused.png",
      channels: ["R", "G", "B"],
      sourceWidth: 2048,
      sourceHeight: 1024,
      maximumWidth: 960,
      maximumHeight: 960,
      inputColorSpace: "linear",
      ocioConfigPath: "D:\\color\\config.ocio",
    }, "D:\\cache\\preview.png");
    expect(args.slice(0, 3)).toEqual(["--colorconfig", "D:\\color\\config.ocio", "D:\\images\\studio.exr"]);
    expect(args).toContain("--colorconvert");
  });

  it("uses the color space selected in the OCIO menu as the transform input", () => {
    const args = buildOpenImageIoDecodeArgs({
      inputPath: "D:\\images\\studio.exr",
      outputPath: "D:\\cache\\unused.png",
      channels: ["R", "G", "B"],
      sourceWidth: 2048,
      sourceHeight: 1024,
      maximumWidth: 960,
      maximumHeight: 960,
      inputColorSpace: "ACEScg",
    }, "D:\\cache\\preview.png");
    const colorConvert = args.indexOf("--colorconvert");
    expect(args.slice(colorConvert, colorConvert + 3)).toEqual(["--colorconvert", "ACEScg", "sRGB"]);
  });

  it("uses real ACES display views and bypasses color conversion for Raw", () => {
    const common = {
      inputPath: "D:\\images\\studio.exr",
      outputPath: "D:\\cache\\unused.png",
      channels: ["R", "G", "B"],
      sourceWidth: 2048,
      sourceHeight: 1024,
      maximumWidth: 960,
      maximumHeight: 960,
      inputColorSpace: "ACEScg",
    } as const;
    const aces13 = buildOpenImageIoDecodeArgs({ ...common, displayTransform: "aces-1.3" }, "D:\\cache\\aces13.png");
    expect(aces13).toContain("ocio://cg-config-v1.0.0_aces-v1.3_ocio-v2.1");
    const displayOption = aces13.findIndex((argument) => argument.startsWith("--ociodisplay:"));
    expect(aces13.slice(displayOption, displayOption + 4)).toEqual([
      "--ociodisplay:from=ACEScg", "sRGB - Display", "ACES 1.0 - SDR Video", "--resize",
    ]);
    const aces20 = buildOpenImageIoDecodeArgs({ ...common, displayTransform: "aces-2.0" }, "D:\\cache\\aces20.png");
    expect(aces20).toContain("ocio://default");
    expect(aces20).toContain("--ociodisplay:from=ACEScg");
    expect(aces20).toContain("ACES 2.0 - SDR 100 nits (Rec.709)");
    const raw = buildOpenImageIoDecodeArgs({ ...common, displayTransform: "raw" }, "D:\\cache\\raw.png");
    expect(raw).not.toContain("--colorconvert");
    expect(raw).not.toContain("--ociodisplay");
  });

  it("terminates the isolated helper when decoding is cancelled", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-oiio-abort-"));
    directories.push(directory);
    const script = path.join(directory, "slow-helper.cjs");
    const outputPath = path.join(directory, "preview.png");
    await writeFile(script, "setInterval(() => undefined, 1000);\n");
    const controller = new AbortController();
    const started = Date.now();
    const pending = decodeExrWithOpenImageIo({
      inputPath: script,
      outputPath,
      channels: ["R", "G", "B"],
      sourceWidth: 64,
      sourceHeight: 64,
      maximumWidth: 64,
      maximumHeight: 64,
      executable: process.execPath,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it("accepts an OCIO config whose minimal conversion succeeds", async () => {
    const executable = await packagedOiiotoolPath();
    if (!executable) return; // 解码侧车缺失时跳过
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-ocio-ok-"));
    directories.push(directory);
    const config = path.join(directory, "config.ocio");
    await writeFile(config, `ocio_profile_version: 1
search_path: ""
strictparsing: false
roles:
  scene_linear: lin
  color_picking: sRGB
colorspaces:
  - !<ColorSpace> {name: lin}
  - !<ColorSpace> {name: sRGB}
`);
    const validation = await validateOcioConfigWithOpenImageIo(config, { executable });
    expect(validation).toEqual({ ok: true, detail: null });
  });

  it("reports the failure reason for an unusable OCIO config", async () => {
    const executable = await packagedOiiotoolPath();
    if (!executable) return; // 解码侧车缺失时跳过
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-ocio-bad-"));
    directories.push(directory);
    const config = path.join(directory, "config.ocio");
    // 缺失 scene_linear 角色与 sRGB 色彩空间：--colorconvert 无法解析。
    await writeFile(config, `ocio_profile_version: 1
search_path: ""
strictparsing: true
roles:
  scene_linear: nope
  color_picking: also_missing
colorspaces:
  - !<ColorSpace> {name: whatever}
`);
    const validation = await validateOcioConfigWithOpenImageIo(config, { executable });
    expect(validation.ok).toBe(false);
    expect(validation.detail).toContain("could not be found");
  });
});
