import * as THREE from "three";

export type ElementType = "Vertex" | "Segment" | "Polygon" | "Island";
export type SelectionMode = "Select" | "Add" | "Remove";
export type SelectedEdge = [number, number];
export type SelectionHit = { faces?: number[]; vertices?: number[]; edges?: SelectedEdge[] };
/** A selection is stored by mesh order and component indices so it survives clones and tab switches. */
export type Selection = {
  mesh: number;
  faces: number[];
  vertices: number[];
  edges: SelectedEdge[];
  element: ElementType;
} | null;

export function getMeshes(object: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  object.traverse((item) => {
    if (item instanceof THREE.Mesh && !item.userData["isSelectionOverlay"]) meshes.push(item);
  });
  return meshes;
}

export type MeshVisibilityAction = "hide-selection" | "hide-unselected" | "show-hidden";

/** Apply a hide-menu action to model meshes. Returns false when no selection/hidden meshes make it actionable. */
export function applyMeshVisibilityAction(
  root: THREE.Object3D,
  selected: THREE.Mesh | null,
  action: MeshVisibilityAction,
): boolean {
  const meshes = getMeshes(root);
  if (action === "show-hidden") {
    if (!meshes.some((mesh) => !mesh.visible)) return false;
    meshes.forEach((mesh) => {
      mesh.visible = true;
    });
    return true;
  }
  if (!selected || !meshes.includes(selected)) return false;
  if (action === "hide-selection") {
    selected.visible = false;
    return true;
  }
  meshes.forEach((mesh) => {
    mesh.visible = mesh === selected;
  });
  return true;
}

export function faceVertex(geometry: THREE.BufferGeometry, face: number, corner: number) {
  return geometry.index ? geometry.index.getX(face * 3 + corner) : face * 3 + corner;
}

export function faceCount(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  return position ? Math.floor((geometry.index ? geometry.index.count : position.count) / 3) : 0;
}

function edgeKey(edge: SelectedEdge) {
  return edge[0] < edge[1] ? `${edge[0]}:${edge[1]}` : `${edge[1]}:${edge[0]}`;
}

function canonicalEdge(edge: SelectedEdge): SelectedEdge {
  return edge[0] <= edge[1] ? [edge[0], edge[1]] : [edge[1], edge[0]];
}

function uniqueEdges(edges: SelectedEdge[]) {
  const result = new Map<string, SelectedEdge>();
  edges.forEach((edge) => result.set(edgeKey(edge), canonicalEdge(edge)));
  return [...result.values()];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
}

function combine<T>(base: T[], picked: T[], mode: SelectionMode, key: (value: T) => string) {
  const values = new Map<string, T>();
  if (mode !== "Select") base.forEach((value) => values.set(key(value), value));
  if (mode === "Remove") picked.forEach((value) => values.delete(key(value)));
  else picked.forEach((value) => values.set(key(value), value));
  return [...values.values()];
}

function faceEdges(geometry: THREE.BufferGeometry, face: number): SelectedEdge[] {
  const vertices = [0, 1, 2].map((corner) => faceVertex(geometry, face, corner));
  return [
    [vertices[0]!, vertices[1]!],
    [vertices[1]!, vertices[2]!],
    [vertices[2]!, vertices[0]!],
  ];
}

function facesForVertices(geometry: THREE.BufferGeometry, vertices: number[]) {
  const chosen = new Set(vertices);
  const faces: number[] = [];
  for (let face = 0; face < faceCount(geometry); face += 1) {
    if ([0, 1, 2].some((corner) => chosen.has(faceVertex(geometry, face, corner))))
      faces.push(face);
  }
  return faces;
}

function facesForEdges(geometry: THREE.BufferGeometry, edges: SelectedEdge[]) {
  const chosen = new Set(uniqueEdges(edges).map(edgeKey));
  const faces: number[] = [];
  for (let face = 0; face < faceCount(geometry); face += 1) {
    if (faceEdges(geometry, face).some((edge) => chosen.has(edgeKey(edge)))) faces.push(face);
  }
  return faces;
}

/** Faces connected through shared (welded) positions. */
export function islandFaces(geometry: THREE.BufferGeometry, start: number) {
  const pos = geometry.getAttribute("position");
  const total = faceCount(geometry);
  const key = (vertex: number) =>
    `${pos.getX(vertex).toFixed(5)},${pos.getY(vertex).toFixed(5)},${pos.getZ(vertex).toFixed(5)}`;
  const byKey = new Map<string, number[]>();
  const faceKeys: string[][] = [];
  for (let face = 0; face < total; face += 1) {
    const keys = [0, 1, 2].map((corner) => key(faceVertex(geometry, face, corner)));
    faceKeys.push(keys);
    keys.forEach((value) => {
      const list = byKey.get(value) ?? [];
      list.push(face);
      byKey.set(value, list);
    });
  }
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const face = stack.pop()!;
    for (const value of faceKeys[face] ?? [])
      for (const neighbor of byKey.get(value) ?? [])
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
  }
  return [...seen];
}

export function updateSelection(
  current: Selection,
  object: THREE.Object3D,
  mesh: THREE.Mesh,
  hit: SelectionHit,
  element: ElementType,
  mode: SelectionMode,
): Selection {
  const meshIndex = getMeshes(object).indexOf(mesh);
  if (meshIndex < 0) return current;
  const base =
    current && current.mesh === meshIndex && current.element === element ? current : null;
  if (element === "Vertex") {
    const vertices = uniqueNumbers(
      combine(base?.vertices ?? [], uniqueNumbers(hit.vertices ?? []), mode, String),
    );
    if (!vertices.length) return null;
    return {
      mesh: meshIndex,
      element,
      vertices,
      edges: [],
      faces: facesForVertices(mesh.geometry, vertices),
    };
  }
  if (element === "Segment") {
    const edges = uniqueEdges(
      combine(base?.edges ?? [], uniqueEdges(hit.edges ?? []), mode, edgeKey),
    );
    if (!edges.length) return null;
    return {
      mesh: meshIndex,
      element,
      edges,
      vertices: [],
      faces: facesForEdges(mesh.geometry, edges),
    };
  }
  let pickedFaces = uniqueNumbers(hit.faces ?? []);
  if (element === "Island")
    pickedFaces = uniqueNumbers(pickedFaces.flatMap((face) => islandFaces(mesh.geometry, face)));
  const faces = uniqueNumbers(combine(base?.faces ?? [], pickedFaces, mode, String));
  return faces.length ? { mesh: meshIndex, element, faces, vertices: [], edges: [] } : null;
}

/** Reinterpret the current face footprint when the user changes vertex/edge/face mode. */
export function convertSelectionElement(
  object: THREE.Object3D,
  selection: Selection,
  element: ElementType,
): Selection {
  if (!selection || selection.element === element) return selection;
  const mesh = getMeshes(object)[selection.mesh];
  if (!mesh) return null;
  const baseFaces = selection.faces.length
    ? selection.faces
    : selection.element === "Vertex"
      ? facesForVertices(mesh.geometry, selection.vertices)
      : facesForEdges(mesh.geometry, selection.edges);
  if (element === "Vertex") {
    const vertices = uniqueNumbers(
      baseFaces.flatMap((face) =>
        [0, 1, 2].map((corner) => faceVertex(mesh.geometry, face, corner)),
      ),
    );
    return {
      mesh: selection.mesh,
      element,
      vertices,
      edges: [],
      faces: facesForVertices(mesh.geometry, vertices),
    };
  }
  if (element === "Segment") {
    const edges = uniqueEdges(baseFaces.flatMap((face) => faceEdges(mesh.geometry, face)));
    return {
      mesh: selection.mesh,
      element,
      edges,
      vertices: [],
      faces: facesForEdges(mesh.geometry, edges),
    };
  }
  let faces = uniqueNumbers(baseFaces);
  if (element === "Island")
    faces = uniqueNumbers(faces.flatMap((face) => islandFaces(mesh.geometry, face)));
  return faces.length ? { mesh: selection.mesh, element, faces, vertices: [], edges: [] } : null;
}

/** World-space overlay geometry for selected triangles, vertices, or edges. */
export function selectionOverlay(object: THREE.Object3D, selection: Selection) {
  if (!selection) return null;
  const mesh = getMeshes(object)[selection.mesh];
  if (!mesh) return null;
  object.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute("position");
  const out: number[] = [];
  const point = new THREE.Vector3();
  const pushVertex = (vertex: number) => {
    point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
    out.push(point.x, point.y, point.z);
  };
  if (selection.element === "Vertex") selection.vertices.forEach(pushVertex);
  else if (selection.element === "Segment")
    selection.edges.forEach(([a, b]) => {
      pushVertex(a);
      pushVertex(b);
    });
  else
    for (const face of selection.faces)
      for (let corner = 0; corner < 3; corner += 1)
        pushVertex(faceVertex(mesh.geometry, face, corner));
  if (!out.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return geometry;
}
