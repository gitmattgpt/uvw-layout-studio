import * as THREE from "three";
import { faceCount, faceVertex, type Selection } from "./selection";

export type UVProjection = "Planar" | "Box" | "Cylindrical" | "Auto Unwrap" | "Original";
export type UVAxis = "X" | "Y" | "Z";
export type UVTransform = {
  moveX?: number;
  moveY?: number;
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
};

const ORIGINAL_UVS_KEY = "uvwOriginalFaceCornerUvs";

type UvBounds = { minU: number; maxU: number; minV: number; maxV: number };

function uvVertexIds(geometry: THREE.BufferGeometry, selection: Selection) {
  if (!selection) return [];
  if (selection.element === "Vertex") return [...new Set(selection.vertices)];
  const indices =
    selection.element === "Segment"
      ? selection.edges.flatMap(([a, b]) => [a, b])
      : selection.faces.flatMap((face) =>
          [0, 1, 2].map((corner) => faceVertex(geometry, face, corner)),
        );
  return [...new Set(indices)];
}

function faceVertices(geometry: THREE.BufferGeometry, face: number) {
  return [0, 1, 2].map((corner) => faceVertex(geometry, face, corner));
}

function expandOriginalUvs(geometry: THREE.BufferGeometry, uv: THREE.BufferAttribute) {
  const values: number[] = [];
  for (let face = 0; face < faceCount(geometry); face += 1) {
    for (const vertex of faceVertices(geometry, face))
      values.push(uv.getX(vertex), uv.getY(vertex));
  }
  return values;
}

export function rememberOriginalUvs(root: THREE.Object3D) {
  root.traverse((item) => {
    if (!(item instanceof THREE.Mesh)) return;
    const uv = item.geometry.getAttribute("uv");
    if (uv && !Array.isArray(item.geometry.userData[ORIGINAL_UVS_KEY])) {
      item.geometry.userData[ORIGINAL_UVS_KEY] = expandOriginalUvs(item.geometry, uv);
    }
  });
}

function collectBounds(geometry: THREE.BufferGeometry, vertexIds: number[]): UvBounds | null {
  const uv = geometry.getAttribute("uv");
  if (!uv || !vertexIds.length) return null;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const vertex of vertexIds) {
    if (vertex < 0 || vertex >= uv.count) continue;
    minU = Math.min(minU, uv.getX(vertex));
    maxU = Math.max(maxU, uv.getX(vertex));
    minV = Math.min(minV, uv.getY(vertex));
    maxV = Math.max(maxV, uv.getY(vertex));
  }
  return Number.isFinite(minU) ? { minU, maxU, minV, maxV } : null;
}

function projectVertices(
  geometry: THREE.BufferGeometry,
  vertexIds: number[],
  axis: UVAxis,
  stretch: boolean,
  projection: "Planar" | "Box" | "Cylindrical",
) {
  const position = geometry.getAttribute("position");
  if (!position || !vertexIds.length) return;
  let uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== position.count) {
    uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
    geometry.setAttribute("uv", uv);
  }
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  vertexIds.forEach((vertex) => bounds.expandByPoint(point.fromBufferAttribute(position, vertex)));
  const size = bounds.getSize(new THREE.Vector3());
  const normal = geometry.getAttribute("normal");
  if (projection === "Box" && !normal) geometry.computeVertexNormals();
  const activeNormal = geometry.getAttribute("normal");
  const projected: Array<{ vertex: number; u: number; v: number }> = [];
  for (const vertex of vertexIds) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    let u: number;
    let v: number;
    if (projection === "Cylindrical") {
      u = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
      v = (y - bounds.min.y) / (size.y || 1);
    } else {
      let projectedAxis = axis;
      if (projection === "Box") {
        const nx = Math.abs(activeNormal?.getX(vertex) ?? 0);
        const ny = Math.abs(activeNormal?.getY(vertex) ?? 0);
        const nz = Math.abs(activeNormal?.getZ(vertex) ?? 0);
        projectedAxis = nx >= ny && nx >= nz ? "X" : ny >= nz ? "Y" : "Z";
      }
      if (projectedAxis === "X") {
        u = z;
        v = y;
      } else if (projectedAxis === "Y") {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
    }
    projected.push({ vertex, u, v });
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  projected.forEach(({ u, v }) => {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  });
  const width = maxU - minU || 1;
  const height = maxV - minV || 1;
  const ratioScale = 1 / Math.max(width, height);
  for (const { vertex, u, v } of projected) {
    const nextU = stretch ? (u - minU) / width : (u - (minU + maxU) / 2) * ratioScale + 0.5;
    const nextV = stretch ? (v - minV) / height : (v - (minV + maxV) / 2) * ratioScale + 0.5;
    uv.setXY(vertex, nextU, nextV);
  }
  uv.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function targetGeometry(geometry: THREE.BufferGeometry, faces?: number[]) {
  if (!faces?.length)
    return { geometry, faces: Array.from({ length: faceCount(geometry) }, (_, i) => i) };
  const expanded = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  return {
    geometry: expanded,
    faces: [...new Set(faces)].filter((face) => face >= 0 && face < faceCount(expanded)),
  };
}

export function applyUvProjection(
  source: THREE.BufferGeometry,
  projection: UVProjection,
  options: { axis?: UVAxis; stretch?: boolean; faces?: number[]; marginPx?: number } = {},
) {
  const { axis = "Z", stretch = false, faces, marginPx = 8 } = options;
  const target = targetGeometry(source, faces);
  const geometry = target.geometry;
  const targetFaces = target.faces;
  const vertexIds = [...new Set(targetFaces.flatMap((face) => faceVertices(geometry, face)))];
  if (projection === "Original") {
    const original = source.userData[ORIGINAL_UVS_KEY] as number[] | undefined;
    if (!original?.length) return source;
    let uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (!uv || uv.count !== geometry.getAttribute("position")?.count) {
      const position = geometry.getAttribute("position");
      if (!position) return source;
      uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
      geometry.setAttribute("uv", uv);
    }
    for (const face of targetFaces) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = faceVertex(geometry, face, corner);
        const offset = (face * 3 + corner) * 2;
        if (offset + 1 < original.length)
          uv.setXY(vertex, original[offset]!, original[offset + 1]!);
      }
    }
    uv.needsUpdate = true;
  } else {
    const kind = projection === "Auto Unwrap" ? "Box" : projection;
    projectVertices(geometry, vertexIds, axis, stretch, kind);
    if (projection === "Auto Unwrap") packUvIslands(geometry, marginPx, targetFaces);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function transformSelectedUvs(
  geometry: THREE.BufferGeometry,
  selection: Selection,
  transform: UVTransform,
) {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const vertices = uvVertexIds(geometry, selection);
  if (!uv || !vertices.length) return false;
  const bounds = collectBounds(geometry, vertices);
  if (!bounds) return false;
  const centerU = (bounds.minU + bounds.maxU) / 2;
  const centerV = (bounds.minV + bounds.maxV) / 2;
  const angle = THREE.MathUtils.degToRad(transform.rotate ?? 0);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (const vertex of vertices) {
    const x = (uv.getX(vertex) - centerU) * (transform.scaleX ?? 1);
    const y = (uv.getY(vertex) - centerV) * (transform.scaleY ?? 1);
    uv.setXY(
      vertex,
      x * cosine - y * sine + centerU + (transform.moveX ?? 0),
      x * sine + y * cosine + centerV + (transform.moveY ?? 0),
    );
  }
  uv.needsUpdate = true;
  return true;
}

function positionKey(geometry: THREE.BufferGeometry, vertex: number) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  return [
    position.getX(vertex),
    position.getY(vertex),
    position.getZ(vertex),
    uv.getX(vertex),
    uv.getY(vertex),
  ]
    .map((value) => value.toFixed(5))
    .join(":");
}

export function packUvIslands(
  geometry: THREE.BufferGeometry,
  marginPx = 8,
  selectedFaces?: number[],
) {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const position = geometry.getAttribute("position");
  if (!uv || !position) return 0;
  const faces = selectedFaces?.length
    ? [...new Set(selectedFaces)].filter((face) => face >= 0 && face < faceCount(geometry))
    : Array.from({ length: faceCount(geometry) }, (_, index) => index);
  if (!faces.length) return 0;

  const edgeFaces = new Map<string, number[]>();
  const faceEdges = new Map<number, string[]>();
  for (const face of faces) {
    const vertices = faceVertices(geometry, face);
    const keys: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = positionKey(geometry, vertices[corner]!);
      const b = positionKey(geometry, vertices[(corner + 1) % 3]!);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      keys.push(edge);
      const adjacent = edgeFaces.get(edge) ?? [];
      adjacent.push(face);
      edgeFaces.set(edge, adjacent);
    }
    faceEdges.set(face, keys);
  }

  const unseen = new Set(faces);
  const islands: Array<{
    faces: number[];
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
  }> = [];
  while (unseen.size) {
    const first = unseen.values().next().value as number;
    const stack = [first];
    const islandFaces: number[] = [];
    unseen.delete(first);
    while (stack.length) {
      const face = stack.pop()!;
      islandFaces.push(face);
      for (const edge of faceEdges.get(face) ?? []) {
        for (const neighbor of edgeFaces.get(edge) ?? []) {
          if (!unseen.has(neighbor)) continue;
          unseen.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const face of islandFaces) {
      for (const vertex of faceVertices(geometry, face)) {
        minU = Math.min(minU, uv.getX(vertex));
        maxU = Math.max(maxU, uv.getX(vertex));
        minV = Math.min(minV, uv.getY(vertex));
        maxV = Math.max(maxV, uv.getY(vertex));
      }
    }
    islands.push({ faces: islandFaces, minU, maxU, minV, maxV });
  }

  const margin = Math.max(0, Math.min(64, marginPx)) / 1024;
  const usable = Math.max(0.05, 1 - margin * 2);
  const largestWidth = Math.max(...islands.map((island) => island.maxU - island.minU), 0.001);
  const largestHeight = Math.max(...islands.map((island) => island.maxV - island.minV), 0.001);
  let scale = Math.min(1, usable / largestWidth, usable / largestHeight);
  let placements: Array<{ island: (typeof islands)[number]; x: number; y: number }> = [];
  for (let attempt = 0; attempt < 90; attempt += 1) {
    placements = [];
    let x = margin;
    let y = margin;
    let rowHeight = 0;
    let failed = false;
    for (const island of [...islands].sort((a, b) => b.maxV - b.minV - (a.maxV - a.minV))) {
      const width = Math.max((island.maxU - island.minU) * scale, 0.003);
      const height = Math.max((island.maxV - island.minV) * scale, 0.003);
      if (x + width > 1 - margin && x > margin) {
        x = margin;
        y += rowHeight + margin;
        rowHeight = 0;
      }
      if (y + height > 1 - margin) {
        failed = true;
        break;
      }
      placements.push({ island, x, y });
      x += width + margin;
      rowHeight = Math.max(rowHeight, height);
    }
    if (!failed) break;
    scale *= 0.92;
  }

  for (const { island, x, y } of placements) {
    for (const face of island.faces) {
      for (const vertex of faceVertices(geometry, face)) {
        const nextU = x + (uv.getX(vertex) - island.minU) * scale;
        const nextV = y + (uv.getY(vertex) - island.minV) * scale;
        uv.setXY(vertex, nextU, nextV);
      }
    }
  }
  uv.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return islands.length;
}

export function uvSelectionVertexIds(geometry: THREE.BufferGeometry, selection: Selection) {
  return uvVertexIds(geometry, selection);
}

export function uvBounds(geometry: THREE.BufferGeometry, vertexIds?: number[]) {
  const uv = geometry.getAttribute("uv");
  if (!uv) return null;
  const ids = vertexIds?.length ? vertexIds : Array.from({ length: uv.count }, (_, index) => index);
  return collectBounds(geometry, ids);
}
