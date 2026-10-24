import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  shell: {},
}));

vi.mock("sharp", () => ({ default: sharpMock.factory }));

import { registerSystemIpc } from "../../../src/main/ipc/system-ipc";
import type { SecureIpcRegistrar } from "../../../src/main/platform/secure-ipc";

interface Harness {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  listeners: Map<string, (...args: unknown[]) => void>;
  state: {
    pendingCaptures: Map<
      number,
      { filePath: string; width: number; height: number }
    >;
  };
  startRegionCapture: ReturnType<typeof vi.fn>;
  endCaptureSession: ReturnType<typeof vi.fn>;
  discardPendingCaptures: ReturnType<typeof vi.fn>;
  broadcastOverlayMode: ReturnType<typeof vi.fn>;
  notifyCaptureSaved: ReturnType<typeof vi.fn>;
}

function registerCaptureIpc(overrides: {
  startRegionCapture?: () => Promise<void>;
} = {}): Harness {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    handleWithEvent: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    on: (channel: string, listener: (...args: unknown[]) => void) =>
      listeners.set(channel, listener),
  } as unknown as SecureIpcRegistrar;
  const state: Harness["state"] = { pendingCaptures: new Map() };
  const startRegionCapture = vi.fn(
    overrides.startRegionCapture ?? (async () => undefined),
  );
  const endCaptureSession = vi.fn();
  const discardPendingCaptures = vi.fn(async () => {
    state.pendingCaptures.clear();
  });
  const broadcastOverlayMode = vi.fn();
  const notifyCaptureSaved = vi.fn();
  registerSystemIpc(ipc, {
    state,
    getDatabase: () => ({
      getSetting: () => undefined,
      setSetting: () => undefined,
      getAssetByPath: () => null,
    }),
    getLibrary: () => ({ importPaths: vi.fn(async () => []) }),
    getLibraryManager: () => ({}),
    getMainWindow: () => ({}),
    startRegionCapture,
    endCaptureSession,
    discardPendingCaptures,
    broadcastOverlayMode,
    notifyCaptureSaved,
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
  return {
    handlers,
    listeners,
    state,
    startRegionCapture,
    endCaptureSession,
    discardPendingCaptures,
    broadcastOverlayMode,
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

describe("system prepare-region-capture", () => {
  it("delegates to the main-process capture session entry", async () => {
    // 编排（冻结全部显示器、锁定宿主、每屏覆盖窗）已移入主进程入口，
    // 渲染端标题栏按钮只是触发器——全局快捷键走同一条直连路径。
    const harness = registerCaptureIpc();
    await harness.handlers.get("system:prepare-region-capture")!();
    expect(harness.startRegionCapture).toHaveBeenCalledTimes(1);
  });

  it("rethrows so the renderer can show why the screen was not frozen", async () => {
    // 失败必须显式抛错：静默返回会让用户只看到屏幕闪一下。
    const harness = registerCaptureIpc({
      startRegionCapture: async () => {
        throw new Error("SCREEN_CAPTURE_UNAVAILABLE");
      },
    });
    await expect(
      Promise.resolve(harness.handlers.get("system:prepare-region-capture")!()),
    ).rejects.toThrow("SCREEN_CAPTURE_UNAVAILABLE");
    expect(harness.endCaptureSession).not.toHaveBeenCalled();
  });
});

describe("system save-region-capture", () => {
  function seedSession(harness: Harness): void {
    // 多屏会话：屏 7 与屏 9 各有一张冻结底图。
    harness.state.pendingCaptures.set(7, {
      filePath: "C:\\RefCanvas\\capture-cache\\current-1.png",
      width: 1920,
      height: 1080,
    });
    harness.state.pendingCaptures.set(9, {
      filePath: "C:\\RefCanvas\\capture-cache\\current-2.png",
      width: 2560,
      height: 1440,
    });
  }

  it("crops the frozen frame of the display that was selected", async () => {
    const harness = registerCaptureIpc();
    seedSession(harness);

    const result = await harness.handlers.get("system:save-region-capture")!(
      {},
      { displayId: 9, sourceLeft: 100, sourceTop: 50, sourceWidth: 640, sourceHeight: 360 },
    );

    // 主进程裁剪，且取的是屏 9 的底图（displayId 路由，不碰别的屏）。
    expect(sharpMock.factory).toHaveBeenCalledWith(
      "C:\\RefCanvas\\capture-cache\\current-2.png",
    );
    expect(sharpMock.extract).toHaveBeenCalledWith({
      left: 100,
      top: 50,
      width: 640,
      height: 360,
    });
    expect(nativeImageMock.createFromBuffer).toHaveBeenCalled();
    expect(clipboardMock.writeImage).toHaveBeenCalled();
    // 覆盖窗口随即关闭，保存成功的反馈必须通知主窗口去弹 toast。
    expect(harness.notifyCaptureSaved).toHaveBeenCalled();
    expect(harness.discardPendingCaptures).toHaveBeenCalled();
    expect(harness.endCaptureSession).toHaveBeenCalledWith("saved");
    // 数据库返回 null（测试桩），保存流程本身不抛错。
    expect(result).toBeNull();
  });

  it("fails loudly when the display has no frozen frame", async () => {
    const harness = registerCaptureIpc();
    seedSession(harness);
    await expect(
      Promise.resolve(
        harness.handlers.get("system:save-region-capture")!(
          {},
          { displayId: 123, sourceLeft: 0, sourceTop: 0, sourceWidth: 10, sourceHeight: 10 },
        ),
      ),
    ).rejects.toThrow("CAPTURE_SOURCE_MISSING");
    // 校验失败不收会话：覆盖窗保持打开，用户还能重选或 Esc 取消。
    expect(harness.endCaptureSession).not.toHaveBeenCalled();
    expect(harness.discardPendingCaptures).not.toHaveBeenCalled();
  });

  it("rejects a crop that falls outside that display's frozen frame", async () => {
    const harness = registerCaptureIpc();
    seedSession(harness);
    await expect(
      Promise.resolve(
        harness.handlers.get("system:save-region-capture")!(
          {},
          { displayId: 7, sourceLeft: 1900, sourceTop: 0, sourceWidth: 200, sourceHeight: 100 },
        ),
      ),
    ).rejects.toThrow("CAPTURE_CROP_OUT_OF_RANGE");
    expect(sharpMock.factory).not.toHaveBeenCalled();
    expect(harness.endCaptureSession).not.toHaveBeenCalled();
  });

  it("keeps the session alive when saving throws so the error stays visible", async () => {
    // 保存失败（如写盘被拒）时不能立刻关窗收会话——那样覆盖窗上的报错
    // 一闪而过、底图被删，用户既看不到原因也无法重试。
    const harness = registerCaptureIpc();
    seedSession(harness);
    const { factory } = sharpMock;
    factory.mockImplementationOnce(() => {
      throw new Error("WRITE_DENIED");
    });

    await expect(
      Promise.resolve(
        harness.handlers.get("system:save-region-capture")!(
          {},
          { displayId: 7, sourceLeft: 0, sourceTop: 0, sourceWidth: 100, sourceHeight: 100 },
        ),
      ),
    ).rejects.toThrow("WRITE_DENIED");
    expect(harness.notifyCaptureSaved).not.toHaveBeenCalled();
    expect(harness.discardPendingCaptures).not.toHaveBeenCalled();
    expect(harness.endCaptureSession).not.toHaveBeenCalled();
    // 底图保留，重试仍可用。
    expect(harness.state.pendingCaptures.size).toBe(2);
  });
});

describe("system cancel-region-capture", () => {
  it("drops temp frames and ends the session without touching the host", async () => {
    const harness = registerCaptureIpc();
    harness.state.pendingCaptures.set(7, {
      filePath: "C:\\RefCanvas\\capture-cache\\current-1.png",
      width: 1920,
      height: 1080,
    });
    await Promise.resolve(harness.handlers.get("system:cancel-region-capture")!());
    expect(harness.discardPendingCaptures).toHaveBeenCalled();
    // "cancelled"：宿主保持会话前的原状（热键路径下隐藏的保持隐藏）。
    expect(harness.endCaptureSession).toHaveBeenCalledWith("cancelled");
  });
});

describe("capture:selection-active", () => {
  it("broadcasts passive to the other overlays when a screen starts selecting", () => {
    const harness = registerCaptureIpc();
    const listener = harness.listeners.get("capture:selection-active")!;

    listener({ sender: { id: 12 } }, true);
    expect(harness.broadcastOverlayMode).toHaveBeenCalledWith(12, "passive");

    listener({ sender: { id: 12 } }, false);
    expect(harness.broadcastOverlayMode).toHaveBeenCalledWith(12, "active");
  });
});
