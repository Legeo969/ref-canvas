import { describe, expect, it } from "vitest";
import { formatDuration } from "../../../../src/renderer/app/format-duration";

describe("formatDuration", () => {
  it("formats short and long media durations", () => {
    expect(formatDuration(5.2)).toBe("0:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("uses a placeholder for missing or invalid durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});
