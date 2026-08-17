import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
}));

import { TrustedWindowRegistry } from "../../../src/main/platform/trusted-window-registry";

function fakeWindow() {
  let closed: (() => void) | null = null;
  let destroyed = false;
  const mainFrame = {};
  return {
    window: {
      webContents: { mainFrame },
      isDestroyed: () => destroyed,
      once: (_event: string, callback: () => void) => { closed = callback; },
    } as unknown as Electron.BrowserWindow,
    frame: mainFrame as Electron.WebFrameMain,
    close: () => closed?.(),
    destroy: () => { destroyed = true; },
  };
}

describe("TrustedWindowRegistry", () => {
  beforeEach(() => electron.fromWebContents.mockReset());

  it("accepts registered main, board and auxiliary senders", () => {
    const registry = new TrustedWindowRegistry();
    const windows = [fakeWindow(), fakeWindow(), fakeWindow()];
    windows.forEach((entry) => registry.register(entry.window));
    windows.forEach((entry) => expect(registry.validateSender(entry.frame)).toBe(true));
  });

  it("rejects a descendant frame even when its top frame is trusted", () => {
    const registry = new TrustedWindowRegistry();
    const known = fakeWindow();
    registry.register(known.window);
    const descendant = { top: known.window.webContents.mainFrame } as Electron.WebFrameMain;
    expect(registry.validateSender(descendant)).toBe(false);
  });

  it("rejects unknown, closed and destroyed senders", () => {
    const registry = new TrustedWindowRegistry();
    const known = fakeWindow();
    const unknown = fakeWindow();
    registry.register(known.window);
    expect(registry.validateSender(unknown.frame)).toBe(false);
    known.destroy();
    expect(registry.validateSender(known.frame)).toBe(false);
    expect(() => registry.windowForSender({ sender: {} } as Electron.IpcMainInvokeEvent))
      .toThrow("UNKNOWN_IPC_SENDER_WINDOW");
  });

  it("never falls back when sender lookup has no live registered window", () => {
    const registry = new TrustedWindowRegistry();
    const known = fakeWindow();
    registry.register(known.window);
    electron.fromWebContents.mockReturnValue(null);
    expect(() => registry.windowForSender({ sender: {} } as Electron.IpcMainInvokeEvent))
      .toThrow("UNKNOWN_IPC_SENDER_WINDOW");
    electron.fromWebContents.mockReturnValue(known.window);
    expect(registry.windowForSender({ sender: {} } as Electron.IpcMainInvokeEvent)).toBe(known.window);
    known.close();
    expect(() => registry.windowForSender({ sender: {} } as Electron.IpcMainInvokeEvent))
      .toThrow("UNKNOWN_IPC_SENDER_WINDOW");
  });
});
