import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef, useState } from "react";
import { translate } from "../app/i18n";

export type EnvironmentPreviewMode = "flat" | "reflection" | "panorama";

export function resolveEnvironmentPreviewMode(
  forcedMode: EnvironmentPreviewMode | undefined,
  selectedMode: EnvironmentPreviewMode,
): EnvironmentPreviewMode {
  return forcedMode ?? selectedMode;
}

export function createEnvironmentTexture(image: HTMLImageElement): THREE.Texture {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function environmentFallbackKind(mode: EnvironmentPreviewMode): "flat" | "reflection-ball" | "equirectangular" {
  if (mode === "reflection") return "reflection-ball";
  if (mode === "panorama") return "equirectangular";
  return "flat";
}

export function PanoramaPreview({
  source,
  alt,
  forcedMode,
  exposure = 1,
  toneMapping = THREE.LinearToneMapping,
}: {
  source: string;
  alt: string;
  forcedMode?: EnvironmentPreviewMode;
  exposure?: number;
  toneMapping?: THREE.ToneMapping;
}) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [isPanorama, setIsPanorama] = useState(false);
  const [mode, setMode] = useState<EnvironmentPreviewMode>("flat");
  const [panoramaError, setPanoramaError] = useState<string | null>(null);
  const [environmentImage, setEnvironmentImage] = useState<HTMLImageElement | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const effectiveMode = resolveEnvironmentPreviewMode(forcedMode, mode);

  useEffect(() => {
    setIsPanorama(false);
    setMode("flat");
    setPanoramaError(null);
    setEnvironmentImage(null);
    setRendererReady(false);
    const image = new Image();
    let cancelled = false;
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // The load event remains a valid fallback for protocol images.
      }
      if (!cancelled) {
        setIsPanorama(image.width / Math.max(1, image.height) >= 1.8);
        setEnvironmentImage(image);
      }
    };
    image.src = source;
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [source]);

  useEffect(() => {
    setRendererReady(false);
    const host = canvasHostRef.current;
    if (!host || !isPanorama || !environmentImage || effectiveMode === "flat" || panoramaError) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101314);
    const camera = new THREE.PerspectiveCamera(
      effectiveMode === "panorama" ? 72 : 44,
      1,
      0.1,
      100,
    );
    camera.position.set(0, 0, effectiveMode === "panorama" ? 0.01 : 3.2);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setPanoramaError(translate("panorama.error"));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = exposure;
    host.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.enableDamping = true;
    controls.minDistance = effectiveMode === "panorama" ? 0.01 : 2.1;
    controls.maxDistance = effectiveMode === "panorama" ? 0.01 : 6;
    const geometry = new THREE.SphereGeometry(
      effectiveMode === "panorama" ? 10 : 1,
      64,
      32,
    );
    if (effectiveMode === "panorama") geometry.scale(-1, 1, 1);
    const material = effectiveMode === "panorama"
      ? new THREE.MeshBasicMaterial({ color: 0xffffff })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 1,
          roughness: 0.06,
          envMapIntensity: 1.15,
        });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    const texture = createEnvironmentTexture(environmentImage);
    if (material instanceof THREE.MeshBasicMaterial) {
      material.map = texture;
    } else {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.needsUpdate = true;
      material.envMap = texture;
      scene.environment = texture;
    }
    material.needsUpdate = true;
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(host);
    resize();
    let firstFrame = true;
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      if (firstFrame) {
        firstFrame = false;
        setRendererReady(true);
      }
    });
    return () => {
      observer?.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      geometry.dispose();
      texture.dispose();
      material.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [effectiveMode, environmentImage, exposure, isPanorama, panoramaError, toneMapping]);

  const showingEnvironment = effectiveMode !== "flat" && isPanorama && !panoramaError;

  return (
    <div className="panorama-preview">
      {showingEnvironment ? (<>
        <img
          className={`panorama-media-fallback ${environmentFallbackKind(effectiveMode)}`}
          src={source}
          alt={alt}
          draggable={false}
        />
        <div
          className={`panorama-canvas ${effectiveMode}${rendererReady ? " ready" : ""}`}
          ref={canvasHostRef}
          data-environment-mode={effectiveMode}
        />
      </>) : (
        <img src={source} alt={alt} draggable={false} />
      )}
      {panoramaError && effectiveMode !== "flat" && (
        <span className="panorama-error" role="alert">
          {panoramaError}
        </span>
      )}
      {isPanorama && forcedMode === undefined && (
        <div className="panorama-toolbar" role="group" aria-label={translate("panorama.viewer")}>
          <button
            type="button"
            className={mode === "flat" ? "active" : ""}
            aria-pressed={mode === "flat"}
            onClick={() => setMode("flat")}
          >
            {translate("panorama.flat")}
          </button>
          <button
            type="button"
            className={mode === "panorama" ? "active" : ""}
            aria-pressed={mode === "panorama"}
            onClick={() => setMode("panorama")}
          >
            360
          </button>
        </div>
      )}
    </div>
  );
}
