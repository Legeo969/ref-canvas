import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { trayIconPaths } from "../../../src/main/platform/tray-icon";

describe("tray icon", () => {
  it("resolves to packaged application assets", () => {
    const root = path.resolve(".");
    const candidates = trayIconPaths(root);

    expect(candidates.map((candidate) => path.relative(root, candidate))).toEqual([
      path.join("assets", "app", "refcanvas.png"),
      path.join("assets", "installer", "refcanvas.ico"),
    ]);
    expect(candidates.every(existsSync)).toBe(true);
  });
});
