import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef, useState } from "react";
import type { AssetRecord } from "../../shared/contracts";
import {
  sanitizeModelView,
  viewsEqual,
  type ModelView,
} from "../model-view";

export type { ModelView };

export type ModelPreviewSource = Pick<
  AssetRecord,
  "id" | "linkState" | "extension" | "previewUrl"
>;

interface ModelPreviewProps {
  asset: ModelPreviewSource;
  /** 文档中保存的相机视图；提供时优先于默认相机位置。 */
  initialView?: ModelView | null;
  /** 相机交互结束（含阻尼收敛或浮层关闭）时回调最新视图。 */
  onCameraChange?(view: ModelView): void;
}

export function ModelPreview({
  asset,
  initialView,
  onCameraChange,
}: ModelPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || asset.linkState !== "online") return;
    setFailed(false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x26312e, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 6, 5);
    scene.add(key);

    let model: THREE.Object3D | null = null;
    let disposed = false;
    // 相机写回：持续跟踪最新视图，交互结束/卸载时去重回调一次。
    let latestView: ModelView | null = null;
    let lastEmitted: ModelView | null = null;
    let ready = false;
    const emitCamera = () => {
      if (!ready || !onCameraChangeRef.current || !latestView) return;
      const view = sanitizeModelView(latestView);
      if (lastEmitted && viewsEqual(lastEmitted, view)) return;
      lastEmitted = view;
      onCameraChangeRef.current(view);
    };
    const trackCamera = () => {
      latestView = {
        position: [
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    };
    controls.addEventListener("change", trackCamera);
    controls.addEventListener("end", emitCamera);

    const showModel = (object: THREE.Object3D) => {
      if (disposed) return;
      model = object;
      scene.add(object);
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const radius = Math.max(size.x, size.y, size.z, 0.1);
      camera.near = Math.max(radius / 1000, 0.001);
      camera.far = radius * 100;
      if (initialView) {
        // 按文档保存的相机位置打开预览。
        const restored = sanitizeModelView(initialView);
        camera.position.set(
          restored.position[0],
          restored.position[1],
          restored.position[2],
        );
        controls.target.set(
          restored.target[0],
          restored.target[1],
          restored.target[2],
        );
      } else {
        camera.position.set(radius * 1.4, radius * 0.9, radius * 1.8);
        controls.target.set(0, 0, 0);
      }
      camera.updateProjectionMatrix();
      controls.update();
      trackCamera();
      ready = true;
    };
    const onError = () => {
      if (!disposed) setFailed(true);
    };

    switch (asset.extension) {
      case "glb":
      case "gltf":
        new GLTFLoader().load(
          asset.previewUrl,
          (gltf) => showModel(gltf.scene),
          undefined,
          onError,
        );
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
          (geometry) => {
            const material = new THREE.MeshStandardMaterial({
              color: 0x8bcbb8,
              roughness: 0.72,
              metalness: 0.08,
            });
            showModel(new THREE.Mesh(geometry, material));
          },
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
      renderer.render(scene, camera);
    });

    return () => {
      // 浮层关闭时补发最后一次相机视图（阻尼可能尚未触发 end）。
      emitCamera();
      disposed = true;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.removeEventListener("change", trackCamera);
      controls.removeEventListener("end", emitCamera);
      controls.dispose();
      model?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [asset.id, asset.linkState, asset.previewUrl, asset.extension]);

  return (
    <div className="model-preview" ref={hostRef}>
      {failed && (
        <span className="preview-message">
          此模型无法实时预览，可使用“打开”交给关联软件。
        </span>
      )}
    </div>
  );
}
