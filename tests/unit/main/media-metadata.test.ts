import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  packagedFfprobePath,
  parseFfprobeOutput,
  readMediaMetadata,
} from "../../../src/main/services/media-metadata";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function oneSecondWave(): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * 2;
  const result = Buffer.alloc(44 + dataSize);
  result.write("RIFF", 0);
  result.writeUInt32LE(36 + dataSize, 4);
  result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(dataSize, 40);
  return result;
}

describe("media metadata", () => {
  it("uses container duration and video dimensions", () => {
    expect(
      parseFfprobeOutput(
        JSON.stringify({
          format: { duration: "12.345" },
          streams: [
            {
              codec_type: "video",
              width: 1920,
              height: 1080,
            },
            { codec_type: "audio", duration: "12.3" },
          ],
        }),
      ),
    ).toEqual({
      duration: 12.345,
      width: 1920,
      height: 1080,
      bpm: null,
    });
  });

  it("falls back to stream duration and respects portrait rotation", () => {
    expect(
      parseFfprobeOutput(
        JSON.stringify({
          streams: [
            {
              codec_type: "video",
              duration: "5.5",
              width: 1920,
              height: 1080,
              side_data_list: [{ rotation: -90 }],
            },
          ],
        }),
      ),
    ).toEqual({
      duration: 5.5,
      width: 1080,
      height: 1920,
      bpm: null,
    });
  });

  it("maps packaged executables to the unpacked ASAR path", () => {
    expect(
      packagedFfprobePath(
        "C:\\RefCanvas\\resources\\app.asar\\node_modules\\ffprobe.exe",
      ),
    ).toBe(
      "C:\\RefCanvas\\resources\\app.asar.unpacked\\node_modules\\ffprobe.exe",
    );
  });

  it("reads audio duration with the bundled offline executable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "refcanvas-media-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "tone.wav");
    await writeFile(filename, oneSecondWave());

    const metadata = await readMediaMetadata(filename);

    expect(metadata.duration).toBeCloseTo(1, 2);
    expect(metadata.width).toBeNull();
    expect(metadata.height).toBeNull();
  });
});
