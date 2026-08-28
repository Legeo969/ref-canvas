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

export function canRenderEnvironmentPreview(
  forcedMode: EnvironmentPreviewMode | undefined,
  isPanorama: boolean,
): boolean {
  return forcedMode === "reflection" || forcedMode === "panorama" || isPanorama;
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
  const environmentEligible = canRenderEnvironmentPreview(forcedMode, isPanorama);

  useEffect(() => {
    setIsPanorama(false);
    setMode("flat");
    setPanoramaError(null);
    setEnvironmentImage(null);
    setRendererReady(false);
    const image = new Image();
    let cancelled = false;
    image.crossOrigin = "anonymous";
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
    image.onerror = () => {
      if (!cancelled) setPanoramaError(translate("panorama.error"));
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
    if (!host || !environmentEligible || !environmentImage || effectiveMode === "flat" || panoramaError) return;
    const scene = new THREE.Scene();
    const isReflection = effectiveMode === "reflection";
    scene.background = new THREE.Color(isReflection ? 0x121617 : 0x101314);
    const camera = new THREE.PerspectiveCamera(
      isReflection ? 44 : 72,
      1,
      0.1,
      100,
    );
    camera.position.set(0, 0, effectiveMode === "panorama" ? 0.01 : 3.25);
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
    controls.minDistance = effectiveMode === "panorama" ? 0.01 : 2.35;
    controls.maxDistance = effectiveMode === "panorama" ? 0.01 : 6.5;
    const geometry = new THREE.SphereGeometry(
      effectiveMode === "panorama" ? 10 : 1.1,
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
    // The neutral studio lights keep the ball readable when the source has
    // little energy in its lower hemisphere; the environment still drives
    // the visible reflections through scene.environment.
    let ground: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
    if (isReflection) {
      scene.add(new THREE.HemisphereLight(0xe9efec, 0x1b211f, 0.18));
      const key = new THREE.DirectionalLight(0xffffff, 0.42);
      key.position.set(3, 4, 4);
      scene.add(key);
      ground = new THREE.Mesh(
        new THREE.CircleGeometry(1.55, 64),
        new THREE.MeshBasicMaterial({
          color: 0x050706,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      // A camera-facing, vertically compressed disc reads as the soft contact
      // shadow used by studio HDRI viewers without requiring a shadow map.
      ground.scale.set(1, 0.24, 1);
      ground.position.set(0, -1.02, -0.28);
      scene.add(ground);
    }
    const texture = createEnvironmentTexture(environmentImage);
    let reflectionEnvironment: THREE.Texture | null = null;
    let pmremGenerator: THREE.PMREMGenerator | null = null;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.map = texture;
    } else {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.needsUpdate = true;
      try {
        pmremGenerator = new THREE.PMREMGenerator(renderer);
        reflectionEnvironment = pmremGenerator.fromEquirectangular(texture).texture;
        material.envMap = reflectionEnvironment;
        scene.environment = reflectionEnvironment;
      } catch {
        texture.dispose();
        geometry.dispose();
        material.dispose();
        pmremGenerator?.dispose();
        renderer.dispose();
        host.replaceChildren();
        setPanoramaError(translate("panorama.error"));
        return;
      }
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
      if (ground) {
        ground.geometry.dispose();
        ground.material.dispose();
      }
      texture.dispose();
      reflectionEnvironment?.dispose();
      pmremGenerator?.dispose();
      material.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [effectiveMode, environmentEligible, environmentImage, exposure, panoramaError, toneMapping]);

  const showingEnvironment = effectiveMode !== "flat" && environmentEligible && !panoramaError;

  return (
    <div className="panorama-preview" data-environment-mode={effectiveMode}>
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
        {effectiveMode === "reflection" && <span className="panorama-reflection-fallback-shade" aria-hidden="true" />}
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
