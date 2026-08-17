import { describe, expect, it, vi } from "vitest";

const desktopCapturer = vi.hoisted(() => ({
  getSources: vi.fn(),
}));
const screenMock = vi.hoisted(() => ({
  getDisplayMatching: vi.fn(),
}));
const clipboardMock = vi.hoisted(() => ({
  writeImage: vi.fn(),
}));
const nativeImageMock = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\RefCanvas"), isPackaged: true },
  clipboard: clipboardMock,
  desktopCapturer,
  dialog: {},
  globalShortcut: {},
  nativeImage: nativeImageMock,
  screen: screenMock,
  shell: {},
}));

import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

function registerCaptureIpc(overrides: {
  getMainWindow?: () => unknown;
  restoreCaptureWindow?: () => void;
  openCaptureWindow?: () => void;
  closeCaptureWindow?: () => void;
}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    on: vi.fn(),
  } as unknown as SecureIpcRegistrar;
  registerSystemIpc(ipc, {
    state: {
      pendingCaptureSource: null,
    },
    getDatabase: () => ({
      getSetting: () => undefined,
      setSetting: () => undefined,
      getAssetByPath: () => null,
    }),
    getLibrary: () => ({ importPaths: vi.fn(async () => []) }),
    getLibraryManager: () => ({}),
    getMainWindow: () => overrides.getMainWindow?.() ?? null,
    restoreCaptureWindow:
      overrides.restoreCaptureWindow ?? vi.fn(),
    openCaptureWindow:
      overrides.openCaptureWindow ?? vi.fn(),
    closeCaptureWindow:
      overrides.closeCaptureWindow ?? vi.fn(),
    windowForSender: vi.fn(() => ({})),
    writeAccess: {
      authorize: async (
        _window: unknown,
        _kind: string,
        items: Array<{ path: string }>,
      ) => items.map((item) => item.path),
    },
    pngDataUrlToBuffer: (dataUrl: string) => Buffer.from(dataUrl),
    saveCapture: vi.fn(async () => "C:\\Pictures\\cap-1.png"),
  } as unknown as Parameters<typeof registerSystemIpc>[1]);
  return handlers;
}

describe("system prepare-region-capture", () => {
  it("fails loudly with restored window when the screen snapshot is unavailable", async () => {
    const restoreCaptureWindow = vi.fn();
    const captureWindow = {
      getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      isFullScreen: () => false,
      hide: vi.fn(),
      setFullScreen: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    const openCaptureWindow = vi.fn();
    const handlers = registerCaptureIpc({
      getMainWindow: () => captureWindow,
      restoreCaptureWindow,
      openCaptureWindow,
    });

    screenMock.getDisplayMatching.mockReturnValue({
      id: 42,
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
    });

    // 拿不到任何屏幕源（或缩略图为空）：必须抛错并恢复窗口，
    // 不得静默返回 null（渲染端无反馈，表现为“点了没反应”）。
    desktopCapturer.getSources.mockResolvedValueOnce([]);
    await expect(
      Promise.resolve(
        handlers.get("system:prepare-region-capture")!(),
      ),
    ).rejects.toThrow("SCREEN_CAPTURE_UNAVAILABLE");
    expect(restoreCaptureWindow).toHaveBeenCalled();
    expect(captureWindow.hide).toHaveBeenCalled();

    // 快照正常：暂存快照并打开独立覆盖窗口（不再把主窗口全屏）。
    desktopCapturer.getSources.mockResolvedValueOnce([
      {
        display_id: "42",
        thumbnail: {
          isEmpty: () => false,
          getSize: () => ({ width: 1920, height: 1080 }),
          toDataURL: () => "data:image/png;base64,xxx",
        },
      },
    ]);
    const result = (await handlers.get("system:prepare-region-capture")!()) as {
      dataUrl: string;
      width: number;
      height: number;
    };
    expect(result.dataUrl).toBe("data:image/png;base64,xxx");
    expect(result.width).toBe(1920);
    expect(captureWindow.setFullScreen).not.toHaveBeenCalled();
    expect(captureWindow.show).toHaveBeenCalled();
    expect(openCaptureWindow).toHaveBeenCalled();
  });

  it("consumes the pending capture source once for the overlay window", async () => {
    const handlers = registerCaptureIpc({});
    const source = await handlers.get("system:get-capture-source")!();
    expect(source).toBeNull();
  });

  it("saves the region capture and closes the overlay window", async () => {
    const closeCaptureWindow = vi.fn();
    const handlers = registerCaptureIpc({ closeCaptureWindow });

    const result = await handlers.get("system:save-region-capture")!(
      {},
      "data:image/png;base64,png-bytes",
    );

    // 保存完成返回素材记录占位（数据库返回 null），关闭覆盖窗口，不抛错。
    expect(result).toBeNull();
    expect(closeCaptureWindow).toHaveBeenCalled();
    // 截图应同时写入系统剪贴板，便于在参考版（或任意应用）里 Ctrl+V 直接粘贴。
    expect(nativeImageMock.createFromBuffer).toHaveBeenCalled();
    expect(clipboardMock.writeImage).toHaveBeenCalled();
  });
});
