import type { WebContents, WebPreferences } from "electron";

export function secureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

export function hardenWindowNavigation(
  webContents: Pick<
    WebContents,
    "getURL" | "on" | "setWindowOpenHandler"
  >,
): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== webContents.getURL()) event.preventDefault();
  });
}
