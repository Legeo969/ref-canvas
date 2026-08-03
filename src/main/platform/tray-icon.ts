import path from "node:path";

export function trayIconPaths(appPath: string): string[] {
  return [
    path.join(appPath, "assets", "app", "refcanvas.png"),
    path.join(appPath, "assets", "installer", "refcanvas.ico"),
  ];
}
