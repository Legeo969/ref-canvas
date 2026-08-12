import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alphaBackgroundStyle,
  useFoundSettings,
} from "../app/found-settings";
import { translate } from "../app/i18n";
import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { ImagePreviewViewport } from "./ImagePreviewViewport";
import { PreviewColorBar } from "./PreviewColorBar";
import { useRetryingPreviewUrl } from "./useRetryingPreviewUrl";

type ToneMappingName = "aces" | "reinhard" | "neutral";
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

const toneMappings: Record<ToneMappingName, THREE.ToneMapping> = {
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  neutral: THREE.NeutralToneMapping,
};

export function HdrPreview({
  source,
  extension,
  path,
  managed = false,
  controlsTarget,
}: {
  source: string;
  extension: string;
  path?: string;
  managed?: boolean;
  controlsTarget?: HTMLElement | null;
}) {
  const foundSettings = useFoundSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const planeRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const fallbackRef = useRef<HTMLImageElement | null>(null);
  const [exposure, setExposure] = useState(1);
  const [toneMapping, setToneMapping] = useState<ToneMappingName>("aces");
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
    ? source
    : `${source}${source.includes("?") ? "&" : "?"}channel=${encodeURIComponent(selectedChannel)}`;
  const preview = useRetryingPreviewUrl(displaySource);
  const requestSource = preview.url ?? displaySource;

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
    setLayers([]);
    setDefaultLayer(null);
    setLayer(AUTO_LAYER);
    setComponent("composite");
    if (!path || !window.refCanvas.media?.probe) return;
    let cancelled = false;
    void window.refCanvas.media.probe(path).then((result) => {
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
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
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
    renderer.toneMapping = toneMappings.aces;
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

    const loader = new THREE.TextureLoader();
    let active = true;
    loader.load(
      requestSource,
      (texture) => {
        if (!active) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = texture;
        material.map = texture;
        material.needsUpdate = true;
        setTextureStatus("ready");
        preview.markReady();
        resize();
      },
      undefined,
      () => {
        if (active) setTextureStatus("failed");
      },
    );

    return () => {
      active = false;
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
  }, [requestSource, extension]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.toneMapping = toneMappings[toneMapping];
    renderer.toneMappingExposure = exposure;
    renderer.render(scene, camera);
  }, [exposure, toneMapping]);

  return (
    <div className={`hdr-preview${managed ? " found-managed-preview" : ""}`}>
      <ImagePreviewViewport
        assetKey={displaySource}
        checkerBackground={alphaBackgroundStyle(foundSettings)}
        canvasBackground={managed ? "var(--surface-1, #1d201f)" : undefined}
        controlsTarget={controlsTarget}
        toolbarEnd={
          <PreviewColorBar
            compact
            source={() => fallbackRef.current}
            revision={displaySource}
          />
        }
      >
        {({ style }) => (
          <div className="hdr-preview-stage" style={style}>
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
      </ImagePreviewViewport>
      <ControlsMount target={controlsTarget}>
        <div className="hdr-preview-controls">
        {layers.length > 0 && (
          <div className="hdr-channel-control" role="group" aria-label="提取多通道">
            <label className="hdr-layer-select">
              <span>{translate("hdr.layers")}</span>
              <select
                aria-label={translate("hdr.layersSelect")}
                value={layer}
                onChange={(event) => {
                  setLayer(event.target.value);
                  setComponent("composite");
                }}
              >
                <option value={AUTO_LAYER}>{translate("hdr.auto")}</option>
                {layers.map((item) => (
                  <option
                    key={item.name || MAIN_LAYER}
                    value={item.name || MAIN_LAYER}
                  >
                    {item.name || "Main"}
                  </option>
                ))}
              </select>
            </label>
            <div className="hdr-component-control" role="group" aria-label={translate("hdr.channels")}>
              <button
                type="button"
                className={component === "composite" ? "active" : ""}
                aria-pressed={component === "composite"}
                onClick={() => setComponent("composite")}
              >
                {translate("hdr.composite")}
              </button>
              {(selectedLayer?.components ?? ["R", "G", "B", "A"]).map((item) => (
                <button
                  type="button"
                  key={item}
                  className={component === item ? "active" : ""}
                  aria-pressed={component === item}
                  onClick={() => setComponent(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          <span>{translate("hdr.mapping")}</span>
          <select
            value={toneMapping}
            onChange={(event) =>
              setToneMapping(event.target.value as ToneMappingName)
            }
          >
            <option value="aces">ACES</option>
            <option value="reinhard">Reinhard</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label>
          <span>{translate("hdr.exposure")}</span>
          <input
            type="range"
            min="0.1"
            max="4"
            step="0.1"
            value={exposure}
            onChange={(event) => setExposure(Number(event.target.value))}
          />
          <output>{exposure.toFixed(1)}</output>
        </label>
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
    </div>
  );
}
