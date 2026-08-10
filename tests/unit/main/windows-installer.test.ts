import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSquirrelLifecycleEvent,
  isSquirrelFirstRun,
  isWindowsUninstallAvailable,
  resolveWindowsUpdateExecutable,
} from "../../../src/main/platform/windows-installer";

describe("Windows Squirrel lifecycle", () => {
  it("treats firstrun as a normal launch instead of a maintenance event", () => {
    const argv = ["RefCanvas.exe", "--squirrel-firstrun"];
    expect(getSquirrelLifecycleEvent(argv)).toBeNull();
    expect(isSquirrelFirstRun(argv)).toBe(true);
  });

  it.each([
    "--squirrel-install",
    "--squirrel-updated",
    "--squirrel-uninstall",
    "--squirrel-obsolete",
  ] as const)("recognizes %s as a maintenance event", (event) => {
    expect(getSquirrelLifecycleEvent(["RefCanvas.exe", event, "0.38.0"])).toBe(
      event,
    );
  });

  it("resolves Update.exe beside the app-version directory", () => {
    const installRoot = path.resolve("C:/Users/test/AppData/Local/ref_canvas");
    const executable = path.join(
      installRoot,
      "app-0.38.0",
      "RefCanvas.exe",
    );
    expect(resolveWindowsUpdateExecutable(executable)).toBe(
      path.join(installRoot, "Update.exe"),
    );
  });

  it("only exposes application uninstall in packaged Windows builds", () => {
    expect(isWindowsUninstallAvailable("win32", true)).toBe(true);
    expect(isWindowsUninstallAvailable("win32", false)).toBe(false);
    expect(isWindowsUninstallAvailable("darwin", true)).toBe(false);
  });
});
