// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, RefCanvasApi } from "../../../../src/shared/contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MockVideoFrame {
  close: ReturnType<typeof vi.fn>;
  displayWidth: number;
  displayHeight: number;
}

const asset: AssetRecord = {
  id: "gif-1",
  path: "D:\\refs\\anim.gif",
  previewUrl: "refbrowse://preview/gif",
};

describe("GIFPreview decode lifecycle", () => {
  let root: Root | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function installEnvironment(): void {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    })));
    Object.assign(window, {
      refCanvas: {
        system: { saveRegionCapture: vi.fn(), writeClipboard: vi.fn() },
      } as unknown as RefCanvasApi,
    });
  }

  // GIFPreview 在模块顶层捕获 ImageDecoder 构造器，必须先 stub 再动态
  // import（配合 vi.resetModules 让每个用例拿到各自的 mock）。
  async function renderPreview(): Promise<HTMLElement> {
    const { GIFPreview } = await import("../../../../src/renderer/components/GIFPreview");
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<GIFPreview asset={asset} />);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    return host;
  }

  it("closes already-decoded VideoFrames when cancelled mid-decode", async () => {
    installEnvironment();
    const decoderClose = vi.fn();
    let resolveDecode!: (value: { image: MockVideoFrame; duration?: number }) => void;
    const decode = vi.fn(
      () => new Promise<{ image: MockVideoFrame; duration?: number }>((resolve) => {
        resolveDecode = resolve;
      }),
    );
    class MockImageDecoder {
      tracks = { ready: Promise.resolve(), selected: { frameCount: 2 } };
      decode = decode;
      close = decoderClose;
    }
    vi.stubGlobal("ImageDecoder", MockImageDecoder);

    await renderPreview();

    // 第一帧解码挂起中；卸载触发取消。
    expect(decode).toHaveBeenCalledOnce();
    await act(async () => root?.unmount());
    root = null;

    const frame = {
      image: { close: vi.fn(), displayWidth: 4, displayHeight: 4 },
      duration: 100,
    };
    await act(async () => {
      resolveDecode(frame);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(frame.image.close).toHaveBeenCalledOnce();
    expect(decoderClose).toHaveBeenCalled();
  });

  it("closes committed frames when the preview unmounts", async () => {
    installEnvironment();
    const committedFrame = {
      close: vi.fn(),
      displayWidth: 4,
      displayHeight: 4,
    };
    class MockImageDecoder {
      tracks = { ready: Promise.resolve(), selected: { frameCount: 1 } };
      decode = vi.fn(async () => ({ image: committedFrame, duration: 100 }));
      close = vi.fn();
    }
    vi.stubGlobal("ImageDecoder", MockImageDecoder);

    await renderPreview();
    await act(async () => root?.unmount());
    root = null;

    expect(committedFrame.close).toHaveBeenCalledOnce();
  });
});
