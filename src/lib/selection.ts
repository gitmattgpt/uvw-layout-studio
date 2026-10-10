import * as THREE from "three";

export type ElementType = "Vertex" | "Segment" | "Polygon" | "Island";
/** Selection is stored by mesh order + triangle indices so it survives clones, undo and tab switches. */
export type Selection = { mesh: number; faces: number[]; element: ElementType } | null;

export function getMeshes(object: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  object.traverse((item) => { if (item instanceof THREE.Mesh && !item.userData['isSelectionOverlay']) meshes.push(item); });
  return meshes;
}

export type MeshVisibilityAction = "hide-selection" | "hide-unselected" | "show-hidden";

/** Apply a hide-menu action to model meshes. Returns false when no selection/hidden meshes make it actionable. */
export function applyMeshVisibilityAction(root: THREE.Object3D, selected: THREE.Mesh | null, action: MeshVisibilityAction): boolean {
  const meshes = getMeshes(root);
  if (action === "show-hidden") {
    if (!meshes.some((mesh) => !mesh.visible)) return false;
    meshes.forEach((mesh) => { mesh.visible = true; });
    return true;
  }
  if (!selected || !meshes.includes(selected)) return false;
  if (action === "hide-selection") {
    selected.visible = false;
    return true;
  }
  meshes.forEach((mesh) => { mesh.visible = mesh === selected; });
  return true;
}

export function faceVertex(geometry: THREE.BufferGeometry, face: number, corner: number) {
  return geometry.index ? geometry.index.getX(face * 3 + corner) : face * 3 + corner;
}

export function faceCount(geometry: THREE.BufferGeometry) {
  return Math.floor((geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3);
}

/** Faces connected through shared (welded) positions. */
export function islandFaces(geometry: THREE.BufferGeometry, start: number) {
  const pos = geometry.getAttribute("position"); const total = faceCount(geometry);
  const key = (v: number) => `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`;
  const byKey = new Map<string, number[]>(); const faceKeys: string[][] = [];
  for (let f = 0; f < total; f += 1) {
    const keys = [0, 1, 2].map((c) => key(faceVertex(geometry, f, c))); faceKeys.push(keys);
    keys.forEach((k) => { const list = byKey.get(k) ?? []; list.push(f); byKey.set(k, list); });
  }
  const seen = new Set([start]); const stack = [start];
  while (stack.length) { const f = stack.pop()!; for (const k of faceKeys[f] ?? []) for (const n of byKey.get(k) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
  return [...seen];
}

export function updateSelection(current: Selection, object: THREE.Object3D, mesh: THREE.Mesh, face: number, element: ElementType, mode: string): Selection {
  const meshIndex = getMeshes(object).indexOf(mesh); if (meshIndex < 0) return current;
  const picked = element === "Island" ? islandFaces(mesh.geometry, face) : [face];
  const base = current && current.mesh === meshIndex ? current.faces : [];
  let faces: number[];
  if (mode === "Add") faces = [...new Set([...base, ...picked])];
  else if (mode === "Remove") { const drop = new Set(picked); faces = base.filter((f) => !drop.has(f)); }
  else faces = picked;
  return faces.length ? { mesh: meshIndex, faces, element } : null;
}

/** World-space overlay geometry for the selected triangles. */
export function selectionOverlay(object: THREE.Object3D, selection: Selection) {
  if (!selection) return null; const mesh = getMeshes(object)[selection.mesh]; if (!mesh) return null;
  object.updateMatrixWorld(true); const pos = mesh.geometry.getAttribute("position"); const out: number[] = []; const v = new THREE.Vector3();
  for (const f of selection.faces) for (let c = 0; c < 3; c += 1) { v.fromBufferAttribute(pos, faceVertex(mesh.geometry, f, c)).applyMatrix4(mesh.matrixWorld); out.push(v.x, v.y, v.z); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3)); return geometry;
}
