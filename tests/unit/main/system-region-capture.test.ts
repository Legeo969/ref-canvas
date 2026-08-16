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
    state: {},
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
    const handlers = registerCaptureIpc({
      getMainWindow: () => captureWindow,
      restoreCaptureWindow,
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

    // 快照正常：返回 dataUrl/尺寸并进入全屏覆盖。
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
    expect(captureWindow.setFullScreen).toHaveBeenCalledWith(true);
    expect(captureWindow.show).toHaveBeenCalled();
  });

  it("saves the region capture and restores the window", async () => {
    const restoreCaptureWindow = vi.fn();
    const handlers = registerCaptureIpc({ restoreCaptureWindow });

    const result = await handlers.get("system:save-region-capture")!(
      {},
      "data:image/png;base64,png-bytes",
    );

    // 保存完成返回素材记录占位（数据库返回 null），窗口恢复，不抛错。
    expect(result).toBeNull();
    expect(restoreCaptureWindow).toHaveBeenCalled();
    // 截图不再写入系统剪贴板（按需移除）：writeImage 不应被调用。
    expect(clipboardMock.writeImage).not.toHaveBeenCalled();
  });
});
