import { describe, expect, it } from "vitest";
import { isProtectedSystemDirectory } from "../../../src/shared/system-directory-filter";

describe("isProtectedSystemDirectory", () => {
  it("hides Windows-managed roots without hiding ordinary folders or files", () => {
    expect(isProtectedSystemDirectory("$RECYCLE.BIN", true)).toBe(true);
    expect(isProtectedSystemDirectory("System Volume Information", true)).toBe(true);
    expect(isProtectedSystemDirectory("system volume information", true)).toBe(true);
    expect(isProtectedSystemDirectory("System Volume Information", false)).toBe(false);
    expect(isProtectedSystemDirectory("素材", true)).toBe(false);
  });
});
