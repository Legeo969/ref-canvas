import { describe, expect, it, vi } from "vitest";
import { registerLibraryIpc } from "../../../src/main/ipc/library-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("library preference IPC", () => {
  it("accepts the renderer workbench width through 1200px", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as SecureIpcRegistrar;
    const setPreferences = vi.fn((value: unknown) => value);
    registerLibraryIpc(ipc, {
      getDatabase: () => ({}),
      getLibrary: () => ({ setPreferences }),
      copyProjectAsset: vi.fn(),
      safeFilename: (value: string) => value,
      windowForSender: vi.fn(),
    } as unknown as Parameters<typeof registerLibraryIpc>[1]);

    const handler = handlers.get("library:set-preferences");
    const panelLayout = {
      sidebarWidth: 260,
      assetWidth: 350,
      detailsWidth: 1200,
      collapsed: [],
    };
    expect(handler?.({ panelLayout })).toEqual({ panelLayout });
    expect(setPreferences).toHaveBeenCalledWith({ panelLayout });
    expect(() => handler?.({ panelLayout: { ...panelLayout, detailsWidth: 1201 } })).toThrow();
  });
});
