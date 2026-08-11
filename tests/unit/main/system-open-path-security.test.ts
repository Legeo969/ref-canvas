import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ openPath: vi.fn(async () => "") }));
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\RefCanvas"), isPackaged: true },
  clipboard: {},
  desktopCapturer: {},
  dialog: {},
  globalShortcut: {},
  nativeImage: {},
  screen: {},
  shell: { openPath: electron.openPath },
}));

import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("system local file opening", () => {
  it("uses openPath and rejects URL, UNC, device and relative inputs", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as SecureIpcRegistrar;
    registerSystemIpc(ipc, {
      state: {},
      getDatabase: () => ({}),
      getLibrary: () => ({}),
      getLibraryManager: () => ({}),
      getMainWindow: () => null,
    } as unknown as Parameters<typeof registerSystemIpc>[1]);

    await handlers.get("system:open-external")!("C:\\images\\frame.exr");
    expect(electron.openPath).toHaveBeenCalledWith("C:\\images\\frame.exr");
    for (const candidate of [
      "https://example.com/file.exr",
      "relative.exr",
      "\\\\server\\share\\file.exr",
      "\\\\?\\C:\\file.exr",
    ]) {
      await expect(Promise.resolve().then(() => handlers.get("system:open-external")!(candidate)))
        .rejects.toThrow("INVALID_LOCAL_PATH");
    }
    await expect(Promise.resolve().then(() => handlers.get("system:open-files-with-default-app")!([
      "C:\\ok.exr",
      "https://evil.example/payload",
    ]))).rejects.toThrow("INVALID_LOCAL_PATH");
  });
});
