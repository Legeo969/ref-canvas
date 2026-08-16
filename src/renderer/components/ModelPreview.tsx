import {
  Box,
  Camera,
  Grid3X3,
  ImageDown,
  Rotate3D,
  ScanLine,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetRecord } from "../../shared/contracts";
import { usePreviewSettings } from "../app/preview-settings";
import { translate } from "../app/i18n";
import {
  modelPresetView,
  sanitizeModelView,
  viewsEqual,
  type ModelCameraPreset,
  type ModelView,
} from "../app/model-view";

type ModelDisplayMode = "solid" | "wireframe" | "uv";
type CameraSelection = ModelCameraPreset | "custom";

export type { ModelView };

export type ModelPreviewSource = Pick<
  AssetRecord,
  "id" | "linkState" | "extension" | "previewUrl"
>;

interface ModelPreviewProps {
  asset: ModelPreviewSource;
  initialView?: ModelView | null;
  allowCustomThumbnail?: boolean;
  managed?: boolean;
  controlsTarget?: HTMLElement | null;
  onCameraChange?(view: ModelView): void;
}

function createUvCheckerTexture(): THREE.DataTexture {
  const size = 16;
  const cells = 4;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const bright = (Math.floor(x / cells) + Math.floor(y / cells)) % 2 === 0;
      data[offset] = bright ? 78 : 35;
      data[offset + 1] = bright ? 218 : 105;
      data[offset + 2] = bright ? 107 : 58;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function ModelPreview({
  asset,
  initialView,
  allowCustomThumbnail = true,
  managed = false,
  controlsTarget,
  onCameraChange,
}: ModelPreviewProps) {
  const previewSettings = usePreviewSettings();
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const setPresetRef = useRef<(preset: ModelCameraPreset) => void>(() => undefined);
  const captureRef = useRef<() => string | null>(() => null);
  const [failed, setFailed] = useState(false);
  const [displayMode, setDisplayMode] = useState<ModelDisplayMode>("solid");
  const [cameraSelection, setCameraSelection] = useState<CameraSelection>(
    initialView ? "custom" : "default",
  );
  const [uvReady, setUvReady] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackPersistRef = useRef(false);
  const displayModeRef = useRef<ModelDisplayMode>("solid");
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || asset.linkState !== "online") return;
    setFailed(false);
    setDisplayMode("solid");
    setUvReady(false);
    setCameraSelection(initialView ? "custom" : "default");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(managed ? 0x1d201f : 0x222423);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.autoRotate = previewSettings.autoplayModel3d;
    controls.autoRotateSpeed = 1.6;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x202827, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc8ff, 1.25);
    rim.position.set(-4, 2, -5);
    scene.add(rim);

    const grid = new THREE.GridHelper(2, 40, 0x734848, 0x474b49);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.52;
    }
    grid.visible = false;
    scene.add(grid);

    const uvTexture = createUvCheckerTexture();
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0xe4e8e6,
      wireframe: true,
    });
    const uvMaterial = new THREE.MeshBasicMaterial({ map: uvTexture });
    const uvMissingMaterial = new THREE.MeshBasicMaterial({ color: 0x515755 });
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    let model: THREE.Object3D | null = null;
    let modelRadius = 1;
    let disposed = false;
    let lastDisplayMode: ModelDisplayMode | null = null;
    let latestView: ModelView | null = null;
    let lastEmitted: ModelView | null = null;
    let ready = false;

    const trackCamera = () => {
      latestView = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    };
    const emitCamera = () => {
      if (!ready || !onCameraChangeRef.current || !latestView) return;
      const view = sanitizeModelView(latestView);
      if (lastEmitted && viewsEqual(lastEmitted, view)) return;
      lastEmitted = view;
      onCameraChangeRef.current(view);
    };
    const markCustomView = () => setCameraSelection("custom");
    controls.addEventListener("change", trackCamera);
    controls.addEventListener("start", markCustomView);
    controls.addEventListener("end", emitCamera);

    const applyDisplayMode = (mode: ModelDisplayMode) => {
      for (const [mesh, material] of originalMaterials) {
        if (mode === "solid") mesh.material = material;
        else if (mode === "wireframe") mesh.material = wireframeMaterial;
        else mesh.material = mesh.geometry.getAttribute("uv") ? uvMaterial : uvMissingMaterial;
      }
    };

    const orientGrid = (preset: ModelCameraPreset) => {
      grid.rotation.set(0, 0, 0);
      if (preset === "front") grid.rotation.x = Math.PI / 2;
      if (preset === "left" || preset === "right") grid.rotation.z = Math.PI / 2;
      grid.visible = preset !== "default";
    };

    const applyCameraPreset = (preset: ModelCameraPreset) => {
      const view = modelPresetView(preset, modelRadius);
      camera.up.set(0, 1, 0);
      if (preset === "top") camera.up.set(0, 0, -1);
      camera.position.fromArray(view.position);
      controls.target.fromArray(view.target);
      orientGrid(preset);
      camera.updateProjectionMatrix();
      controls.update();
      trackCamera();
      setCameraSelection(preset);
      emitCamera();
    };
    setPresetRef.current = applyCameraPreset;
    captureRef.current = () => {
      if (!ready || disposed) return null;
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    };

    const showModel = (object: THREE.Object3D) => {
      if (disposed) return;
      model = object;
      scene.add(object);
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      let hasUv = false;
      object.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        originalMaterials.set(node, node.material);
        if (node.geometry.getAttribute("uv")) hasUv = true;
      });
      setUvReady(hasUv);
      modelRadius = Math.max(size.x, size.y, size.z, 0.1);
      grid.scale.setScalar(modelRadius * 2);
      camera.near = Math.max(modelRadius / 1000, 0.001);
      camera.far = modelRadius * 100;
      ready = true;
      if (initialView) {
        const restored = sanitizeModelView(initialView);
        camera.position.fromArray(restored.position);
        controls.target.fromArray(restored.target);
        grid.visible = false;
        controls.update();
        trackCamera();
      } else {
        applyCameraPreset("default");
      }
    };
    const onError = () => {
      if (!disposed) setFailed(true);
    };

    switch (asset.extension.toLowerCase()) {
      case "glb":
      case "gltf":
        new GLTFLoader().load(asset.previewUrl, (gltf) => showModel(gltf.scene), undefined, onError);
        break;
      case "fbx":
        new FBXLoader().load(asset.previewUrl, showModel, undefined, onError);
        break;
      case "obj":
        new OBJLoader().load(asset.previewUrl, showModel, undefined, onError);
        break;
      case "stl":
        new STLLoader().load(
          asset.previewUrl,
          (geometry) => showModel(new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: 0xbfc5c2,
              roughness: 0.72,
              metalness: 0.08,
            }),
          )),
          undefined,
          onError,
        );
        break;
      default:
        onError();
    }

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      const mode = displayModeRef.current;
      if (mode !== lastDisplayMode) {
        applyDisplayMode(mode);
        lastDisplayMode = mode;
      }
      renderer.render(scene, camera);
    });

    return () => {
      emitCamera();
      disposed = true;
      setPresetRef.current = () => undefined;
      captureRef.current = () => null;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.removeEventListener("change", trackCamera);
      controls.removeEventListener("start", markCustomView);
      controls.removeEventListener("end", emitCamera);
      controls.dispose();
      const materials = new Set<THREE.Material>();
      for (const material of originalMaterials.values()) {
        for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
      }
      model?.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      wireframeMaterial.dispose();
      uvMaterial.dispose();
      uvMissingMaterial.dispose();
      uvTexture.dispose();
      for (const material of gridMaterials) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [asset.id, asset.linkState, asset.previewUrl, asset.extension, managed]);

  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  useEffect(() => {
    if (!feedback || feedbackPersistRef.current) return;
    const timer = window.setTimeout(() => setFeedback(null), 2_500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const saveRenderedImage = async (mode: "export" | "thumbnail") => {
    const dataUrl = captureRef.current();
    if (!dataUrl) return;
    feedbackPersistRef.current = true;
    setFeedback(mode === "export" ? translate("model.saving") : translate("model.settingThumbnail"));
    try {
      const result = await window.refCanvas.system.saveRenderedImage(dataUrl, {
        mode,
        assetId: mode === "thumbnail" ? asset.id : undefined,
        defaultName: `RefCanvas-3D-${asset.id.slice(0, 8)}`,
      });
      feedbackPersistRef.current = false;
      setFeedback(result ? (mode === "export" ? translate("model.saved") : translate("model.thumbnailUpdated")) : null);
    } catch {
      feedbackPersistRef.current = false;
      setFeedback(mode === "export" ? translate("model.saveFailed") : translate("model.thumbnailFailed"));
    }
  };

  const presets: Array<{ id: ModelCameraPreset; label: string }> = [
    { id: "default", label: translate("collections.default") },
    { id: "top", label: translate("model.viewTop") },
    { id: "front", label: translate("model.viewFront") },
    { id: "left", label: translate("model.viewLeft") },
    { id: "right", label: translate("model.viewRight") },
  ];

  const controls = <div className="model-managed-controls"><div className="model-camera-panel" aria-label={translate("model.camera")}>
    <span>{translate("model.cameraCount").replace("{count}", String(presets.length))}</span>
    {presets.map((preset) => <button key={preset.id} type="button" className={cameraSelection === preset.id ? "active" : ""} aria-pressed={cameraSelection === preset.id} onClick={() => setPresetRef.current(preset.id)}>{preset.label}</button>)}
  </div><div className="model-preview-toolbar" role="group" aria-label={translate("model.displayMode")}>
    <button type="button" className={displayMode === "wireframe" ? "active" : ""} aria-label={translate("model.wireframe")} aria-pressed={displayMode === "wireframe"} title={translate("model.showWireframe")} onClick={() => setDisplayMode("wireframe")}><ScanLine size={16} /></button>
    <button type="button" className={displayMode === "solid" ? "active" : ""} aria-label={translate("model.solid")} aria-pressed={displayMode === "solid"} title={translate("model.solidMaterial")} onClick={() => setDisplayMode("solid")}><Box size={16} /></button>
    <button type="button" className={displayMode === "uv" ? "active" : ""} aria-label={translate("model.uvCheck")} aria-pressed={displayMode === "uv"} title={translate("model.showUvChecker")} disabled={!uvReady} onClick={() => setDisplayMode("uv")}><Grid3X3 size={16} /></button>
    <span className="model-toolbar-separator" />
    <button type="button" aria-label={translate("model.resetView")} title={translate("model.defaultView")} onClick={() => setPresetRef.current("default")}><Rotate3D size={16} /></button>
  </div><div className="model-preview-actions" role="group" aria-label={translate("model.viewActions")}>
    <button type="button" aria-label={translate("model.saveView")} title={translate("model.saveCurrentView")} onClick={() => void saveRenderedImage("export")}><Camera size={16} /></button>
    {allowCustomThumbnail && <button type="button" aria-label={translate("model.setThumbnail")} title={translate("model.setAssetThumbnail")} onClick={() => void saveRenderedImage("thumbnail")}><ImageDown size={16} /></button>}
  </div></div>;

  return (
    <div className={`model-preview${managed ? " preview-managed-preview" : ""}`} ref={rootRef}>
      <div className="model-preview-canvas" ref={hostRef} />
      {controlsTarget ? createPortal(controls, controlsTarget) : controls}
      {feedback && <span className="model-preview-feedback">{feedback}</span>}
      {failed && (
        <span className="preview-message">
          {translate("model.previewFailed")}
        </span>
      )}
    </div>
  );
}
