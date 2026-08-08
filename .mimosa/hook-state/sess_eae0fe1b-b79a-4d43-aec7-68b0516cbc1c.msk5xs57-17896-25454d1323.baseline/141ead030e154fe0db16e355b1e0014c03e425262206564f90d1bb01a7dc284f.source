import { describe, expect, it } from "vitest";
import {
  detectSequences,
  sequenceLabel,
} from "../../../src/main/services/media/sequence-detector";

describe("sequence detection (stage 3 §9.4)", () => {
  it("groups standard sequences (dot or underscore, >= 4 digits)", () => {
    const files = [
      "D:\\shots\\render.0001.png",
      "D:\\shots\\render.0002.png",
      "D:\\shots\\render.0003.png",
      "D:\\shots\\render_0004.png",
    ];
    const sequences = detectSequences(files);
    // 点分隔 3 帧与下划线 1 帧是不同 base（分隔符不同）→ 不合并。
    expect(sequences).toHaveLength(1);
    expect(sequences[0].baseName).toBe("render");
    expect(sequences[0].pattern).toBe("standard");
    expect(sequences[0].start).toBe(1);
    expect(sequences[0].end).toBe(3);
    expect(sequences[0].missingFrames).toEqual([]);
    expect(sequences[0].fps).toBe(24);
  });

  it("sorts frames numerically, not lexicographically", () => {
    const files = [
      "D:\\seq\\a.0010.png",
      "D:\\seq\\a.0002.png",
      "D:\\seq\\a.0001.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences[0].frames).toEqual([1, 2, 10]);
    expect(sequences[0].files[0]).toBe("D:\\seq\\a.0001.png");
  });

  it("detects missing frames", () => {
    const files = [
      "D:\\seq\\b.0001.png",
      "D:\\seq\\b.0002.png",
      "D:\\seq\\b.0004.png",
      "D:\\seq\\b.0005.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences[0].missingFrames).toEqual([3]);
    expect(sequenceLabel(sequences[0])).toContain("缺 1 帧");
  });

  it("detects compatible sequences with consistent digit width", () => {
    const files = [
      "D:\\seq\\shot-001.png",
      "D:\\seq\\shot-002.png",
      "D:\\seq\\shot-003.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].pattern).toBe("compatible");
    expect(sequences[0].start).toBe(1);
    expect(sequences[0].end).toBe(3);
  });

  it("does not group files with inconsistent digit width", () => {
    const files = [
      "D:\\seq\\img1.png",
      "D:\\seq\\img10.png",
      "D:\\seq\\img100.png",
    ];
    const sequences = detectSequences(files);
    // 宽度 1/2/3 不一致 → 各自独立，不成组。
    expect(sequences).toHaveLength(0);
  });

  it("does not group standalone files or non-image extensions", () => {
    const files = [
      "D:\\seq\\note.png",
      "D:\\seq\\render.0001.txt",
      "D:\\seq\\render.0002.txt",
      "D:\\seq\\solo.0001.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences).toHaveLength(0);
  });

  it("groups by custom regex and ignores invalid patterns", () => {
    const files = [
      "D:\\seq\\camera_A0001.dpx",
      "D:\\seq\\camera_A0002.dpx",
      "D:\\seq\\camera_A0003.dpx",
    ];
    const sequences = detectSequences(files, {
      customPatterns: [
        /^camera_([A-Z])(\d{4})\.dpx$/i,
        // 非法 regex 字符串：必须被忽略，不影响检测。
        "[/unclosed",
      ],
    });
    expect(sequences).toHaveLength(1);
    expect(sequences[0].pattern).toBe("custom");
    expect(sequences[0].start).toBe(1);
    expect(sequences[0].end).toBe(3);
  });

  it("skips ambiguous groups with duplicate frames", () => {
    const files = [
      "D:\\seq\\dup.0001.png",
      "D:\\seq\\dup.0002.png",
      "D:\\seq\\dup.0002.png",
      "D:\\seq\\dup.0003.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences).toHaveLength(0);
  });

  it("keeps different bases and directories separate", () => {
    const files = [
      "D:\\a\\one.0001.png",
      "D:\\a\\one.0002.png",
      "D:\\a\\two.0001.png",
      "D:\\a\\two.0002.png",
      "D:\\b\\one.0001.png",
      "D:\\b\\one.0002.png",
    ];
    const sequences = detectSequences(files);
    expect(sequences).toHaveLength(3);
    expect(sequences.map((sequence) => sequence.id)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("one"),
        expect.stringContaining("two"),
      ]),
    );
  });
});
