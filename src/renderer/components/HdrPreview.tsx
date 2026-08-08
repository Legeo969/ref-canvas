import * as THREE from "three";
import { useEffect, useRef, useState } from "react";
import {
  alphaBackgroundStyle,
  useFoundSettings,
} from "../app/found-settings";
import { translate } from "../app/i18n";

type ToneMappingName = "aces" | "reinhard" | "neutral";
type DisplayComponent = "R" | "G" | "B" | "A";

interface DisplayLayer {
  name: string;
  components: DisplayComponent[];
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
}: {
  source: string;
  extension: string;
  path?: string;
}) {
  const foundSettings = useFoundSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const planeRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const [exposure, setExposure] = useState(1);
  const [toneMapping, setToneMapping] = useState<ToneMappingName>("aces");
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [layers, setLayers] = useState<DisplayLayer[]>([]);
  const [defaultLayer, setDefaultLayer] = useState<string | null>(null);
  const [layer, setLayer] = useState(AUTO_LAYER);
  const [component, setComponent] = useState<"composite" | DisplayComponent>(
    "composite",
  );
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
    setStatus("loading");
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
      displaySource,
      (texture) => {
        if (!active) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = texture;
        material.map = texture;
        material.needsUpdate = true;
        setStatus("ready");
        resize();
      },
      undefined,
      () => {
        if (active) setStatus("failed");
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
  }, [displaySource, extension]);

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
    <div className="hdr-preview">
      <div
        className="hdr-preview-stage"
        style={{ background: alphaBackgroundStyle(foundSettings) }}
      >
        <img
          className="hdr-preview-fallback"
          src={displaySource}
          alt={translate("hdr.alt").replace("{ext}", extension.toUpperCase())}
          draggable={false}
        />
        <div
          className="hdr-preview-canvas"
          ref={hostRef}
          style={{ opacity: status === "ready" ? 1 : 0 }}
        />
        {status === "loading" && (
          <span className="preview-message">{translate("hdr.generating")}</span>
        )}
        {status === "failed" && (
          <span className="preview-message">{translate("hdr.failed")}</span>
        )}
      </div>
      <div className="hdr-preview-controls">
        {layers.length > 0 && (
          <div className="hdr-channel-control" role="group" aria-label={translate("hdr.channelsGroup")}>
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
      </div>
    </div>
  );
}
