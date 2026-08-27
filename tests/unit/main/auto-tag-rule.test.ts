import { describe, expect, it } from "vitest";
import { autoTagRuleMatches } from "../../../src/main/services/library-service";

describe("autoTagRuleMatches", () => {
  it("requires every configured filename, path and extension condition", () => {
    const rule = {
      filenamePattern: "*concept*",
      pathPattern: "references",
      extension: "png",
    };
    expect(autoTagRuleMatches(rule, "concept-01.png", "D:\\art\\references", "png")).toBe(true);
    expect(autoTagRuleMatches(rule, "concept-01.png", "D:\\art\\final", "png")).toBe(false);
    expect(autoTagRuleMatches(rule, "photo.png", "D:\\art\\references", "png")).toBe(false);
  });
});
