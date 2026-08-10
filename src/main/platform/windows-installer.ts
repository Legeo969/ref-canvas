import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

export type SquirrelLifecycleEvent =
  | "--squirrel-install"
  | "--squirrel-updated"
  | "--squirrel-uninstall"
  | "--squirrel-obsolete";

const SQUIRREL_LIFECYCLE_EVENTS = new Set<SquirrelLifecycleEvent>([
  "--squirrel-install",
  "--squirrel-updated",
  "--squirrel-uninstall",
  "--squirrel-obsolete",
]);

/** Maintenance invocations must exit quickly; --squirrel-firstrun is a normal app launch. */
export function getSquirrelLifecycleEvent(
  argv: readonly string[],
): SquirrelLifecycleEvent | null {
  for (const value of argv) {
    if (SQUIRREL_LIFECYCLE_EVENTS.has(value as SquirrelLifecycleEvent)) {
      return value as SquirrelLifecycleEvent;
    }
  }
  return null;
}

export function isSquirrelFirstRun(argv: readonly string[]): boolean {
  return argv.includes("--squirrel-firstrun");
}

/** RefCanvas.exe lives in app-X.Y.Z; Squirrel's Update.exe is one directory above. */
export function resolveWindowsUpdateExecutable(execPath: string): string {
  return path.resolve(path.dirname(execPath), "..", "Update.exe");
}

export function isWindowsUninstallAvailable(
  platform: NodeJS.Platform,
  isPackaged: boolean,
): boolean {
  return platform === "win32" && isPackaged;
}

export async function launchWindowsUninstaller(
  execPath = process.execPath,
): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("UNINSTALL_UNAVAILABLE");
  }
  const updateExecutable = resolveWindowsUpdateExecutable(execPath);
  await access(updateExecutable);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(updateExecutable, ["--uninstall"], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
