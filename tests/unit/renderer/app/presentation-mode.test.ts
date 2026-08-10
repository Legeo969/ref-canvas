import { describe, expect, it } from "vitest";
import {
  presentationModeForWorkspace,
  presentationTargetForF11,
} from "../../../../src/renderer/app/presentation-mode";

describe("board presentation-mode guard", () => {
  it("never applies board presentation styles to the disk workspace", () => {
    expect(presentationModeForWorkspace(true, "directory")).toBe(false);
    expect(presentationModeForWorkspace(true, "board")).toBe(true);
  });

  it("reserves F11 without entering presentation from the disk workspace", () => {
    expect(presentationTargetForF11(false, "directory")).toBeNull();
    expect(presentationTargetForF11(true, "directory")).toBe(false);
    expect(presentationTargetForF11(false, "board")).toBe(true);
    expect(presentationTargetForF11(true, "board")).toBe(false);
  });
});
