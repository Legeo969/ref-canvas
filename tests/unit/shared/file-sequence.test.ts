import { describe, expect, it } from "vitest";
import { detectFileSequences } from "../../../src/shared/file-sequence";

describe("detectFileSequences", () => {
  it("supports underscore, dot and dash frame suffixes", () => {
    const entries = [
      "render_0001.exr",
      "render_0002.exr",
      "render_0003.exr",
      "plate.0100.png",
      "plate.0101.png",
      "plate.0102.png",
      "clip-001.mov",
      "clip-002.mov",
      "clip-003.mov",
    ].map((name) => ({ path: `C:/frames/${name}`, name, isDirectory: false }));

    const result = detectFileSequences(entries);

    expect(result.get("C:/frames/render_0002.exr")).toMatchObject({
      frame: 2,
      count: 3,
      startFrame: 1,
      endFrame: 3,
    });
    expect(result.get("C:/frames/plate.0101.png")).toMatchObject({
      frame: 101,
      count: 3,
      startFrame: 100,
      endFrame: 102,
    });
    expect(result.get("C:/frames/clip-002.mov")).toMatchObject({
      frame: 2,
      count: 3,
    });
  });

  it("requires three unique frames and ignores directories", () => {
    const result = detectFileSequences([
      { path: "C:/frames/a_0001.png", name: "a_0001.png", isDirectory: false },
      { path: "C:/frames/a_0002.png", name: "a_0002.png", isDirectory: false },
      { path: "C:/frames/a_0003.png", name: "a_0003.png", isDirectory: true },
    ]);
    expect(result.size).toBe(0);
  });
});
