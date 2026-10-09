import * as THREE from "three";
import JSZip from "jszip";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
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

type ImportAsset = { path: string; file: File };

function normalizedAssetPath(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function assetExtension(asset: ImportAsset) {
  return asset.path.split(".").pop()?.toLowerCase() ?? "";
}

function findCompanion(assets: ImportAsset[], reference: string, basePath: string) {
  const decoded = (() => { try { return decodeURIComponent(reference); } catch { return reference; } })();
  const joined = normalizedAssetPath(`${basePath}/${decoded}`);
  const exact = assets.find((asset) => normalizedAssetPath(asset.path).toLowerCase() === joined.toLowerCase());
  if (exact) return exact;
  const basename = normalizedAssetPath(decoded).split("/").pop()?.toLowerCase();
  return assets.find((asset) => asset.path.split("/").pop()?.toLowerCase() === basename);
}

async function getImportAssets(files: File[]): Promise<ImportAsset[]> {
  if (!files.length) throw new Error("Choose a model file, or a ZIP containing a model and its companion files.");
  const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"));
  if (zipFile) {
    const archive = await JSZip.loadAsync(zipFile);
    const entries = Object.values(archive.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"));
    return Promise.all(entries.map(async (entry) => {
      const blob = await entry.async("blob");
      const basename = entry.name.split("/").pop() || entry.name;
      return { path: normalizedAssetPath(entry.name), file: new File([blob], basename) };
    }));
  }
  return files.map((file) => ({ path: normalizedAssetPath(file.webkitRelativePath || file.name), file }));
}

function createImportManager(assets: ImportAsset[]) {
  const urls = new Map<string, string>();
  const basenameUrls = new Map<string, string>();
  for (const asset of assets) {
    const url = URL.createObjectURL(asset.file);
    urls.set(normalizedAssetPath(asset.path).toLowerCase(), url);
    basenameUrls.set(asset.path.split("/").pop()?.toLowerCase() ?? "", url);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data:|blob:|https?:|file:)/i.test(url)) return url;
    const pathPart = url.split(/[?#]/, 1)[0] ?? url;
    let decoded = pathPart;
    try { decoded = decodeURIComponent(pathPart); } catch { /* Keep the original path when it contains malformed escapes. */ }
    const normalized = normalizedAssetPath(decoded).toLowerCase();
    return urls.get(normalized) ?? basenameUrls.get(normalized.split("/").pop() ?? "") ?? url;
  });
  return { manager, dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)) };
}

type OcctNode = { name?: string; meshes?: number[]; children?: OcctNode[] };
type OcctCadMesh = {
  name?: string;
  color?: number[];
  brep_faces?: Array<{ first: number; last: number; color?: number[] | null }>;
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
};
type OcctResult = { success: boolean; root?: OcctNode; meshes?: OcctCadMesh[] };
type OcctImporter = {
  ReadStepFile: (buffer: Uint8Array, options: Record<string, unknown> | null) => OcctResult;
  ReadIgesFile: (buffer: Uint8Array, options: Record<string, unknown> | null) => OcctResult;
};
type OcctImporterFactory = (options?: { locateFile?: (path: string) => string }) => Promise<OcctImporter>;

declare global {
  interface Window { occtimportjs?: OcctImporterFactory }
}

let occtImporterPromise: Promise<OcctImporter> | null = null;

function loadOcctImporter() {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("CAD import is only available in the browser."));
  if (!occtImporterPromise) {
    const initialization = new Promise<OcctImporter>((resolve, reject) => {
      const initialize = () => {
        const factory = window.occtimportjs;
        if (!factory) { reject(new Error("The CAD import engine did not initialize.")); return; }
        factory({ locateFile: (path) => `${import.meta.env.BASE_URL}decoders/step/${path.split("/").pop() ?? path}` }).then(resolve, reject);
      };
      if (window.occtimportjs) { initialize(); return; }
      const script = document.createElement("script");
      script.src = `${import.meta.env.BASE_URL}decoders/step/occt-import-js.js`;
      script.async = true;
      script.onload = initialize;
      script.onerror = () => { script.remove(); reject(new Error("Could not download the CAD import engine.")); };
      document.head.appendChild(script);
    });
    occtImporterPromise = initialization.catch((error: unknown) => { occtImporterPromise = null; throw error; });
  }
  return occtImporterPromise;
}

function cadMaterialColor(values?: number[] | null) {
  const rgb = values && values.length >= 3 ? values.slice(0, 3) : [0.72, 0.75, 0.79];
  const scale = Math.max(...rgb) > 1 ? 1 / 255 : 1;
  return new THREE.Color(rgb[0]! * scale, rgb[1]! * scale, rgb[2]! * scale);
}

function buildCadMesh(data: OcctCadMesh) {
  const positions = Array.from(data.attributes.position.array);
  const indices = Array.from(data.index.array);
  if (!positions.length || positions.length % 3 !== 0 || !indices.length || indices.length % 3 !== 0) throw new Error("The CAD file contains invalid triangle geometry.");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const normals = data.attributes.normal?.array;
  if (normals && normals.length === positions.length) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(Array.from(normals), 3));
  else geometry.computeVertexNormals();
  geometry.setIndex(indices);

  const materials: THREE.MeshStandardMaterial[] = [];
  const materialIndices = new Map<number, number>();
  const getMaterialIndex = (color?: number[] | null) => {
    const materialColor = cadMaterialColor(color);
    const key = materialColor.getHex();
    let materialIndex = materialIndices.get(key);
    if (materialIndex === undefined) {
      materialIndex = materials.length;
      materials.push(new THREE.MeshStandardMaterial({ color: materialColor, metalness: 0.05, roughness: 0.72 }));
      materialIndices.set(key, materialIndex);
    }
    return materialIndex;
  };
  const fallbackMaterial = getMaterialIndex(data.color);
  const triangleCount = indices.length / 3;
  let nextTriangle = 0;
  const faces = [...(data.brep_faces ?? [])].sort((left, right) => left.first - right.first);
  for (const face of faces) {
    const first = Math.max(nextTriangle, Math.max(0, Math.floor(face.first)));
    const end = Math.min(triangleCount, Math.floor(face.last) + 1);
    if (first > nextTriangle) geometry.addGroup(nextTriangle * 3, (first - nextTriangle) * 3, fallbackMaterial);
    if (end > first) geometry.addGroup(first * 3, (end - first) * 3, getMaterialIndex(face.color ?? data.color));
    nextTriangle = Math.max(nextTriangle, end);
  }
  if (nextTriangle < triangleCount) geometry.addGroup(nextTriangle * 3, (triangleCount - nextTriangle) * 3, fallbackMaterial);
  const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]!);
  mesh.name = data.name ?? "CAD Part";
  return mesh;
}

function buildCadScene(result: OcctResult) {
  if (!result.success || !result.root || !result.meshes?.length) throw new Error("The CAD file could not be parsed into 3D geometry.");
  const buildNode = (node: OcctNode): THREE.Group => {
    const group = new THREE.Group();
    group.name = node.name ?? "CAD Assembly";
    for (const meshIndex of node.meshes ?? []) {
      const meshData = result.meshes?.[meshIndex];
      if (!meshData) throw new Error("The CAD file references missing mesh data.");
      group.add(buildCadMesh(meshData));
    }
    for (const child of node.children ?? []) group.add(buildNode(child));
    return group;
  };
  return buildNode(result.root);
}

export type LoadedModel = { scene: THREE.Object3D; format: "obj" | "glb" | "gltf" | "stl" | "3mf" | "fbx" | "ply" | "dae" | "step" | "iges"; sourceName: string };

function waitForManagerResources(manager: THREE.LoadingManager) {
  let started = false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  manager.onStart = () => { started = true; };
  manager.onLoad = () => finish();
  return async () => { if (started) await done; };
}

export async function loadModel(files: File[]): Promise<LoadedModel> {
  const assets = await getImportAssets(files);
  const primary = assets.find((asset) => ["glb", "gltf", "obj", "stl", "3mf", "fbx", "ply", "dae", "step", "stp", "iges", "igs"].includes(assetExtension(asset)));
  if (!primary) throw new Error("No supported model found. Choose OBJ, GLB, glTF, STL, 3MF, FBX, PLY, COLLADA, STEP, IGES, or a ZIP bundle containing one of those formats.");
  const extension = assetExtension(primary);
  const { manager, dispose } = createImportManager(assets);
  try {
    if (extension === "obj") {
      const source = await primary.file.text();
      const referencedMtls = [...source.matchAll(/^\s*mtllib\s+(.+?)\s*$/gim)].map((match) => (match[1] ?? "").trim().replace(/^['"]|['"]$/g, ""));
      const objDirectory = primary.path.includes("/") ? primary.path.slice(0, primary.path.lastIndexOf("/")) : "";
      const materialFiles = referencedMtls.map((name) => findCompanion(assets, name, objDirectory)).filter((asset): asset is ImportAsset => !!asset);
      if (!materialFiles.length) {
        const fallbackMtl = assets.find((asset) => assetExtension(asset) === "mtl");
        if (fallbackMtl) materialFiles.push(fallbackMtl);
      }
      const loader = new OBJLoader(manager);
      if (materialFiles.length) {
        const waitForTextures = waitForManagerResources(manager);
        const materialText = await Promise.all(materialFiles.map((asset) => asset.file.text()));
        const mtlPath = materialFiles[0]?.path ?? "";
        const mtlDirectory = mtlPath.includes("/") ? `${mtlPath.slice(0, mtlPath.lastIndexOf("/"))}/` : "";
        const materials = new MTLLoader(manager).parse(materialText.join("\n"), mtlDirectory);
        materials.preload();
        loader.setMaterials(materials);
        const object = loader.parse(source);
        await waitForTextures();
        return { scene: object, format: "obj", sourceName: primary.file.name };
      }
      return { scene: loader.parse(source), format: "obj", sourceName: primary.file.name };
    }
    if (extension === "glb" || extension === "gltf") {
      const dracoLoader = new DRACOLoader(manager).setDecoderPath(`${import.meta.env.BASE_URL}decoders/draco/`);
      let renderer: THREE.WebGLRenderer | null = null;
      let ktx2Loader: KTX2Loader | null = null;
      try {
        try {
          renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false });
          ktx2Loader = new KTX2Loader(manager).setTranscoderPath(`${import.meta.env.BASE_URL}decoders/basis/`).detectSupport(renderer);
        } catch {
          renderer?.dispose();
          renderer = null;
        }
        const loader = new GLTFLoader(manager).setDRACOLoader(dracoLoader);
        if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
        const gltf = await loader.parseAsync(await primary.file.arrayBuffer(), primary.path.includes("/") ? `${primary.path.slice(0, primary.path.lastIndexOf("/"))}/` : "");
        return { scene: gltf.scene, format: extension, sourceName: primary.file.name };
      } finally {
        dracoLoader.dispose();
        ktx2Loader?.dispose();
        renderer?.dispose();
      }
    }
    if (extension === "stl") {
      const geometry = new STLLoader().parse(await primary.file.arrayBuffer());
      geometry.computeVertexNormals();
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
      return { scene: group, format: "stl", sourceName: primary.file.name };
    }
    if (extension === "3mf") {
      const waitForTextures = waitForManagerResources(manager);
      const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
      const scene = new ThreeMFLoader(manager).parse(await primary.file.arrayBuffer());
      if (!scene) throw new Error("The 3MF file could not be parsed.");
      await waitForTextures();
      return { scene, format: "3mf", sourceName: primary.file.name };
    }
    if (extension === "fbx") {
      const waitForTextures = waitForManagerResources(manager);
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const directory = primary.path.includes("/") ? `${primary.path.slice(0, primary.path.lastIndexOf("/"))}/` : "";
      const scene = new FBXLoader(manager).parse(await primary.file.arrayBuffer(), directory);
      await waitForTextures();
      return { scene, format: "fbx", sourceName: primary.file.name };
    }
    if (extension === "ply") {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geometry = new PLYLoader(manager).parse(await primary.file.arrayBuffer());
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ vertexColors: geometry.hasAttribute("color") });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geometry, material));
      return { scene: group, format: "ply", sourceName: primary.file.name };
    }
    if (extension === "dae") {
      const waitForTextures = waitForManagerResources(manager);
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const directory = primary.path.includes("/") ? `${primary.path.slice(0, primary.path.lastIndexOf("/"))}/` : "";
      const collada = new ColladaLoader(manager).parse(await primary.file.text(), directory);
      if (!collada?.scene) throw new Error("The COLLADA file could not be parsed.");
      await waitForTextures();
      return { scene: collada.scene, format: "dae", sourceName: primary.file.name };
    }
    if (["step", "stp", "iges", "igs"].includes(extension)) {
      const importer = await loadOcctImporter();
      const contents = new Uint8Array(await primary.file.arrayBuffer());
      const isStep = extension === "step" || extension === "stp";
      const result = isStep ? importer.ReadStepFile(contents, null) : importer.ReadIgesFile(contents, null);
      return { scene: buildCadScene(result), format: isStep ? "step" : "iges", sourceName: primary.file.name };
    }
    throw new Error("Choose OBJ, GLB, glTF, STL, 3MF, FBX, PLY, COLLADA, STEP, IGES, or a ZIP bundle containing a supported model.");
  } finally {
    dispose();
  }
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

export function cylindricalUnwrap(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  if (!box || !position) return;
  const height = box.max.y - box.min.y || 1;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    uv[index * 2] = Math.atan2(position.getZ(index), position.getX(index)) / (Math.PI * 2) + 0.5;
    uv[index * 2 + 1] = (position.getY(index) - box.min.y) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function boxUnwrap(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute("position");
  if (!box || !position) return;
  const size = box.getSize(new THREE.Vector3());
  const uv = new Float32Array(position.count * 2);
  const normal = geometry.getAttribute("normal");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index); const y = position.getY(index); const z = position.getZ(index);
    const nx = Math.abs(normal?.getX(index) ?? 0); const ny = Math.abs(normal?.getY(index) ?? 0); const nz = Math.abs(normal?.getZ(index) ?? 0);
    if (nx >= ny && nx >= nz) {
      uv[index * 2] = (z - box.min.z) / (size.z || 1); uv[index * 2 + 1] = (y - box.min.y) / (size.y || 1);
    } else if (ny >= nz) {
      uv[index * 2] = (x - box.min.x) / (size.x || 1); uv[index * 2 + 1] = (z - box.min.z) / (size.z || 1);
    } else {
      uv[index * 2] = (x - box.min.x) / (size.x || 1); uv[index * 2 + 1] = (y - box.min.y) / (size.y || 1);
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function transformUvs(root: THREE.Object3D, transform: { moveX?: number; moveY?: number; rotate?: number; scaleX?: number; scaleY?: number }) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const uv = object.geometry.getAttribute("uv");
    if (!uv) return;
    const angle = THREE.MathUtils.degToRad(transform.rotate ?? 0);
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    for (let index = 0; index < uv.count; index += 1) {
      const x = (uv.getX(index) - 0.5) * (transform.scaleX ?? 1);
      const y = (uv.getY(index) - 0.5) * (transform.scaleY ?? 1);
      uv.setXY(index, x * cosine - y * sine + 0.5 + (transform.moveX ?? 0), x * sine + y * cosine + 0.5 + (transform.moveY ?? 0));
    }
    uv.needsUpdate = true;
  });
}

let fallbackCheckerTexture: THREE.CanvasTexture | null = null;

function upgradeStandardMaterial(material: THREE.MeshStandardMaterial) {
  const physical = new THREE.MeshPhysicalMaterial();
  const source = material as unknown as Record<string, unknown>;
  const target = physical as unknown as Record<string, unknown>;
  const preserve = new Set(["id", "uuid", "type", "version", "_listeners"]);
  for (const key of Object.keys(source)) {
    if (preserve.has(key) || key.startsWith("is")) continue;
    const from = source[key];
    const to = target[key] as { copy?: (value: unknown) => unknown } | undefined;
    if (from && to && typeof to.copy === "function") to.copy(from);
    else target[key] = from;
  }
  physical.needsUpdate = true;
  return physical;
}

const TEXTURE_SLOT_PROPERTIES: Record<string, Record<string, string[]>> = {
  gltf: {
    "Base Color": ["map"], "Metallic–Roughness": ["metalnessMap", "roughnessMap"], "Normal Map": ["normalMap"],
    Occlusion: ["aoMap"], Emissive: ["emissiveMap"], Clearcoat: ["clearcoatMap"], "Clearcoat Roughness": ["clearcoatRoughnessMap"],
    "Clearcoat Normal": ["clearcoatNormalMap"], "Sheen Color": ["sheenColorMap"], "Sheen Roughness": ["sheenRoughnessMap"],
    Transmission: ["transmissionMap"], "Volume Thickness": ["thicknessMap"], "Specular Color": ["specularColorMap"],
    "Specular Factor": ["specularIntensityMap"], Iridescence: ["iridescenceMap"], "Iridescence Thickness": ["iridescenceThicknessMap"],
    Anisotropy: ["anisotropyMap"],
  },
  obj: {
    "Diffuse Color": ["map"], "Specular Color": ["specularMap"], "Ambient Color": ["aoMap"], Emissive: ["emissiveMap"],
    "Alpha / Opacity": ["alphaMap"], Bump: ["bumpMap"], Normal: ["normalMap"], Displacement: ["displacementMap"], Reflection: ["envMap"],
  },
};

export function applyTextureToSlot(root: THREE.Object3D, mode: "gltf" | "obj", slot: string, texture: THREE.Texture | null) {
  const properties = TEXTURE_SLOT_PROPERTIES[mode]?.[slot] ?? [];
  if (!properties.length) return 0;
  const physicalOnly = ["clearcoatMap", "clearcoatRoughnessMap", "clearcoatNormalMap", "sheenColorMap", "sheenRoughnessMap", "transmissionMap", "thicknessMap", "specularColorMap", "specularIntensityMap", "iridescenceMap", "iridescenceThicknessMap", "anisotropyMap"];
  let assigned = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (texture && properties.includes("aoMap") && !object.geometry.getAttribute("uv1")) {
      const uv = object.geometry.getAttribute("uv");
      if (uv) object.geometry.setAttribute("uv1", uv.clone());
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const updated = materials.map((original) => {
      let material = original;
      if (mode === "gltf" && properties.some((property) => physicalOnly.includes(property)) && original instanceof THREE.MeshStandardMaterial && !(original instanceof THREE.MeshPhysicalMaterial)) {
        material = upgradeStandardMaterial(original);
      }
      const target = material as THREE.Material & Record<string, unknown>;
      let changed = material !== original;
      for (const property of properties) {
        if (!(property in target)) continue;
        if (texture) assigned += 1;
        if (target[property] !== texture) {
          target[property] = texture;
          changed = true;
        }
      }
      if (texture && properties.includes("alphaMap") && "transparent" in material) material.transparent = true;
      if (texture && properties.includes("metalnessMap") && material instanceof THREE.MeshStandardMaterial && material.metalness === 0) material.metalness = 1;
      if (texture && material instanceof THREE.MeshPhysicalMaterial) {
        if (["clearcoatMap", "clearcoatRoughnessMap", "clearcoatNormalMap"].some((property) => properties.includes(property)) && material.clearcoat === 0) material.clearcoat = 1;
        if (["sheenColorMap", "sheenRoughnessMap"].some((property) => properties.includes(property)) && material.sheen === 0) material.sheen = 1;
        if ((properties.includes("transmissionMap") || properties.includes("thicknessMap")) && material.transmission === 0) material.transmission = 1;
        if (properties.includes("thicknessMap") && material.thickness === 0) material.thickness = 1;
        if ((properties.includes("iridescenceMap") || properties.includes("iridescenceThicknessMap")) && material.iridescence === 0) material.iridescence = 1;
        if (properties.includes("anisotropyMap") && material.anisotropy === 0) material.anisotropy = 1;
      }
      if (texture && properties.includes("envMap") && texture.mapping === THREE.UVMapping) texture.mapping = THREE.EquirectangularReflectionMapping;
      if (changed) material.needsUpdate = true;
      return material;
    });
    object.material = Array.isArray(object.material) ? updated : (updated[0] ?? object.material);
  });
  return assigned;
}

export function hasBaseColorTexture(root: THREE.Object3D) {
  let found = false;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => "map" in material && !!(material as THREE.Material & { map?: THREE.Texture | null }).map)) found = true;
  });
  return found;
}

export function applyTexture(root: THREE.Object3D, texture: THREE.Texture | null, wireframe = false) {
  const fallback = texture ? null : (fallbackCheckerTexture ??= createCheckerTexture());
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const editable = material as THREE.Material & { map?: THREE.Texture | null; wireframe?: boolean };
      let changed = false;
      if ("map" in editable) {
        if (texture && editable.map !== texture) { editable.map = texture; changed = true; }
        else if (!texture && !editable.map && fallback) { editable.map = fallback; changed = true; }
      }
      if ("wireframe" in editable && editable.wireframe !== wireframe) { editable.wireframe = wireframe; changed = true; }
      if (changed) editable.needsUpdate = true;
    }
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
