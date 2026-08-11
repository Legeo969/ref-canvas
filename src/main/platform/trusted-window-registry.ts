import { BrowserWindow, type IpcMainInvokeEvent, type WebFrameMain } from "electron";

export class TrustedWindowRegistry {
  private readonly windows = new Set<BrowserWindow>();

  register(window: BrowserWindow): void {
    this.windows.add(window);
    window.once("closed", () => this.windows.delete(window));
  }

  unregister(window: BrowserWindow): void {
    this.windows.delete(window);
  }

  validateSender(frame: WebFrameMain | null): boolean {
    if (!frame) return false;
    for (const window of this.windows) {
      if (!window.isDestroyed() && frame === window.webContents.mainFrame) return true;
    }
    return false;
  }

  windowForSender(event: IpcMainInvokeEvent): BrowserWindow {
    const candidate = BrowserWindow.fromWebContents(event.sender);
    if (!candidate || candidate.isDestroyed() || !this.windows.has(candidate)) {
      throw new Error("UNKNOWN_IPC_SENDER_WINDOW");
    }
    return candidate;
  }
}
