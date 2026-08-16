import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\RefCanvas"), isPackaged: true },
  clipboard: {},
  desktopCapturer: {},
  dialog: {},
  globalShortcut: {},
  nativeImage: {},
  screen: {},
  shell: {},
}));

import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import { SIDEBAR_LAYOUT_DEFAULTS } from "../../../src/shared/contracts";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

describe("system preferences sidebar layout", () => {
  it("merges stored pane heights over defaults and persists patches", () => {
    const store = new Map<string, unknown>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      on: vi.fn(),
    } as unknown as SecureIpcRegistrar;
    registerSystemIpc(ipc, {
      state: {},
      getDatabase: () => ({
        getSetting: (key: string, fallback: unknown) =>
          store.has(key) ? store.get(key) : fallback,
        setSetting: (key: string, value: unknown) => store.set(key, value),
      }),
      getLibrary: () => ({}),
      getLibraryManager: () => ({}),
      getMainWindow: () => null,
    } as unknown as Parameters<typeof registerSystemIpc>[1]);

    // 旧库无 sidebarLayout 键：读取回退默认（字段级合并，防旧版本部分字段）。
    expect(handlers.get("system:get-preferences")!()).toMatchObject({
      sidebarLayout: SIDEBAR_LAYOUT_DEFAULTS,
    });
    // 部分字段损坏（历史脏数据）也能被默认值补齐。
    store.set("sidebarLayout", { boardHeight: 260 });
    expect(handlers.get("system:get-preferences")!()).toMatchObject({
      sidebarLayout: { ...SIDEBAR_LAYOUT_DEFAULTS, boardHeight: 260 },
    });

    // patch 只传要改的字段：与已存值合并后写入完整对象。
    handlers.get("system:set-preferences")!({
      sidebarLayout: { boardHeight: 333, directoryHeight: 400 },
    });
    expect(store.get("sidebarLayout")).toEqual({
      ...SIDEBAR_LAYOUT_DEFAULTS,
      boardHeight: 333,
      directoryHeight: 400,
    });
    expect(handlers.get("system:get-preferences")!()).toMatchObject({
      sidebarLayout: {
        ...SIDEBAR_LAYOUT_DEFAULTS,
        boardHeight: 333,
        directoryHeight: 400,
      },
    });

    // 越界值被 zod 拒绝（渲染端 clamp 之外的第二道防线）。
    expect(() =>
      handlers.get("system:set-preferences")!({
        sidebarLayout: { boardHeight: 4 },
      }),
    ).toThrow();
  });
});
