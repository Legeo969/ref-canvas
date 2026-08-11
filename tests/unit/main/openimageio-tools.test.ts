import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeExrWithOpenImageIo,
  fitPreviewDimensions,
  packagedOiiotoolCandidates,
  parseOpenImageIoInfoXml,
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
});
