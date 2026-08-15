// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefCanvasApi } from "../../../../src/shared/contracts";
import { FOUND_SETTINGS_DEFAULTS } from "../../../../src/shared/contracts";
import { setLanguage } from "../../../../src/renderer/app/i18n";
import { HdrPreview } from "../../../../src/renderer/components/HdrPreview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

setLanguage("zh-CN");

describe("HdrPreview flat view rendering", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const renderFlat = async (source: string) => {
    Object.assign(window, {
      refCanvas: {} as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<HdrPreview source={source} extension="exr" />);
    });
    return host;
  };

  it("shows the display-transform <img> as the only media layer", async () => {
    const source = "refbrowse://thumbnail/token?priority=preview&size=1920";
    const host = await renderFlat(source);
    const image = host.querySelector("img.hdr-preview-fallback");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(source);
  });

  it("does not mount a WebGL canvas overlay in flat view", async () => {
    // 打包环境 <img> 无 CORS 许可，WebGL 纹理上传必然抛 SecurityError，
    // 画布只会用黑/白占位覆盖正确的预览图（回归：拖拽布局时黑屏/白闪）。
    const host = await renderFlat(
      "refbrowse://thumbnail/token?priority=preview&size=960",
    );
    expect(host.querySelector(".hdr-preview-canvas")).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("keeps exposure as a CSS brightness variable on the preview root", async () => {
    const host = await renderFlat(
      "refbrowse://thumbnail/token?priority=preview&size=1920",
    );
    const root = host.querySelector(".hdr-preview");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).style.getPropertyValue("--hdr-exposure")).toBe("1");
  });
});

describe("HdrPreview display-readiness reporting for sequence gating", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const renderManaged = async (props: {
    source: string;
    path: string;
    onDisplayReady: (framePath: string | undefined) => void;
  }, options: { ocio?: boolean } = {}) => {
    const { ocio = true } = options;
    Object.assign(window, {
      refCanvas: {
        filesystem: {
          previewToken: vi.fn(async (file: string) =>
            file.includes("0001") ? "token-0001" : "token-0002",
          ),
        },
        system: {
          getPreferences: vi.fn(async () => ({
            foundSettings: {
              ...FOUND_SETTINGS_DEFAULTS,
              ocioConfigPath: ocio ? "C:\\ocio\\config.ocio" : null,
            },
          })),
        },
        color: {
          getStatus: vi.fn(async () => ({ detectedOcio: null })),
        },
      } as unknown as RefCanvasApi,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<HdrPreview extension="exr" displaySize={960} {...props} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return { host, root };
  };

  const fireLoad = (image: HTMLImageElement | null) => {
    if (!image) return;
    image.dispatchEvent(new Event("load"));
  };

  /** 换帧后：让预载图完成加载（显示层切换 src），再触发显示层 load。 */
  const settlePreloads = async (host: HTMLElement) => {
    await act(async () => {
      for (const image of host.querySelectorAll("img.hdr-preview-preload")) {
        fireLoad(image as HTMLImageElement);
      }
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("does not report a new frame ready before its color-managed variant has loaded", async () => {
    const onDisplayReady = vi.fn();
    const { host, root } = await renderManaged({
      source: "refbrowse://thumbnail/token-0001?priority=preview&size=960",
      path: "D:\\refs\\shot.0001.exr",
      onDisplayReady,
    });

    // 第一帧：基础变体加载 → 色彩管理变体加载 → 上报第一帧。
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-fallback"));
      fireLoad(host.querySelector("img.hdr-preview-managed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");

    // 换帧：path/source 先变，displaySource 尚未更新。旧帧图保持显示
    // （displayed*Url 不跟随新请求），新帧图经隐藏预载层加载；变体真正
    // load 之前绝不上报新帧——否则播放门控提前放行（OCIO 不生效、
    // 第二圈循环开始闪屏的根因）。
    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0002?priority=preview&size=960"
          path={"D:\\refs\\shot.0002.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).not.toHaveBeenCalledWith("D:\\refs\\shot.0002.exr");

    // 预载完成 → 显示层切换 src；色彩管理变体真正显示后才上报新帧。
    await settlePreloads(host);
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-managed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0002.exr");
  });

  it("does not report the new frame from the stale image's complete state while the source is lagging", async () => {
    // 缓存命中场景：旧帧图 complete=true（实例级模拟）。换帧渲染（path
    // 已变、displaySource 尚未随 setResolvedSource 更新）的 complete 兜底
    // 若每次渲染都跑，会用旧帧图的 complete 冒充新帧就绪——播放门控提前
    // 放行（第二圈闪屏、OCIO 不生效）。
    const onDisplayReady = vi.fn();
    const { host, root } = await renderManaged({
      source: "refbrowse://thumbnail/token-0001?priority=preview&size=960",
      path: "D:\\refs\\shot.0001.exr",
      onDisplayReady,
    });
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-fallback"));
      fireLoad(host.querySelector("img.hdr-preview-managed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");

    // 旧帧 managed 图已缓存（complete=true）；换帧后新帧图尚未挂载/加载。
    const staleManaged = host.querySelector("img.hdr-preview-managed");
    Object.defineProperty(staleManaged, "complete", { configurable: true, get: () => true });
    Object.defineProperty(staleManaged, "naturalWidth", { configurable: true, get: () => 1920 });

    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0002?priority=preview&size=960"
          path={"D:\\refs\\shot.0002.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // 换帧窗口：显示层仍是旧帧图（complete=true）且 src 与新请求不匹配。
    // complete 兜底必须校验 src 归属，绝不能用旧帧图的上报新帧。
    expect(onDisplayReady).not.toHaveBeenCalledWith("D:\\refs\\shot.0002.exr");

    // 预载完成 → 显示层切换到新帧变体（complete 兜底确认就绪 → 上报）。
    await settlePreloads(host);
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0002.exr");
  });

  it("reports a frame again when playback loops back to the same path", async () => {
    // 循环播放回到第一帧时 path 重新变化：若上报按 path 永久去重，重报被
    // 吞，SequencePreview 推进后 displayReadyPathRef 已置 null，门控永远
    // 等不到信号——播放第二圈起卡死。
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
    const onDisplayReady = vi.fn();
    const { host, root } = await renderManaged({
      source: "refbrowse://thumbnail/token-0001?priority=preview&size=960",
      path: "D:\\refs\\shot.0001.exr",
      onDisplayReady,
    });
    // 缓存命中：源变化后的 complete 兜底立即上报第一帧（无需 load 事件）。
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");

    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0002?priority=preview&size=960"
          path={"D:\\refs\\shot.0002.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settlePreloads(host);
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0002.exr");

    // 循环回第一帧：必须再次上报 0001，否则播放卡死。
    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0001?priority=preview&size=960"
          path={"D:\\refs\\shot.0001.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settlePreloads(host);
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");
  });

  it("keeps the previous frame visible while the next frame is loading", async () => {
    // 换帧瞬间旧图不得卸载（key 重挂载/显示层跟随新请求都会造成空白 +
    // 「正在生成 HDR 预览…」反复闪现）：显示层 src 保持旧帧，新帧经隐藏
    // 预载层加载，完成后才切换显示层。
    const onDisplayReady = vi.fn();
    const { host, root } = await renderManaged({
      source: "refbrowse://thumbnail/token-0001?priority=preview&size=960",
      path: "D:\\refs\\shot.0001.exr",
      onDisplayReady,
    });
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-fallback"));
      fireLoad(host.querySelector("img.hdr-preview-managed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");
    const managedSrcBefore = host.querySelector("img.hdr-preview-managed")?.getAttribute("src");

    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0002?priority=preview&size=960"
          path={"D:\\refs\\shot.0002.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // 显示层 src 保持旧帧；新帧图经预载层加载，未就绪前不上报。
    expect(host.querySelector("img.hdr-preview-managed")?.getAttribute("src")).toBe(managedSrcBefore);
    expect(host.querySelector("img.hdr-preview-preload")).toBeTruthy();
    expect(onDisplayReady).not.toHaveBeenCalledWith("D:\\refs\\shot.0002.exr");

    await settlePreloads(host);
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-managed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("img.hdr-preview-managed")?.getAttribute("src")).not.toBe(managedSrcBefore);
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0002.exr");
  });

  it("keeps the previous frame visible in the default scheme while the next frame loads", async () => {
    // 默认 sRGB（无 OCIO 配置，managedMode=false）：播放第二圈同样不能闪
    // 「正在生成 HDR 预览…」文案——显示层保持旧帧直到新帧加载完成。
    const onDisplayReady = vi.fn();
    const { host, root } = await renderManaged({
      source: "refbrowse://thumbnail/token-0001?priority=preview&size=960",
      path: "D:\\refs\\shot.0001.exr",
      onDisplayReady,
    }, { ocio: false });
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-fallback"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0001.exr");
    expect(host.querySelector("img.hdr-preview-managed")).toBeNull();
    const fallbackSrcBefore = host.querySelector("img.hdr-preview-fallback")?.getAttribute("src");

    await act(async () => {
      root.render(
        <HdrPreview
          extension="exr"
          displaySize={960}
          source="refbrowse://thumbnail/token-0002?priority=preview&size=960"
          path={"D:\\refs\\shot.0002.exr"}
          onDisplayReady={onDisplayReady}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("img.hdr-preview-fallback")?.getAttribute("src")).toBe(fallbackSrcBefore);
    expect(host.querySelector("img.hdr-preview-preload")).toBeTruthy();
    expect(onDisplayReady).not.toHaveBeenCalledWith("D:\\refs\\shot.0002.exr");

    await settlePreloads(host);
    await act(async () => {
      fireLoad(host.querySelector("img.hdr-preview-fallback"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("img.hdr-preview-fallback")?.getAttribute("src")).not.toBe(fallbackSrcBefore);
    expect(onDisplayReady).toHaveBeenLastCalledWith("D:\\refs\\shot.0002.exr");
  });
});
