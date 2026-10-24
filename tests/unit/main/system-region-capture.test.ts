import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const screenMock = vi.hoisted(() => ({
  getDisplayMatching: vi.fn(),
}));
const clipboardMock = vi.hoisted(() => ({
  writeImage: vi.fn(),
}));
const nativeImageMock = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
}));
const sharpMock = vi.hoisted(() => {
  const toBuffer = vi.fn(async () => Buffer.from("cropped"));
  const extract = vi.fn(() => ({ png: () => ({ toBuffer }) }));
  const factory = vi.fn(() => ({ extract }));
  return { factory, extract, toBuffer };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\RefCanvas"), isPackaged: true },
  clipboard: clipboardMock,
  dialog: {},
  globalShortcut: {},
  nativeImage: nativeImageMock,
  screen: screenMock,
  shell: {},
}));

vi.mock("sharp", () => ({ default: sharpMock.factory }));

import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

interface Harness {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  state: {
    pendingCaptureFile: string | null;
    pendingCaptureSize: { width: number; height: number } | null;
  };
  closeCaptureWindow: ReturnType<typeof vi.fn>;
  discardPendingCapture: ReturnType<typeof vi.fn>;
  showCaptureWindow: ReturnType<typeof vi.fn>;
  captureScreen: ReturnType<typeof vi.fn>;
  notifyCaptureSaved: ReturnType<typeof vi.fn>;
}

function registerCaptureIpc(overrides: {
  getMainWindow?: () => unknown;
  captureScreen?: () => Promise<unknown>;
  showCaptureWindow?: () => void;
  closeCaptureWindow?: () => void;
  discardPendingCapture?: () => Promise<void>;
} = {}): Harness {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    on: vi.fn(),
  } as unknown as SecureIpcRegistrar;
  const state: Harness["state"] = {
    pendingCaptureFile: null,
    pendingCaptureSize: null,
  };
  const closeCaptureWindow = vi.fn(overrides.closeCaptureWindow);
  const discardPendingCapture = vi.fn(
    overrides.discardPendingCapture ?? (async () => {
      state.pendingCaptureFile = null;
      state.pendingCaptureSize = null;
    }),
  );
  const showCaptureWindow = vi.fn(overrides.showCaptureWindow);
  const notifyCaptureSaved = vi.fn();
  const captureScreen = vi.fn(
    overrides.captureScreen ??
      (async () => ({
        filePath: "C:\\RefCanvas\\capture-cache\\current-1.png",
        width: 1920,
        height: 1080,
        backend: "native" as const,
      })),
  );
  registerSystemIpc(ipc, {
    state,
    getDatabase: () => ({
      getSetting: () => undefined,
      setSetting: () => undefined,
      getAssetByPath: () => null,
    }),
    getLibrary: () => ({ importPaths: vi.fn(async () => []) }),
    getLibraryManager: () => ({}),
    getMainWindow: () => overrides.getMainWindow?.() ?? null,
    closeCaptureWindow,
    captureScreen,
    showCaptureWindow,
    discardPendingCapture,
    previewTokens: { tokenFor: () => "11111111-1111-4111-8111-111111111111" },
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
    notifyCaptureSaved,
  } as unknown as Parameters<typeof registerSystemIpc>[1]);
  return {
    handlers,
    state,
    closeCaptureWindow,
    discardPendingCapture,
    showCaptureWindow,
    captureScreen,
    notifyCaptureSaved,
  };
}

// sharp / clipboard 的 mock 是模块级的，测试之间必须清干净，否则
// "没有发生裁剪" 这类否定断言会被上一个用例的调用污染。
beforeEach(() => {
  sharpMock.extract.mockClear();
  sharpMock.toBuffer.mockClear();
  sharpMock.factory.mockClear();
  nativeImageMock.createFromBuffer.mockClear();
  clipboardMock.writeImage.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 抓屏走"所见即所得"，主窗口在整条链路里只被读几何：hide/show/
// setContentProtection 一旦被调用就是回归，所以桩上都留成可断言的 spy。
function mainWindowStub() {
  return {
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false,
    setContentProtection: vi.fn(),
  };
}

describe("system prepare-region-capture", () => {
  it("captures the screen as-is and pushes a refbrowse url", async () => {
    const window = mainWindowStub();
    const harness = registerCaptureIpc({ getMainWindow: () => window });
    screenMock.getDisplayMatching.mockReturnValue({
      id: 42,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
    });

    await harness.handlers.get("system:prepare-region-capture")!();

    // 所见即所得：宿主不隐藏、不自排除。
    //
    // 之前用 setContentProtection + hide 把 RefCanvas 从捕获结果里剔掉，
    // 宿主最大化时会把整块屏挖空，冻结预览里只剩壁纸。QQ 截图拍的是按下
    // 瞬间的真实画面，所以这两步都不能有。
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.setContentProtection).not.toHaveBeenCalled();
    expect(harness.captureScreen).toHaveBeenCalled();
    // 底图经 push 推出，且不携带任何图像字节。
    expect(harness.showCaptureWindow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      {
        imageUrl: "refbrowse://preview/11111111-1111-4111-8111-111111111111",
        width: 1920,
        height: 1080,
      },
    );
    expect(harness.state.pendingCaptureFile).toBe(
      "C:\\RefCanvas\\capture-cache\\current-1.png",
    );
    expect(harness.state.pendingCaptureSize).toEqual({ width: 1920, height: 1080 });
  });

  it("rethrows when capture fails without touching the window", async () => {
    const window = mainWindowStub();
    const harness = registerCaptureIpc({
      getMainWindow: () => window,
      captureScreen: async () => {
        throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
      },
    });
    screenMock.getDisplayMatching.mockReturnValue({
      id: 42,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
    });

    // 失败必须显式抛错：静默返回会让用户只看到窗口闪一下。
    await expect(
      Promise.resolve(harness.handlers.get("system:prepare-region-capture")!()),
    ).rejects.toThrow("SCREEN_CAPTURE_UNAVAILABLE");
    // 窗口全程没被动过，所以也没有需要"还原"的状态。
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(harness.showCaptureWindow).not.toHaveBeenCalled();
  });
});

describe("system save-region-capture", () => {
  it("crops in the main process, writes to clipboard, and closes the overlay", async () => {
    const harness = registerCaptureIpc({});
    harness.state.pendingCaptureFile = "C:\\RefCanvas\\capture-cache\\current-1.png";
    harness.state.pendingCaptureSize = { width: 1920, height: 1080 };

    const result = await harness.handlers.get("system:save-region-capture")!(
      {},
      { sourceLeft: 100, sourceTop: 50, sourceWidth: 640, sourceHeight: 360 },
    );

    // 主进程裁剪，渲染端不再导 base64。
    expect(sharpMock.extract).toHaveBeenCalledWith({
      left: 100,
      top: 50,
      width: 640,
      height: 360,
    });
    expect(nativeImageMock.createFromBuffer).toHaveBeenCalled();
    expect(clipboardMock.writeImage).toHaveBeenCalled();
    expect(harness.closeCaptureWindow).toHaveBeenCalled();
    expect(harness.discardPendingCapture).toHaveBeenCalled();
    // 覆盖窗口随即关闭，保存成功的反馈必须通知主窗口去弹 toast。
    expect(harness.notifyCaptureSaved).toHaveBeenCalled();
    // 数据库返回 null（测试桩），保存流程本身不抛错。
    expect(result).toBeNull();
  });

  it("rejects a crop that falls outside the captured screen", async () => {
    const harness = registerCaptureIpc({});
    harness.state.pendingCaptureFile = "C:\\RefCanvas\\capture-cache\\current-1.png";
    harness.state.pendingCaptureSize = { width: 1920, height: 1080 };

    await expect(
      Promise.resolve(
        harness.handlers.get("system:save-region-capture")!(
          {},
          { sourceLeft: 1900, sourceTop: 0, sourceWidth: 200, sourceHeight: 100 },
        ),
      ),
    ).rejects.toThrow("CAPTURE_CROP_OUT_OF_RANGE");
    expect(sharpMock.extract).not.toHaveBeenCalled();
  });

  it("fails loudly when no capture is pending", async () => {
    const harness = registerCaptureIpc({});
    await expect(
      Promise.resolve(
        harness.handlers.get("system:save-region-capture")!(
          {},
          { sourceLeft: 0, sourceTop: 0, sourceWidth: 10, sourceHeight: 10 },
        ),
      ),
    ).rejects.toThrow("CAPTURE_SOURCE_MISSING");
  });
});

describe("system cancel-region-capture", () => {
  it("drops the temp file and hides the overlay", async () => {
    const harness = registerCaptureIpc({});
    await Promise.resolve(harness.handlers.get("system:cancel-region-capture")!());
    expect(harness.discardPendingCapture).toHaveBeenCalled();
    expect(harness.closeCaptureWindow).toHaveBeenCalled();
  });
});
