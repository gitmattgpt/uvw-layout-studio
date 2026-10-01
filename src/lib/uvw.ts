import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";

export type PrimitiveName = "Box" | "Sphere" | "Cylinder" | "Torus" | "Knot" | "Plane";

export function primitiveGeometry(name: PrimitiveName): THREE.BufferGeometry {
  switch (name) {
    case "Sphere": return new THREE.SphereGeometry(1.25, 32, 20);
    case "Cylinder": return new THREE.CylinderGeometry(1, 1, 2.2, 32, 4);
    case "Torus": return new THREE.TorusGeometry(1.05, 0.38, 20, 64);
    case "Knot": return new THREE.TorusKnotGeometry(0.82, 0.28, 96, 16);
    case "Plane": return new THREE.PlaneGeometry(2.5, 2.5, 4, 4);
    default: return new THREE.BoxGeometry(2, 2, 2, 4, 4, 4);
  }
}

export function createCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const cells = 8;
  const unit = canvas.width / cells;
  for (let y = 0; y < cells; y += 1) for (let x = 0; x < cells; x += 1) {
    ctx.fillStyle = (x + y) % 2 ? "#bc7652" : "#08a7ae";
    ctx.fillRect(x * unit, y * unit, unit, unit);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export async function loadModel(file: File): Promise<THREE.Group> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "obj") {
    const source = await file.text();
    return new OBJLoader().parse(source);
  }
  if (extension === "glb" || extension === "gltf") {
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      return gltf.scene;
    } finally { URL.revokeObjectURL(url); }
  }
  throw new Error("Choose an OBJ, GLB, or glTF file.");
}

export function normalizeModel(source: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.add(source);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const scale = 2.7 / Math.max(size.x, size.y, size.z, 0.001);
  group.scale.setScalar(scale);
  const normalized = new THREE.Box3().setFromObject(group);
  const center = normalized.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      if (!object.geometry.getAttribute("uv")) planarUnwrap(object.geometry);
    }
  });
  return group;
}

export function planarUnwrap(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  if (!box || !position) return;
  const size = box.getSize(new THREE.Vector3());
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) - box.min.x) / (size.x || 1);
    uv[i * 2 + 1] = (position.getY(i) - box.min.y) / (size.y || 1);
  }
  const uvAttribute = new THREE.BufferAttribute(uv, 2);
  uvAttribute.needsUpdate = true;
  geometry.setAttribute("uv", uvAttribute);
}

export function applyTexture(root: THREE.Object3D, texture: THREE.Texture | null, wireframe = false) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = new THREE.MeshStandardMaterial({ map: texture ?? createCheckerTexture(), roughness: 0.72, metalness: 0.05, wireframe });
    object.material = material;
  });
}

export function getStats(root: THREE.Object3D) {
  let faces = 0; let vertices = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const pos = object.geometry.getAttribute("position");
    vertices += pos?.count ?? 0;
    faces += object.geometry.index ? object.geometry.index.count / 3 : (pos?.count ?? 0) / 3;
  });
  return { faces: Math.round(faces), vertices };
}

export function getFirstGeometry(root: THREE.Object3D) {
  let geometry: THREE.BufferGeometry | null = null;
  root.traverse((object) => { if (!geometry && object instanceof THREE.Mesh) geometry = object.geometry; });
  return geometry as THREE.BufferGeometry | null;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportGlb(root: THREE.Object3D) {
  const data = await new GLTFExporter().parseAsync(root, { binary: true });
  downloadBlob(new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }), "uvw-model.glb");
}

export function exportObj(root: THREE.Object3D) {
  const source = new OBJExporter().parse(root);
  downloadBlob(new Blob([source], { type: "text/plain" }), "uvw-model.obj");
}
