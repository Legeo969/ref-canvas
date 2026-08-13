import * as THREE from "three";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alphaBackgroundStyle,
  useFoundSettings,
} from "../app/found-settings";
import { translate } from "../app/i18n";
import { Download, FolderOpen, RefreshCw, RotateCcw, SunMedium } from "lucide-react";
import { ImagePreviewViewport } from "./ImagePreviewViewport";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";
import { createEnvironmentTexture, PanoramaPreview, type EnvironmentPreviewMode } from "./PanoramaPreview";
import type { ColorStatus } from "../../shared/contracts";

type ToneMappingName = "linear-srgb" | "aces-1.3" | "aces-2.0" | "raw";
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

export function hdrDisplayPreviewUrl(token: string): string {
  return `refbrowse://thumbnail/${token}?priority=preview&size=1920`;
}

const toneMappings: Record<ToneMappingName, THREE.ToneMapping> = {
  "linear-srgb": THREE.LinearToneMapping,
  "aces-1.3": THREE.LinearToneMapping,
  "aces-2.0": THREE.LinearToneMapping,
  raw: THREE.LinearToneMapping,
};

const inputColorSpaces: Record<ToneMappingName, string> = {
  "linear-srgb": "lin_srgb",
  "aces-1.3": "ACEScg",
  "aces-2.0": "ACEScg",
  raw: "Raw",
};

function appendPreviewParameter(source: string, name: string, value: string): string {
  return `${source}${source.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;
}

export function HdrPreview({
  source,
  extension,
  path,
  managed = false,
  controlsTarget,
  multichannelOpen = false,
  multichannelAnchor,
  eyedropActive = false,
  onEyedropActiveChange,
  onColorSample,
}: {
  source: string;
  extension: string;
  path?: string;
  managed?: boolean;
  controlsTarget?: HTMLElement | null;
  multichannelOpen?: boolean;
  multichannelAnchor?: HTMLElement | null;
  eyedropActive?: boolean;
  onEyedropActiveChange?: (active: boolean) => void;
  onColorSample?: (color: string) => void;
}) {
  const foundSettings = useFoundSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const planeRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const fallbackRef = useRef<HTMLImageElement | null>(null);
  const exposureButtonRef = useRef<HTMLButtonElement | null>(null);
  const ocioButtonRef = useRef<HTMLButtonElement | null>(null);
  const exposureMenuRef = useRef<HTMLDivElement | null>(null);
  const ocioMenuRef = useRef<HTMLDivElement | null>(null);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  const probedPathRef = useRef<string | undefined>(undefined);
  const multichannelWasOpenRef = useRef(multichannelOpen);
  const [exposureEv, setExposureEv] = useState(0);
  const [toneMapping, setToneMapping] = useState<ToneMappingName>("linear-srgb");
  const [ocioOpen, setOcioOpen] = useState(false);
  const [ocioConfigPath, setOcioConfigPath] = useState(foundSettings.ocioConfigPath);
  const [ocioError, setOcioError] = useState<string | null>(null);
  const [colorStatus, setColorStatus] = useState<ColorStatus | null>(null);
  const [viewMode, setViewMode] = useState<EnvironmentPreviewMode>("flat");
  const [exposureOpen, setExposureOpen] = useState(false);
  const [exposureMenuPosition, setExposureMenuPosition] = useState({ left: 0, bottom: 0 });
  const [ocioMenuPosition, setOcioMenuPosition] = useState({ left: 0, bottom: 0 });
  const [channelMenuPosition, setChannelMenuPosition] = useState({ left: 0, bottom: 0 });
  const [textureStatus, setTextureStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
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

  const sampleDisplayedPixel = (event: MouseEvent<HTMLDivElement>) => {
    if (!eyedropActive || viewMode !== "flat") return;
    const renderer = rendererRef.current;
    const canvas = renderer?.domElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height)));
    const pixels = new Uint8Array(4);
    const context = renderer.getContext();
    context.readPixels(
      x,
      canvas.height - y - 1,
      1,
      1,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    );
    const color = `#${[pixels[0], pixels[1], pixels[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    setSamplePoint({ x: event.clientX - rect.left, y: event.clientY - rect.top, color });
    onColorSample?.(color);
    onEyedropActiveChange?.(false);
  };
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
      if (!cancelled && token) setResolvedSource(hdrDisplayPreviewUrl(token));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [path, source]);
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
  const transformSource = appendPreviewParameter(
    appendPreviewParameter(displaySource, "inputColorSpace", inputColorSpaces[toneMapping]),
    "displayTransform",
    toneMapping,
  );
  const colorManagedSource = ocioSignature
    ? appendPreviewParameter(transformSource, "ocio", ocioSignature)
    : transformSource;
  const preview = useRetryingPreviewUrl(colorManagedSource);
  const requestSource = preview.url ?? colorManagedSource;
  const exposure = 2 ** exposureEv;
  const closeLocalPopovers = () => {
    setExposureOpen(false);
    setOcioOpen(false);
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || viewMode !== "flat") return;
    setTextureStatus("loading");
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = toneMappings["linear-srgb"];
    renderer.toneMappingExposure = 1;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(plane);
    host.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    planeRef.current = plane;
    textureRef.current = null;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      const image = textureRef.current?.image as
        | { width?: number; height?: number }
        | undefined;
      const imageAspect =
        image?.width && image.height ? image.width / image.height : 1;
      const hostAspect = width / height;
      plane.scale.set(
        imageAspect > hostAspect ? 1 : imageAspect / hostAspect,
        imageAspect > hostAspect ? hostAspect / imageAspect : 1,
        1,
      );
      renderer.render(scene, camera);
    };
    resize();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(resize);
    observer?.observe(host);

    let active = true;
    const image = fallbackRef.current;
    const applyLoadedImage = () => {
      if (!active || !image) return;
      const texture = createEnvironmentTexture(image);
      textureRef.current = texture;
      material.map = texture;
      material.needsUpdate = true;
      setTextureStatus("ready");
      preview.markReady();
      resize();
    };
    const markTextureFailed = () => {
      if (active) setTextureStatus("failed");
    };
    if (image?.complete && image.naturalWidth > 0) applyLoadedImage();
    else {
      image?.addEventListener("load", applyLoadedImage, { once: true });
      image?.addEventListener("error", markTextureFailed, { once: true });
    }

    return () => {
      active = false;
      image?.removeEventListener("load", applyLoadedImage);
      image?.removeEventListener("error", markTextureFailed);
      observer?.disconnect();
      textureRef.current?.dispose();
      material.dispose();
      plane.geometry.dispose();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      planeRef.current = null;
    };
  }, [requestSource, extension, viewMode]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.toneMapping = toneMappings[toneMapping];
    renderer.toneMappingExposure = exposure;
    renderer.render(scene, camera);
  }, [exposure, toneMapping]);

  useEffect(() => {
    if (!exposureOpen && !ocioOpen && !multichannelOpen) return;
    const placeMenus = () => {
      const place = (
        trigger: HTMLElement | null | undefined,
        width: number,
        align: "start" | "center",
        setPosition: (position: { left: number; bottom: number }) => void,
      ) => {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const rawLeft = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
      setPosition({
        left: Math.max(6, Math.min(rawLeft, window.innerWidth - width - 6)),
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
      });
      };
      if (exposureOpen) place(exposureButtonRef.current, 196, "center", setExposureMenuPosition);
      if (ocioOpen) place(ocioButtonRef.current, 210, "start", setOcioMenuPosition);
      if (multichannelOpen) {
        const toolbarAnchor = multichannelAnchor ?? controlsTarget?.parentElement?.querySelector<HTMLElement>('[aria-label="提取多通道"]');
        place(toolbarAnchor, 360, "start", setChannelMenuPosition);
      }
    };
    placeMenus();
    window.addEventListener("resize", placeMenus);
    window.addEventListener("scroll", placeMenus, true);
    return () => {
      window.removeEventListener("resize", placeMenus);
      window.removeEventListener("scroll", placeMenus, true);
    };
  }, [controlsTarget, exposureOpen, multichannelAnchor, multichannelOpen, ocioOpen]);

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

  useEffect(() => {
    closeLocalPopovers();
  }, [path, source]);

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
        toneMapping={toneMappings[toneMapping]}
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
            onClick={sampleDisplayedPixel}
          >
            <img
              ref={fallbackRef}
              className="hdr-preview-fallback"
              src={requestSource}
              alt={translate("hdr.alt").replace("{ext}", extension.toUpperCase())}
              draggable={false}
              onLoad={preview.markReady}
              onError={preview.markError}
            />
            <div
              className="hdr-preview-canvas"
              ref={hostRef}
              style={{ opacity: textureStatus === "ready" ? 1 : 0 }}
            />
            {samplePoint && (
              <span
                className="hdr-sample-reticle"
                aria-hidden="true"
                style={{ left: samplePoint.x, top: samplePoint.y, "--sample-color": samplePoint.color } as React.CSSProperties}
              />
            )}
            {(preview.status === "loading" || preview.status === "waiting") && (
              <span className="preview-message" role="status">
                {preview.status === "waiting" ? "正在等待 EXR 预览…" : translate("hdr.generating")}
              </span>
            )}
            {preview.status === "failed" && (
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
          style={{ left: exposureMenuPosition.left, bottom: exposureMenuPosition.bottom }}
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
        <div ref={ocioMenuRef} className="hdr-ocio-anchor-menu" data-placement="top-start" style={{ left: ocioMenuPosition.left, bottom: ocioMenuPosition.bottom }}>
          <div className="hdr-ocio-menu" role="menu" aria-label="OCIO 色彩管理菜单">
            {([['linear-srgb', 'Linear sRGB'], ['aces-1.3', 'ACEScg 1.3'], ['aces-2.0', 'ACEScg 2.0'], ['raw', 'Raw']] as const).map(([value, label]) => (
              <button type="button" role="menuitemradio" aria-checked={toneMapping === value} className={toneMapping === value ? "active" : ""} key={value} onClick={() => { setToneMapping(value); setOcioOpen(false); }}><span className="lut-radio" />{label}</button>
            ))}
            <span className="hdr-ocio-separator" />
            {colorStatus?.detectedOcio && <button type="button" role="menuitemradio" aria-checked={!ocioConfigPath} className={!ocioConfigPath ? "active" : ""} title={colorStatus.detectedOcio} onClick={async () => {
              const next = await window.refCanvas.system.setPreferences({ foundSettings: { ocioConfigPath: colorStatus.detectedOcio } });
              setOcioConfigPath(next.foundSettings.ocioConfigPath);
              window.dispatchEvent(new CustomEvent("refcanvas:found-settings", { detail: next.foundSettings }));
              setOcioOpen(false);
            }}><span className="lut-radio" />$OCIO · {colorStatus.detectedOcio.split(/[\\/]/).pop()}</button>}
            {ocioConfigPath && <button type="button" role="menuitemradio" aria-checked className="active" title={ocioConfigPath} onClick={() => setOcioOpen(false)}><span className="lut-radio" />{ocioConfigPath.split(/[\\/]/).pop()}</button>}
            <button type="button" role="menuitem" onClick={async () => {
              setOcioError(null);
              try {
                const [filename] = await window.refCanvas.system.pickFile({ title: "添加新的 config.ocio", multiSelections: false, filters: [{ name: "OCIO Config", extensions: ["ocio"] }] });
                if (!filename) return;
                const next = await window.refCanvas.system.setPreferences({ foundSettings: { ocioConfigPath: filename } });
                setOcioConfigPath(next.foundSettings.ocioConfigPath);
                window.dispatchEvent(new CustomEvent("refcanvas:found-settings", { detail: next.foundSettings }));
                setOcioOpen(false);
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
        <div ref={channelMenuRef} className="hdr-channel-anchor-menu" data-placement="top-start" style={{ left: channelMenuPosition.left, bottom: channelMenuPosition.bottom }}>
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
