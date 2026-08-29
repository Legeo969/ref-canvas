import path from "node:path";
import { readFile } from "node:fs/promises";
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

describe("release-windows script guards", () => {
  // 回归：0.39.3 构建时 releasify 把临时 zip 写进服务账户 profile，
  // Setup.exe 内嵌失败仍以 0 退出，脚本校验只查文件名导致 236KB 空壳
  // 安装包差点发布。守护脚本里的两道防线不被移除。
  it("pins child TMP/TEMP to the user profile temp", async () => {
    const script = await readFile(
      path.resolve("scripts/build/release-windows.cjs"),
      "utf8",
    );
    expect(script).toMatch(
      /const userTempDirectory = process\.env\.USERPROFILE\s*\?\s*path\.join\(process\.env\.USERPROFILE, "AppData", "Local", "Temp"\)\s*:\s*undefined;/,
    );
    expect(script).toMatch(/process\.env\.TMP = userTempDirectory;/);
    expect(script).toMatch(/process\.env\.TEMP = userTempDirectory;/);
  });

  it("rejects a Setup.exe that does not embed the full nupkg", async () => {
    const script = await readFile(
      path.resolve("scripts/build/release-windows.cjs"),
      "utf8",
    );
    expect(script).toMatch(
      /WINDOWS_RELEASE_SETUP_MISSING_EMBEDDED_PAYLOAD/,
    );
    expect(script).toMatch(
      /fs\.statSync\(setup\)\.size <= fs\.statSync\(fullPackage\)\.size/,
    );
  });
});
