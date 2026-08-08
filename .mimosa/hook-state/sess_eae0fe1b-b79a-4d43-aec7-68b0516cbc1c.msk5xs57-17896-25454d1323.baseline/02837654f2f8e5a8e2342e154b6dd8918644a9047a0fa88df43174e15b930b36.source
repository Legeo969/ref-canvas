import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef, useState } from "react";

export function PanoramaPreview({ source, alt }: { source: string; alt: string }) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [isPanorama, setIsPanorama] = useState(false);
  const [mode, setMode] = useState<"flat" | "panorama">("flat");
  const [panoramaError, setPanoramaError] = useState<string | null>(null);

  useEffect(() => {
    setIsPanorama(false);
    setMode("flat");
    setPanoramaError(null);
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (!cancelled) setIsPanorama(image.width / Math.max(1, image.height) >= 1.8);
    };
    image.src = source;
    return () => {
      cancelled = true;
      image.src = "";
    };
  }, [source]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host || !isPanorama || mode !== "panorama" || panoramaError) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101314);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
    camera.position.set(0, 0, 0.01);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setPanoramaError("当前环境不支持 360 WebGL 预览");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 0.01;
    controls.maxDistance = 0.01;
    const geometry = new THREE.SphereGeometry(10, 64, 32);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);
    let disposed = false;
    const loader = new THREE.TextureLoader();
    loader.load(source, (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    });
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
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [isPanorama, mode, panoramaError, source]);

  const showingPanorama = mode === "panorama" && isPanorama && !panoramaError;

  return (
    <div className="panorama-preview">
      {showingPanorama ? (
        <div className="panorama-canvas" ref={canvasHostRef} />
      ) : (
        <img src={source} alt={alt} draggable={false} />
      )}
      {panoramaError && mode === "panorama" && (
        <span className="panorama-error" role="alert">
          {panoramaError}
        </span>
      )}
      {isPanorama && (
        <div className="panorama-toolbar" role="group" aria-label="全景查看">
          <button
            type="button"
            className={mode === "flat" ? "active" : ""}
            aria-pressed={mode === "flat"}
            onClick={() => setMode("flat")}
          >
            平面
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
