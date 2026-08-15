import * as THREE from "three";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alphaBackgroundStyle,
  useFoundSettings,
} from "../app/found-settings";
import { translate } from "../app/i18n";
import { Download, FolderOpen, RefreshCw, RotateCcw, SunMedium } from "lucide-react";
import { ImagePreviewViewport } from "./ImagePreviewViewport";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";
import { PanoramaPreview, type EnvironmentPreviewMode } from "./PanoramaPreview";
import type { ColorStatus } from "../../shared/contracts";

type ToneMappingName = "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw";
/** 色彩管理方案：每个方案是一套完整组合（输入解释 + 显示变换），用户无需分别理解。 */
type ColorSchemeName = ToneMappingName;
type DisplayComponent = "R" | "G" | "B" | "A";

interface DisplayLayer {
  name: string;
  components: DisplayComponent[];
}

function ControlsMount({ target, children }: { target?: HTMLElement | null; children: React.ReactNode }) {
  return target ? createPortal(children, target) : children;
}

const AUTO_LAYER = "__auto__";
const MAIN_LAYER = "__main__";
const PROBE_RETRY_DELAYS_MS = [600, 1_200, 2_400] as const;

export function hdrDisplayPreviewUrl(token: string, size = 1920): string {
  return `refbrowse://thumbnail/${token}?priority=preview&size=${size}`;
}

const toneMappings: Record<ToneMappingName, THREE.ToneMapping> = {
  "linear-srgb": THREE.LinearToneMapping,
  "aces-1.3": THREE.LinearToneMapping,
  "aces-2.0": THREE.LinearToneMapping,
  raw: THREE.LinearToneMapping,
};

function appendPreviewParameter(source: string, name: string, value: string): string {
  return `${source}${source.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;
}

/** 每个方案的输入色彩空间（解码端 from 空间）。 */
const schemeInputSpaces: Record<ColorSchemeName, string> = {
  "linear-srgb": "lin_srgb",
  "aces-1.3": "ACEScg",
  "aces-2.0": "ACEScg",
  raw: "Raw",
};

/**
 * 默认方案（sRGB）按文件头解析输入色彩空间：ACEScg 头自动走 ACES 显示
 * 变换（解码端适配），线性文件线性→sRGB 直出；与序列暂存解码共享同一
 * 缓存变体，因此不携带显式变换参数。显式 ACES/Raw 或 OCIO 配置才生成
 * 独立的色彩管理变体（见 ADR-0001）。
 */
export function resolveHdrTransformSource(
  displaySource: string,
  scheme: ColorSchemeName,
  ocioConfigPath: string | null,
): string {
  const needsExplicitColorTransform = scheme !== "linear-srgb" || Boolean(ocioConfigPath);
  return needsExplicitColorTransform
    ? appendPreviewParameter(
        appendPreviewParameter(displaySource, "inputColorSpace", schemeInputSpaces[scheme]),
        "displayTransform",
        scheme,
      )
    : displaySource;
}

export function HdrPreview({
  source,
  extension,
  path,
  managed = false,
  displaySize = 1920,
  controlsTarget,
  multichannelOpen = false,
  multichannelAnchor,
  eyedropActive = false,
  onEyedropActiveChange,
  onColorSample,
  onDisplayReady,
}: {
  source: string;
  extension: string;
  path?: string;
  managed?: boolean;
  /** 显示变体解码尺寸；序列内嵌播放传 960，全屏/单帧保持 1920。 */
  displaySize?: number;
  controlsTarget?: HTMLElement | null;
  multichannelOpen?: boolean;
  multichannelAnchor?: HTMLElement | null;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
  /** 当前帧的可见画面就绪/定局时上报（序列播放据此推进帧）。 */
  onDisplayReady?: (framePath: string | undefined) => void;
}) {
  const foundSettings = useFoundSettings();
  const fallbackRef = useRef<HTMLImageElement | null>(null);
  const managedImageRef = useRef<HTMLImageElement | null>(null);
  const exposureButtonRef = useRef<HTMLButtonElement | null>(null);
  const ocioButtonRef = useRef<HTMLButtonElement | null>(null);
  const exposureMenuRef = useRef<HTMLDivElement | null>(null);
  const ocioMenuRef = useRef<HTMLDivElement | null>(null);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  const probedPathRef = useRef<string | undefined>(undefined);
  const multichannelWasOpenRef = useRef(multichannelOpen);
  const [exposureEv, setExposureEv] = useState(0);
  const [scheme, setScheme] = useState<ColorSchemeName>("linear-srgb");
  const [ocioOpen, setOcioOpen] = useState(false);
  const [ocioConfigPath, setOcioConfigPath] = useState(foundSettings.ocioConfigPath);
  const [ocioError, setOcioError] = useState<string | null>(null);
  const [colorStatus, setColorStatus] = useState<ColorStatus | null>(null);
  const [viewMode, setViewMode] = useState<EnvironmentPreviewMode>("flat");
  const [exposureOpen, setExposureOpen] = useState(false);
  const [exposureMenuPosition, setExposureMenuPosition] = useState<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: null, bottom: 0 });
  const [ocioMenuPosition, setOcioMenuPosition] = useState<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: null, bottom: 0 });
  const [channelMenuPosition, setChannelMenuPosition] = useState<{ left: number; top: number | null; bottom: number | null }>({ left: 0, top: null, bottom: 0 });
  const [layers, setLayers] = useState<DisplayLayer[]>([]);
  const [defaultLayer, setDefaultLayer] = useState<string | null>(null);
  const [layer, setLayer] = useState(AUTO_LAYER);
  const [component, setComponent] = useState<"composite" | DisplayComponent>(
    "composite",
  );
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [resolvedSource, setResolvedSource] = useState(source);
  const [samplePoint, setSamplePoint] = useState<{ x: number; y: number; color: string } | null>(null);
  const sampleReticleTimerRef = useRef<number | null>(null);

  const sampleDisplayedPixel = async (event: MouseEvent<HTMLDivElement>) => {
    if (!eyedropActive) return;
    // 反射球/全景视图不支持像素取色。
    if (viewMode !== "flat") {
      onEyedropActiveChange?.(false);
      return;
    }
    // 直接吸「用户真正看到的那张图」：色彩管理变体就绪时取它，否则取
    // 基础变体。WebGL 画布依赖 crossOrigin 纹理上传，打包环境里协议
    // 对 CORS 图片请求不返回 ACAO，纹理会是白/黑占位色——从画布读到的
    // 就是假颜色；从 <img> 读到的才是屏幕上显示的真实像素。
    const image = managedImageRef.current?.complete && managedImageRef.current.naturalWidth
      ? managedImageRef.current
      : fallbackRef.current;
    if (!image || !image.complete || !image.naturalWidth) {
      onEyedropActiveChange?.(false);
      return;
    }
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      onEyedropActiveChange?.(false);
      return;
    }
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement("canvas");
    const x = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) * width / rect.width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) * height / rect.height)));
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      onEyedropActiveChange?.(false);
      return;
    }
    let pixel: Uint8ClampedArray;
    try {
      context.imageSmoothingEnabled = false;
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      pixel = context.getImageData(0, 0, 1, 1).data;
    } catch {
      // 非 CORS-clean 时画布被污染。注意：被污染的画布「永远」是脏的，
      // 即使再画干净的 bitmap 也读不了像素——必须换一块新画布。
      let bitmap: ImageBitmap | null = null;
      try {
        const response = await fetch(requestSource, { referrer: window.location.href });
        if (!response.ok) {
          onEyedropActiveChange?.(false);
          return;
        }
        bitmap = await createImageBitmap(await response.blob());
        const clean = document.createElement("canvas");
        clean.width = 1;
        clean.height = 1;
        const cleanContext = clean.getContext("2d", { willReadFrequently: true });
        if (!cleanContext) {
          onEyedropActiveChange?.(false);
          return;
        }
        cleanContext.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
        pixel = cleanContext.getImageData(0, 0, 1, 1).data;
      } catch {
        onEyedropActiveChange?.(false);
        return;
      } finally {
        bitmap?.close();
      }
    }
    const color = `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    setSamplePoint({ x: event.clientX - rect.left, y: event.clientY - rect.top, color });
    // 准星只做极短的「点在了这里」反馈（约 250ms），随即消失。
    if (sampleReticleTimerRef.current !== null) window.clearTimeout(sampleReticleTimerRef.current);
    sampleReticleTimerRef.current = window.setTimeout(() => {
      sampleReticleTimerRef.current = null;
      setSamplePoint(null);
    }, 250);
    onColorSample?.(color);
    onEyedropActiveChange?.(false);
  };

  useEffect(() => () => {
    if (sampleReticleTimerRef.current !== null) window.clearTimeout(sampleReticleTimerRef.current);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void window.refCanvas.color?.getStatus().then((status) => {
      if (!cancelled) setColorStatus(status);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ocioConfigPath]);
  useEffect(() => {
    setOcioConfigPath(foundSettings.ocioConfigPath);
  }, [foundSettings.ocioConfigPath]);
  useEffect(() => {
    setResolvedSource(source);
    if (!path || !window.refCanvas.filesystem.previewToken) return;
    let cancelled = false;
    void window.refCanvas.filesystem.previewToken(path).then((token) => {
      if (!cancelled && token) setResolvedSource(hdrDisplayPreviewUrl(token, displaySize));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [path, source, displaySize]);
  const selectedLayerName = layer === AUTO_LAYER
    ? defaultLayer
    : layer === MAIN_LAYER
      ? ""
      : layer;
  const selectedLayer = layers.find((item) => selectedLayerName === item.name);
  const selectedChannel = component === "composite"
    ? layer !== AUTO_LAYER && selectedLayerName && selectedLayerName.length > 0
      ? selectedLayerName
      : null
    : selectedLayerName && selectedLayerName.length > 0
      ? `${selectedLayerName}.${component}`
      : component;
  const displaySource = selectedChannel === null
    ? resolvedSource
    : `${resolvedSource}${resolvedSource.includes("?") ? "&" : "?"}channel=${encodeURIComponent(selectedChannel)}`;
  const ocioSignature = ocioConfigPath
    ? Array.from(ocioConfigPath).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 0).toString(36)
    : null;
  // 默认路径与序列暂存解码共享同一缓存变体（见 ADR-0001）。
  const transformSource = resolveHdrTransformSource(displaySource, scheme, ocioConfigPath);
  const colorManagedSource = ocioSignature
    ? appendPreviewParameter(transformSource, "ocio", ocioSignature)
    : transformSource;
  const preview = useRetryingPreviewUrl(colorManagedSource);
  const requestSource = preview.url ?? colorManagedSource;
  const exposure = 2 ** exposureEv;
  // 显式色彩管理（自定义 OCIO / ACES / Raw）走独立缓存变体，解码可能
  // 明显慢于默认变体（大 EXR 序列尤甚）。渐进增强：基础变体先行显示，
  // 色彩管理变体就绪后淡入覆盖，播放不被变体解码拖住（见序列卡死回归）。
  const managedMode = colorManagedSource !== displaySource;
  // 就绪判断以 <img> 元素自身的 load 事件为准，而不是 useRetryingPreviewUrl
  // 的 status：缓存命中时 load 事件可能先于 hook 的重置 effect 触发，
  // status 会被重置回 "loading"，导致循环播放第二圈起门控永远等不到信号。
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [managedLoaded, setManagedLoaded] = useState(false);
  useEffect(() => {
    setBaseLoaded(false);
    setManagedLoaded(false);
  }, [displaySource, requestSource]);
  // 缓存命中时 load 事件可能在元素插入 DOM 前就触发（load 不冒泡，React
  // 依赖根节点捕获，detached 阶段的 load 会永久丢失）：每次渲染后同步
  // 检查 complete 兜底，避免第二圈循环起永远等不到加载完成。
  useEffect(() => {
    const managed = managedImageRef.current;
    if (managedMode && managed?.complete && managed.naturalWidth > 0) {
      setManagedLoaded(true);
    }
    const base = fallbackRef.current;
    if (!managedMode && base?.complete && base.naturalWidth > 0) {
      setBaseLoaded(true);
    }
  });
  // 基础变体（默认变换，通常已缓存）先行显示；色彩管理变体就绪后淡入覆盖。
  const visibleSource = managedMode ? displaySource : requestSource;
  const visibleReady = managedMode ? managedLoaded : baseLoaded;

  // 可见画面就绪/定局即上报：序列播放据此推进帧，保证色彩管理变体
  // （OCIO/ACES/Raw）真正显示出来，而不是被下一帧跳过。
  useEffect(() => {
    const settled = visibleReady || preview.status === "failed";
    if (settled) onDisplayReady?.(path);
  }, [onDisplayReady, path, preview.status, visibleReady]);
  const closeLocalPopovers = () => {
    setExposureOpen(false);
    setOcioOpen(false);
  };

  /**
   * 应用自定义 OCIO 配置：先让主进程跑一次最小转换校验（色彩空间解析 +
   * LUT 引用）。配置缺 LUT（如 Unreal MRQ 只导出 config.ocio 未带 luts
   * 目录）时直接拒绝并提示原因，而不是让预览静默失败或序列卡死。
   */
  const applyOcioConfig = async (configPath: string): Promise<boolean> => {
    setOcioError(null);
    try {
      const validation = await window.refCanvas.media?.validateOcioConfig?.(configPath);
      if (validation && !validation.ok) {
        setOcioError(`无法加载该 OCIO 配置：${validation.detail ?? "未知错误"}`);
        return false;
      }
      const next = await window.refCanvas.system.setPreferences({ foundSettings: { ocioConfigPath: configPath } });
      setOcioConfigPath(next.foundSettings.ocioConfigPath);
      window.dispatchEvent(new CustomEvent("refcanvas:found-settings", { detail: next.foundSettings }));
      setOcioOpen(false);
      return true;
    } catch (error) {
      const detail = error instanceof Error && error.message ? `：${error.message}` : "";
      setOcioError(`无法加载该 OCIO 配置${detail}`);
      return false;
    }
  };

  const exportChannel = async () => {
    if (!path || exporting) return;
    const directory = await window.refCanvas.system.pickDirectory({
      title: "导出当前 EXR/HDR 通道",
      defaultPath: path.replace(/[\\/][^\\/]*$/, ""),
    });
    if (!directory) return;
    setExporting(true);
    setExportError(null);
    try {
      const result = await window.refCanvas.media.exportDisplayChannel({
        inputPath: path,
        outputDirectory: directory,
        baseName: path.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "") || "channel",
        channel: selectedChannel ?? undefined,
      });
      setExportedPath(result.outputPath);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "通道导出失败");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const pathChanged = probedPathRef.current !== path;
    const reopened = multichannelOpen && !multichannelWasOpenRef.current;
    probedPathRef.current = path;
    multichannelWasOpenRef.current = multichannelOpen;
    if (!pathChanged && !reopened) return;
    if (pathChanged) {
      setLayers([]);
      setDefaultLayer(null);
      setLayer(AUTO_LAYER);
      setComponent("composite");
    }
    if (!path || !window.refCanvas.media?.probe) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    const applyResult = (result: Awaited<ReturnType<typeof window.refCanvas.media.probe>>) => {
      if (cancelled) return;
      const values = Array.isArray(result.extra.layers)
        ? result.extra.layers
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const value = item as { name?: unknown; components?: unknown };
              const components = Array.isArray(value.components)
                ? value.components.filter(
                    (component): component is DisplayComponent =>
                      component === "R" ||
                      component === "G" ||
                      component === "B" ||
                      component === "A",
                  )
                : [];
              return typeof value.name === "string" && components.includes("R") && components.includes("G") && components.includes("B")
                ? { name: value.name, components }
                : null;
            })
            .filter((item): item is DisplayLayer => item !== null)
        : [];
      setLayers(values);
      const defaultLayer = result.extra.defaultLayer;
      if (typeof defaultLayer === "string") {
        setDefaultLayer(defaultLayer);
      }
    };
    const probe = (attempt: number) => {
      void window.refCanvas.media.probe(path).then(applyResult).catch(() => {
        if (cancelled || attempt >= PROBE_RETRY_DELAYS_MS.length) return;
        retryTimer = window.setTimeout(() => probe(attempt + 1), PROBE_RETRY_DELAYS_MS[attempt]);
      });
    };
    probe(0);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [multichannelOpen, path]);

  // 平面视图不再叠加 WebGL 画布：打包环境下 <img> 无 CORS 许可（协议对
  // CORS 图片请求不返回 ACAO），纹理上传必然抛 SecurityError，画布只会
  // 呈现黑/白占位并覆盖正确的预览图（见 packaged 运行时烟测）。
  // 预览 PNG 已在主进程完成显示变换，曝光用 CSS brightness 直接作用于
  // <img>；WebGL 仅保留给全景/反射球模式（PanoramaPreview）。

  // 锚点菜单定位：优先在触发器上方展开；上方放不下（例如独立预览对话框
  // 顶部悬浮的 HDR 工具行）时翻转到下方，否则菜单会整块落在屏幕外、
  // 点击按钮看起来毫无反应。需要实测菜单高度，用 useLayoutEffect 在
  // 绘制前完成首次定位，避免先闪现到默认位置再跳动。
  useLayoutEffect(() => {
    if (!exposureOpen && !ocioOpen && !multichannelOpen) return;
    const clamp = (value: number, minimum: number, maximum: number) =>
      Math.max(minimum, Math.min(value, maximum));
    const placeMenus = () => {
      const place = (
        trigger: HTMLElement | null | undefined,
        menu: HTMLElement | null | undefined,
        width: number,
        align: "start" | "center",
        setPosition: (position: { left: number; top: number | null; bottom: number | null }) => void,
      ) => {
        if (!trigger || !menu) return;
        const rect = trigger.getBoundingClientRect();
        const menuHeight = menu.getBoundingClientRect().height || 44;
        const rawLeft = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
        const left = clamp(rawLeft, 6, window.innerWidth - width - 6);
        if (rect.top - 6 >= menuHeight) {
          setPosition({ left, top: null, bottom: window.innerHeight - rect.top + 6 });
        } else {
          const top = clamp(rect.bottom + 6, 6, window.innerHeight - menuHeight - 6);
          setPosition({ left, top, bottom: null });
        }
      };
      if (exposureOpen) place(exposureButtonRef.current, exposureMenuRef.current, 196, "center", setExposureMenuPosition);
      if (ocioOpen) place(ocioButtonRef.current, ocioMenuRef.current, 210, "start", setOcioMenuPosition);
      if (multichannelOpen) {
        const toolbarAnchor = multichannelAnchor ?? controlsTarget?.parentElement?.querySelector<HTMLElement>('[aria-label="提取多通道"]');
        place(toolbarAnchor, channelMenuRef.current, 360, "start", setChannelMenuPosition);
      }
    };
    placeMenus();
    window.addEventListener("resize", placeMenus);
    window.addEventListener("scroll", placeMenus, true);
    return () => {
      window.removeEventListener("resize", placeMenus);
      window.removeEventListener("scroll", placeMenus, true);
    };
  }, [controlsTarget, exposureOpen, layers, multichannelAnchor, multichannelOpen, ocioOpen]);

  useEffect(() => {
    if (!exposureOpen && !ocioOpen && !multichannelOpen) return;
    const isInsideActivePopover = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      return Boolean(node && (
        exposureButtonRef.current?.contains(node) ||
        ocioButtonRef.current?.contains(node) ||
        multichannelAnchor?.contains(node) ||
        exposureMenuRef.current?.contains(node) ||
        ocioMenuRef.current?.contains(node) ||
        channelMenuRef.current?.contains(node)
      ));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isInsideActivePopover(event.target)) return;
      closeLocalPopovers();
      if (multichannelOpen) window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeLocalPopovers();
      if (multichannelOpen) window.dispatchEvent(new Event("refcanvas:close-preview-popovers"));
    };
    const onBlur = () => closeLocalPopovers();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [exposureOpen, multichannelAnchor, multichannelOpen, ocioOpen]);

  useEffect(() => {
    const closePopovers = () => closeLocalPopovers();
    window.addEventListener("refcanvas:close-preview-popovers", closePopovers);
    return () => window.removeEventListener("refcanvas:close-preview-popovers", closePopovers);
  }, []);

  // 注意：这里故意没有「path 变化即关闭浮层」的 effect。序列播放时
  // SequencePreview 传入的 path 每帧都会变（frames[displayedFrameIndex]），
  // 以 path 为触发条件会在每个帧节拍关闭刚打开的 OCIO/曝光/多通道菜单
  // （用户看到的「点了白点」）。切换资产由上层负责：内嵌面板按
  // key={asset.path} / key={sequenceGroup.id} 重挂载，独立对话框换资产
  // 即整体重建；浮层关闭统一走 refcanvas:close-preview-popovers 事件
  // （点击外部、Esc、失焦、全屏等）。

  useEffect(() => {
    const onViewMode = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; mode?: EnvironmentPreviewMode }>).detail;
      if (detail.path !== path) return;
      setViewMode(detail.mode ?? "flat");
    };
    window.addEventListener("refcanvas:hdr-view-mode", onViewMode);
    return () => window.removeEventListener("refcanvas:hdr-view-mode", onViewMode);
  }, [path]);

  return (
    <div
      className={`hdr-preview${managed ? " found-managed-preview" : ""}`}
      style={{ "--hdr-exposure": String(exposure) } as React.CSSProperties}
    >
      {viewMode !== "flat" ? <PanoramaPreview
        source={requestSource}
        alt={translate("hdr.alt").replace("{ext}", extension.toUpperCase())}
        forcedMode={viewMode}
        exposure={exposure}
        toneMapping={toneMappings[scheme]}
      /> : <ImagePreviewViewport
        assetKey={colorManagedSource}
        checkerBackground={alphaBackgroundStyle(foundSettings)}
        canvasBackground={managed ? "var(--surface-1, #1d201f)" : undefined}
        controlsTarget={controlsTarget}
      >
        {({ style }) => (
          <div
            className={`hdr-preview-stage${eyedropActive ? " is-sampling" : ""}`}
            style={style}
            onClick={(event) => void sampleDisplayedPixel(event)}
          >
            <img
              key={visibleSource}
              ref={fallbackRef}
              className="hdr-preview-fallback"
              src={visibleSource}
              alt={translate("hdr.alt").replace("{ext}", extension.toUpperCase())}
              draggable={false}
              onLoad={(event) => {
                // key 重挂载保证 load 事件晚于重置 effect；再校验元素仍是
                // 当前元素，旧元素迟到的 load 不写入状态。
                if (event.currentTarget !== fallbackRef.current) return;
                setBaseLoaded(true);
                if (!managedMode) preview.markReady();
              }}
              onError={() => {
                if (!managedMode) preview.markError();
              }}
            />
            {managedMode && (
              <img
                key={requestSource}
                ref={managedImageRef}
                className="hdr-preview-managed"
                src={requestSource}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{ opacity: managedLoaded ? 1 : 0 }}
                onLoad={(event) => {
                  if (event.currentTarget !== managedImageRef.current) return;
                  setManagedLoaded(true);
                  preview.markReady();
                }}
                onError={preview.markError}
              />
            )}
            {samplePoint && (
              <span
                className="hdr-sample-reticle"
                aria-hidden="true"
                style={{ left: samplePoint.x, top: samplePoint.y, "--sample-color": samplePoint.color } as React.CSSProperties}
              />
            )}
            {!managedMode && !baseLoaded && (preview.status === "loading" || preview.status === "waiting") && (
              <span className="preview-message" role="status">
                {preview.status === "waiting" ? "正在等待 EXR 预览…" : translate("hdr.generating")}
              </span>
            )}
            {!managedMode && preview.status === "failed" && (
              <span className="preview-message preview-message-retry">
                <span>{translate("hdr.failed")}</span>
                <button type="button" onClick={preview.retry} aria-label="重试 EXR 预览">
                  <RefreshCw size={15} />
                  重试
                </button>
              </span>
            )}
          </div>
        )}
      </ImagePreviewViewport>}
      <ControlsMount target={controlsTarget}>
        <div className="hdr-preview-controls">
        <div className="hdr-exposure-control">
          <button ref={exposureButtonRef} type="button" className={`mini-icon-button${exposureOpen ? " active" : ""}`} aria-label="调整曝光" aria-expanded={exposureOpen} title="调整曝光" onClick={() => { const next = !exposureOpen; window.dispatchEvent(new Event("refcanvas:close-preview-popovers")); setExposureOpen(next); }}><SunMedium size={15} /></button>
        </div>
        <div className="hdr-ocio-control">
          <button ref={ocioButtonRef} type="button" className={`found-tool-label${ocioOpen ? " active" : ""}`} aria-label="OCIO 色彩管理" aria-expanded={ocioOpen} onClick={() => { const next = !ocioOpen; window.dispatchEvent(new Event("refcanvas:close-preview-popovers")); setOcioOpen(next); }}>OCIO</button>
        </div>
        {path && (
          <button
            type="button"
            className="secondary-button"
            disabled={exporting}
            onClick={() => void exportChannel()}
            title="将当前层/通道以显示转换后的全分辨率 PNG 导出"
          >
            <Download size={14} />
            {exporting ? "正在导出…" : "导出当前通道"}
          </button>
        )}
        {exportedPath && (
          <button
            type="button"
            className="mini-icon-button"
            title={exportedPath}
            aria-label="在资源管理器中显示导出的通道"
            draggable
            onDragStart={(event) => {
              event.preventDefault();
              window.refCanvas.filesystem.dragOut([exportedPath]);
            }}
            onClick={() => void window.refCanvas.filesystem.reveal(exportedPath)}
          >
            <FolderOpen size={14} />
          </button>
        )}
        {exportError && <span className="preview-color-error">{exportError}</span>}
        </div>
      </ControlsMount>
      {exposureOpen && typeof document !== "undefined" && createPortal(
        <div
          className="hdr-exposure-anchor-menu"
          ref={exposureMenuRef}
          data-placement="top-center"
          style={{ left: exposureMenuPosition.left, top: exposureMenuPosition.top ?? undefined, bottom: exposureMenuPosition.bottom ?? undefined }}
        >
          <div className="hdr-exposure-popover">
            <SunMedium size={14} aria-hidden="true" />
            <input aria-label="曝光值" type="range" min="-5" max="5" step="0.1" value={exposureEv} onInput={(event) => setExposureEv(Number(event.currentTarget.value))} onChange={(event) => setExposureEv(Number(event.currentTarget.value))} />
            <output>{`${exposureEv >= 0 ? "+" : ""}${exposureEv.toFixed(1)} EV`}</output>
            <button type="button" aria-label="重置曝光" title="重置曝光" onClick={() => setExposureEv(0)}><RotateCcw size={13} /></button>
          </div>
        </div>,
        document.body,
      )}
      {ocioOpen && typeof document !== "undefined" && createPortal(
        <div ref={ocioMenuRef} className="hdr-ocio-anchor-menu" data-placement="top-start" style={{ left: ocioMenuPosition.left, top: ocioMenuPosition.top ?? undefined, bottom: ocioMenuPosition.bottom ?? undefined }}>
          <div className="hdr-ocio-menu" role="menu" aria-label="OCIO 色彩管理菜单">
            <span className="hdr-ocio-group">色彩管理</span>
            {([['linear-srgb', 'sRGB'], ['aces-1.3', 'ACES 1.3'], ['aces-2.0', 'ACES 2.0'], ['raw', 'Raw']] as const).map(([value, label]) => (
              <button type="button" role="menuitemradio" aria-checked={scheme === value} className={scheme === value ? "active" : ""} key={value} onClick={() => setScheme(value)}><span className="lut-radio" />{label}</button>
            ))}
            <span className="hdr-ocio-separator" />
            {colorStatus?.detectedOcio && <button type="button" role="menuitemradio" aria-checked={!ocioConfigPath} className={!ocioConfigPath ? "active" : ""} title={colorStatus.detectedOcio} onClick={() => { if (colorStatus?.detectedOcio) void applyOcioConfig(colorStatus.detectedOcio); }}><span className="lut-radio" />$OCIO · {colorStatus.detectedOcio.split(/[\\/]/).pop()}</button>}
            {ocioConfigPath && <button type="button" role="menuitemradio" aria-checked className="active" title={ocioConfigPath} onClick={() => setOcioOpen(false)}><span className="lut-radio" />{ocioConfigPath.split(/[\\/]/).pop()}</button>}
            <button type="button" role="menuitem" onClick={async () => {
              try {
                const [filename] = await window.refCanvas.system.pickFile({ title: "添加新的 config.ocio", multiSelections: false, filters: [{ name: "OCIO Config", extensions: ["ocio"] }] });
                if (!filename) return;
                await applyOcioConfig(filename);
              } catch {
                setOcioError("无法加载该 OCIO 配置");
              }
            }}>添加新的 config.ocio…</button>
            {ocioError && <span className="hdr-ocio-error" role="alert">{ocioError}</span>}
          </div>
        </div>,
        document.body,
      )}
      {multichannelOpen && typeof document !== "undefined" && createPortal(
        <div ref={channelMenuRef} className="hdr-channel-anchor-menu" data-placement="top-start" style={{ left: channelMenuPosition.left, top: channelMenuPosition.top ?? undefined, bottom: channelMenuPosition.bottom ?? undefined }}>
          <div className="hdr-channel-control" role="group" aria-label="提取多通道">
            <label className="hdr-layer-select">
              <span>{translate("hdr.layers")}</span>
              <select aria-label={translate("hdr.layersSelect")} value={layer} onChange={(event) => { setLayer(event.target.value); setComponent("composite"); }}>
                <option value={AUTO_LAYER}>{translate("hdr.auto")}</option>
                {layers.length === 0 && <option value={MAIN_LAYER}>Main</option>}
                {layers.map((item) => <option key={item.name || MAIN_LAYER} value={item.name || MAIN_LAYER}>{item.name || "Main"}</option>)}
              </select>
            </label>
            <div className="hdr-component-control" role="group" aria-label={translate("hdr.channels")}>
              <button type="button" className={component === "composite" ? "active" : ""} aria-pressed={component === "composite"} onClick={() => setComponent("composite")}>{translate("hdr.composite")}</button>
              {(selectedLayer?.components ?? ["R", "G", "B", "A"]).map((item) => <button type="button" key={item} className={component === item ? "active" : ""} aria-pressed={component === item} onClick={() => setComponent(item)}>{item}</button>)}
            </div>
            {layers.length === 0 && <span className="hdr-channel-hint">未检测到额外分层，可预览 Main RGBA 通道</span>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
