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
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

interface WindowStub {
  id: number;
  isAlwaysOnTop: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
}

function createWindowStub(
  alwaysOnTop: boolean,
  id = 42,
): { window: WindowStub; setAlwaysOnTop: WindowStub["setAlwaysOnTop"] } {
  const window: WindowStub = {
    id,
    isAlwaysOnTop: vi.fn(() => alwaysOnTop),
    setAlwaysOnTop: vi.fn(),
  };
  return { window, setAlwaysOnTop: window.setAlwaysOnTop };
}

function registerIpc(window: WindowStub): Map<string, (...args: unknown[]) => unknown> {
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
    getDatabase: () => ({}),
    getLibrary: () => ({}),
    getLibraryManager: () => ({}),
    getMainWindow: () => null,
    windowForSender: () => window as never,
  } as unknown as Parameters<typeof registerSystemIpc>[1]);
  return handlers;
}

const EVENT = { sender: { id: 42 } } as never;

describe("system:set-interaction-lift", () => {
  it("lifts with pop-up-menu level once and restores the prior non-top state", () => {
    const { window, setAlwaysOnTop } = createWindowStub(false);
    const handlers = registerIpc(window);
    const lift = handlers.get("system:set-interaction-lift")!;

    lift(EVENT, true);
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, "pop-up-menu");
    // 防重复 enable：同一窗口已抬升时不重复快照/置顶。
    lift(EVENT, true);
    expect(setAlwaysOnTop).toHaveBeenCalledTimes(1);

    // disable 按快照还原（prior = false → 非置顶）。
    lift(EVENT, false);
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(false);

    // 未抬升时 disable 为 no-op。
    lift(EVENT, false);
    expect(setAlwaysOnTop).toHaveBeenCalledTimes(2);

    // 还原后可再次抬升（快照随 disable 清除）。
    lift(EVENT, true);
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(true, "pop-up-menu");
  });

  it("restores an already always-on-top window without resetting its level", () => {
    const { window, setAlwaysOnTop } = createWindowStub(true);
    const handlers = registerIpc(window);
    const lift = handlers.get("system:set-interaction-lift")!;

    lift(EVENT, true);
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, "pop-up-menu");
    // prior = true：还原时只传布尔，不带 level（避免重置窗口等级）。
    lift(EVENT, false);
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(setAlwaysOnTop).toHaveBeenCalledTimes(2);
  });

  it("rejects non-boolean payloads", () => {
    const { window } = createWindowStub(false);
    const handlers = registerIpc(window);
    expect(() => handlers.get("system:set-interaction-lift")!(EVENT, "yes")).toThrow();
  });
});
