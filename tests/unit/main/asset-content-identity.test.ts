import { describe, expect, it } from "vitest";
import { hasSameAssetContentIdentity } from "../../../src/main/persistence/asset-content-identity";

describe("hasSameAssetContentIdentity", () => {
  it.each([
    [{ size: 10, fingerprint: null }, { size: 10, fingerprint: null }, true],
    [{ size: 10, fingerprint: undefined }, { size: 10, fingerprint: undefined }, true],
    [{ size: 10, fingerprint: null }, { size: 10, fingerprint: "hash" }, false],
    [{ size: 10, fingerprint: "hash" }, { size: 11, fingerprint: "hash" }, false],
    [{ size: 10, fingerprint: "a" }, { size: 10, fingerprint: "b" }, false],
  ])("compares size and nullable fingerprint", (current, next, expected) => {
    expect(hasSameAssetContentIdentity(current, next)).toBe(expected);
  });
});
