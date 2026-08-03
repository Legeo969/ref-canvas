import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function registerWindowsSendTo(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const sendToDirectory = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "SendTo",
  );
  await mkdir(sendToDirectory, { recursive: true });
  shell.writeShortcutLink(path.join(sendToDirectory, "RefCanvas.lnk"), "create", {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    description: "发送素材或 RefCanvas 项目到 RefCanvas",
  });
}

export async function registerWindowsProjectFormat(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const classesRoot = "HKCU\\Software\\Classes";
  const command = `"${process.execPath}" "%1"`;
  await execFileAsync("reg.exe", [
    "add",
    `${classesRoot}\\.refcanvas`,
    "/ve",
    "/d",
    "RefCanvas.Project",
    "/f",
  ]);
  await execFileAsync("reg.exe", [
    "add",
    `${classesRoot}\\RefCanvas.Project`,
    "/ve",
    "/d",
    "RefCanvas Project",
    "/f",
  ]);
  await execFileAsync("reg.exe", [
    "add",
    `${classesRoot}\\RefCanvas.Project\\DefaultIcon`,
    "/ve",
    "/d",
    `${process.execPath},0`,
    "/f",
  ]);
  await execFileAsync("reg.exe", [
    "add",
    `${classesRoot}\\RefCanvas.Project\\shell\\open\\command`,
    "/ve",
    "/d",
    command,
    "/f",
  ]);
}

export async function removeWindowsIntegration(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  await rm(
    path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "SendTo",
      "RefCanvas.lnk",
    ),
    { force: true },
  );
  await execFileAsync("reg.exe", [
    "delete",
    "HKCU\\Software\\Classes\\.refcanvas",
    "/f",
  ]).catch(() => undefined);
  await execFileAsync("reg.exe", [
    "delete",
    "HKCU\\Software\\Classes\\RefCanvas.Project",
    "/f",
  ]).catch(() => undefined);
}

export async function updateSquirrelShortcut(
  action: "--createShortcut" | "--removeShortcut",
): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const updateExecutable = path.resolve(
    path.dirname(process.execPath),
    "..",
    "Update.exe",
  );
  await execFileAsync(updateExecutable, [action, path.basename(process.execPath)]);
}
