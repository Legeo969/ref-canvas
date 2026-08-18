import { describe, expect, it } from "vitest";
import {
  defaultRemapRules,
  pathKeyFor,
  remapPath,
} from "../../../src/main/services/path-remap";

describe("SPEC-2 path remap (pure functions)", () => {
  it("remaps a path under the exported root to the new root", () => {
    const rules = [
      { from: "D:\\Assets.library", to: "E:\\Assets.library" },
    ];
    const result = remapPath("D:\\Assets.library\\foo\\bar.png", rules);
    expect(result).toBe("E:\\Assets.library\\foo\\bar.png");
  });

  it("matches by longest root first", () => {
    const rules = [
      { from: "D:\\a", to: "E:\\a" },
      { from: "D:\\a\\b", to: "E:\\b" },
    ];
    expect(remapPath("D:\\a\\b\\c.png", rules)).toBe("E:\\b\\c.png");
    expect(remapPath("D:\\a\\x.png", rules)).toBe("E:\\a\\x.png");
  });

  it("leaves paths outside all roots unchanged", () => {
    const rules = [{ from: "D:\\Assets.library", to: "E:\\Assets.library" }];
    expect(remapPath("C:\\other\\file.png", rules)).toBe("C:\\other\\file.png");
  });

  it("computes pathKey normalized and lowercased", () => {
    expect(pathKeyFor("D:\\Foo\\Bar.PNG")).toBe("d:\\foo\\bar.png");
  });

  it("defaultRemapRules uses chosen roots and falls back to original", () => {
    const rules = defaultRemapRules(
      ["D:\\Assets.library", "C:\\Users\\me\\refs"],
      [{ from: "D:\\Assets.library", to: "E:\\new" }],
    );
    expect(rules).toContainEqual({
      from: "D:\\Assets.library",
      to: "E:\\new",
    });
    expect(rules).toContainEqual({
      from: "C:\\Users\\me\\refs",
      to: "C:\\Users\\me\\refs",
    });
  });
});
