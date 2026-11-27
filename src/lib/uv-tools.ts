import * as THREE from "three";
import { faceCount, faceVertex, type Selection } from "./selection";

export type UVProjection =
  | "Planar"
  | "Box"
  | "Cylindrical"
  | "Cylinder Caps"
  | "Sphere"
  | "Auto Unwrap"
  | "Custom Unwrap"
  | "Unfold Box"
  | "Layout Islands"
  | "Original";
export type UVAxis = "X" | "Y" | "Z";
export type UVTransform = {
  moveX?: number;
  moveY?: number;
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
};

const ORIGINAL_UVS_KEY = "uvwOriginalFaceCornerUvs";
const SEAMS_KEY = "uvwSeams";
/** Modes that rebuild the mesh as non-indexed triangles (every face owns its UVs). */
const ISLAND_MODES: ReadonlySet<UVProjection> = new Set<UVProjection>([
  "Cylinder Caps",
  "Sphere",
  "Custom Unwrap",
  "Unfold Box",
  "Layout Islands",
]);

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
  expanded.userData = geometry.userData;
  return {
    geometry: expanded,
    faces: [...new Set(faces)].filter((face) => face >= 0 && face < faceCount(expanded)),
  };
}

/* ------------------------------------------------------------------ */
/* Seams                                                               */
/* ------------------------------------------------------------------ */

function vertexKey(geometry: THREE.BufferGeometry, vertex: number) {
  const p = geometry.getAttribute("position");
  return `${p.getX(vertex).toFixed(4)},${p.getY(vertex).toFixed(4)},${p.getZ(vertex).toFixed(4)}`;
}

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function readSeams(geometry: THREE.BufferGeometry) {
  const stored = geometry.userData[SEAMS_KEY];
  return new Set<string>(Array.isArray(stored) ? (stored as string[]) : []);
}

export function geometrySeamCount(geometry: THREE.BufferGeometry) {
  return readSeams(geometry).size;
}

export function seamCount(root: THREE.Object3D) {
  let total = 0;
  root.traverse((item) => {
    if (item instanceof THREE.Mesh) total += geometrySeamCount(item.geometry);
  });
  return total;
}

export function clearSeams(root: THREE.Object3D) {
  root.traverse((item) => {
    if (!(item instanceof THREE.Mesh) || !Array.isArray(item.geometry.userData[SEAMS_KEY])) return;
    const next = { ...item.geometry.userData };
    delete next[SEAMS_KEY];
    item.geometry.userData = next;
  });
}

/**
 * Marks seams from the current selection: the chosen edges for a Segment selection,
 * otherwise the outline (boundary edges) of the selected polygons/islands.
 * Returns how many new seam edges were added.
 */
export function addSeamsFromSelection(geometry: THREE.BufferGeometry, selection: Selection) {
  if (!selection || !geometry.getAttribute("position")) return 0;
  const seams = readSeams(geometry);
  const before = seams.size;
  if (selection.element === "Segment") {
    selection.edges.forEach(([a, b]) => seams.add(edgeKey(vertexKey(geometry, a), vertexKey(geometry, b))));
  } else {
    const counts = new Map<string, number>();
    for (const face of selection.faces) {
      const vertices = faceVertices(geometry, face);
      for (let corner = 0; corner < 3; corner += 1) {
        const key = edgeKey(vertexKey(geometry, vertices[corner]!), vertexKey(geometry, vertices[(corner + 1) % 3]!));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    counts.forEach((count, key) => {
      if (count === 1) seams.add(key);
    });
  }
  // Replace (not mutate) userData so undo snapshots keep their own seam list.
  geometry.userData = { ...geometry.userData, [SEAMS_KEY]: [...seams] };
  return seams.size - before;
}

/* ------------------------------------------------------------------ */
/* Triangle helpers                                                    */
/* ------------------------------------------------------------------ */

type Tri = {
  verts: [number, number, number];
  keys: [string, string, string];
  normal: THREE.Vector3;
  area: number;
};
type Neighbour = { tri: number; edge: string };

function ensureUv(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  let uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== position.count) {
    uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
    geometry.setAttribute("uv", uv);
  }
  return uv;
}

function readTriangles(geometry: THREE.BufferGeometry, faces: number[]): Tri[] {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  return faces.map((face) => {
    const verts = faceVertices(geometry, face) as [number, number, number];
    a.fromBufferAttribute(position, verts[0]);
    b.fromBufferAttribute(position, verts[1]);
    c.fromBufferAttribute(position, verts[2]);
    const normal = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a));
    const area = normal.length() / 2;
    if (area > 0) normal.normalize();
    const keys = verts.map((vertex) => vertexKey(geometry, vertex)) as [string, string, string];
    return { verts, keys, normal, area };
  });
}

/** Faces that share an edge (by position) and are not separated by a seam. */
function buildAdjacency(tris: Tri[], seams: Set<string>) {
  const edgeFaces = new Map<string, number[]>();
  tris.forEach((tri, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const key = edgeKey(tri.keys[corner]!, tri.keys[(corner + 1) % 3]!);
      const list = edgeFaces.get(key) ?? [];
      list.push(index);
      edgeFaces.set(key, list);
    }
  });
  const neighbours: Neighbour[][] = tris.map(() => []);
  edgeFaces.forEach((list, edge) => {
    if (seams.has(edge)) return;
    for (const first of list) for (const second of list) if (first !== second) neighbours[first]!.push({ tri: second, edge });
  });
  return neighbours;
}

/** Groups touching faces whose normals differ from their neighbour by no more than the threshold. */
function clusterByNormal(tris: Tri[], neighbours: Neighbour[][], maxAngleDeg: number) {
  const minDot = Math.cos(THREE.MathUtils.degToRad(THREE.MathUtils.clamp(maxAngleDeg, 0, 180)));
  const seen = new Array<boolean>(tris.length).fill(false);
  const clusters: number[][] = [];
  for (let start = 0; start < tris.length; start += 1) {
    if (seen[start]) continue;
    seen[start] = true;
    const stack = [start];
    const cluster: number[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      cluster.push(current);
      for (const { tri } of neighbours[current]!) {
        if (seen[tri] || tris[current]!.normal.dot(tris[tri]!.normal) < minDot) continue;
        seen[tri] = true;
        stack.push(tri);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** Projects every cluster flat along its own average normal. Clusters stay disconnected. */
function layoutClustersPlanar(geometry: THREE.BufferGeometry, tris: Tri[], clusters: number[][]) {
  const position = geometry.getAttribute("position");
  const uv = ensureUv(geometry);
  const point = new THREE.Vector3();
  for (const cluster of clusters) {
    const normal = new THREE.Vector3();
    cluster.forEach((index) => normal.addScaledVector(tris[index]!.normal, tris[index]!.area));
    if (normal.lengthSq() < 1e-12) normal.copy(tris[cluster[0]!]!.normal);
    normal.normalize();
    const up = Math.abs(normal.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(up, normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
    for (const index of cluster) {
      for (const vertex of tris[index]!.verts) {
        point.fromBufferAttribute(position, vertex);
        uv.setXY(vertex, point.dot(tangent), point.dot(bitangent));
      }
    }
  }
  uv.needsUpdate = true;
}

/**
 * Hinge unfold: flattens connected faces one at a time by rotating each neighbour about the
 * shared edge. Seams (and edges not reached by the walk) become the cuts. Exact for developable
 * shapes such as boxes; curved surfaces will show distortion.
 */
function unfoldByEdges(geometry: THREE.BufferGeometry, tris: Tri[], neighbours: Neighbour[][]) {
  const position = geometry.getAttribute("position");
  const uv = ensureUv(geometry);
  const flat: Array<[THREE.Vector2, THREE.Vector2, THREE.Vector2] | undefined> = tris.map(() => undefined);
  const at = (vertex: number) => new THREE.Vector3().fromBufferAttribute(position, vertex);

  for (let seed = 0; seed < tris.length; seed += 1) {
    if (flat[seed]) continue;
    const first = tris[seed]!;
    const a = at(first.verts[0]);
    const b = at(first.verts[1]);
    const c = at(first.verts[2]);
    const d01 = a.distanceTo(b);
    const d02 = a.distanceTo(c);
    const d12 = b.distanceTo(c);
    const x = d01 > 1e-9 ? (d01 * d01 + d02 * d02 - d12 * d12) / (2 * d01) : 0;
    const y = Math.sqrt(Math.max(0, d02 * d02 - x * x));
    flat[seed] = [new THREE.Vector2(0, 0), new THREE.Vector2(d01, 0), new THREE.Vector2(x, y)];
    const stack = [seed];
    while (stack.length) {
      const current = stack.pop()!;
      const currentTri = tris[current]!;
      const currentFlat = flat[current]!;
      for (const { tri: next, edge } of neighbours[current]!) {
        if (flat[next]) continue;
        const nextTri = tris[next]!;
        const [endA, endB] = edge.split("|");
        const ia = currentTri.keys.indexOf(endA!);
        const ib = currentTri.keys.indexOf(endB!);
        const ja = nextTri.keys.indexOf(endA!);
        const jb = nextTri.keys.indexOf(endB!);
        if (ia < 0 || ib < 0 || ja < 0 || jb < 0 || ia === ib || ja === jb) continue;
        const ic = 3 - ia - ib;
        const jc = 3 - ja - jb;
        const pa = currentFlat[ia]!;
        const pb = currentFlat[ib]!;
        const pc = currentFlat[ic]!;
        const A = at(nextTri.verts[ja]!);
        const B = at(nextTri.verts[jb]!);
        const C = at(nextTri.verts[jc]!);
        const d = A.distanceTo(B);
        const da = A.distanceTo(C);
        const db = B.distanceTo(C);
        const along = new THREE.Vector2().subVectors(pb, pa);
        const length = along.length() || 1;
        along.divideScalar(length);
        const across = new THREE.Vector2(-along.y, along.x);
        const side = Math.sign(new THREE.Vector2().subVectors(pc, pa).dot(across)) || 1;
        const t = d > 1e-9 ? (da * da - db * db + d * d) / (2 * d) : 0;
        const h = Math.sqrt(Math.max(0, da * da - t * t));
        const third = pa.clone().addScaledVector(along, t).addScaledVector(across, -side * h);
        const placed: [THREE.Vector2, THREE.Vector2, THREE.Vector2] = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
        placed[ja] = pa.clone();
        placed[jb] = pb.clone();
        placed[jc] = third;
        flat[next] = placed;
        stack.push(next);
      }
    }
  }

  tris.forEach((tri, index) => {
    const corners = flat[index];
    if (!corners) return;
    tri.verts.forEach((vertex, corner) => uv.setXY(vertex, corners[corner]!.x, corners[corner]!.y));
  });
  uv.needsUpdate = true;
}

/** Wraps angles for one face so it never straddles the ±π seam. */
function unwrapAngles(angles: number[]) {
  if (Math.max(...angles) - Math.min(...angles) > Math.PI) return angles.map((angle) => (angle < 0 ? angle + Math.PI * 2 : angle));
  return angles;
}

/** Cylinder side wrapped around Y, with top/bottom caps projected flat as their own islands. */
function projectCylinderCaps(geometry: THREE.BufferGeometry, tris: Tri[]) {
  const position = geometry.getAttribute("position");
  const uv = ensureUv(geometry);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  tris.forEach((tri) => tri.verts.forEach((vertex) => bounds.expandByPoint(point.fromBufferAttribute(position, vertex))));
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) / 2 || 1;
  for (const tri of tris) {
    const isCap = Math.abs(tri.normal.y) >= Math.SQRT1_2;
    if (isCap) {
      const flip = tri.normal.y >= 0 ? 1 : -1;
      tri.verts.forEach((vertex) => {
        point.fromBufferAttribute(position, vertex);
        uv.setXY(vertex, (point.x - centre.x) * flip, point.z - centre.z);
      });
    } else {
      const angles = unwrapAngles(
        tri.verts.map((vertex) => {
          point.fromBufferAttribute(position, vertex);
          return Math.atan2(point.z - centre.z, point.x - centre.x);
        }),
      );
      tri.verts.forEach((vertex, corner) => {
        point.fromBufferAttribute(position, vertex);
        uv.setXY(vertex, angles[corner]! * radius, point.y - bounds.min.y);
      });
    }
  }
  uv.needsUpdate = true;
}

/** Equirectangular sphere projection, scaled to fill the 0–1 square. */
function projectSphere(geometry: THREE.BufferGeometry, tris: Tri[]) {
  const position = geometry.getAttribute("position");
  const uv = ensureUv(geometry);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  tris.forEach((tri) => tri.verts.forEach((vertex) => bounds.expandByPoint(point.fromBufferAttribute(position, vertex))));
  const centre = bounds.getCenter(new THREE.Vector3());
  let minU = Infinity;
  let maxU = -Infinity;
  const values: Array<{ vertex: number; u: number; v: number }> = [];
  for (const tri of tris) {
    const angles = unwrapAngles(
      tri.verts.map((vertex) => {
        point.fromBufferAttribute(position, vertex);
        return Math.atan2(point.z - centre.z, point.x - centre.x);
      }),
    );
    tri.verts.forEach((vertex, corner) => {
      point.fromBufferAttribute(position, vertex);
      const radius = point.distanceTo(centre) || 1;
      const u = angles[corner]! / (Math.PI * 2);
      const v = Math.asin(THREE.MathUtils.clamp((point.y - centre.y) / radius, -1, 1)) / Math.PI + 0.5;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      values.push({ vertex, u, v });
    });
  }
  const span = maxU - minU || 1;
  values.forEach(({ vertex, u, v }) => uv.setXY(vertex, (u - minU) / span, v));
  uv.needsUpdate = true;
}

function applyIslandProjection(
  source: THREE.BufferGeometry,
  projection: UVProjection,
  options: { faces?: number[]; marginPx?: number; angleDeg?: number },
) {
  const { faces, marginPx = 8, angleDeg = 45 } = options;
  const geometry = source.index || faces?.length ? source.toNonIndexed() : source;
  if (geometry !== source) geometry.userData = source.userData;
  const total = faceCount(geometry);
  const targetFaces = faces?.length
    ? [...new Set(faces)].filter((face) => face >= 0 && face < total)
    : Array.from({ length: total }, (_, index) => index);
  if (!targetFaces.length) return source;
  const partial = Boolean(faces?.length);
  const tris = readTriangles(geometry, targetFaces);
  const seams = readSeams(source);

  if (projection === "Sphere") {
    projectSphere(geometry, tris);
  } else if (projection === "Cylinder Caps") {
    projectCylinderCaps(geometry, tris);
    packUvIslands(geometry, marginPx, partial ? targetFaces : undefined);
  } else if (projection === "Layout Islands") {
    const clusters = clusterByNormal(tris, buildAdjacency(tris, seams), angleDeg);
    layoutClustersPlanar(geometry, tris, clusters);
    packUvIslands(geometry, marginPx, partial ? targetFaces : undefined);
  } else {
    // Unfold Box and Custom Unwrap: hinge-unfold across connected faces, cutting at seams.
    unfoldByEdges(geometry, tris, buildAdjacency(tris, seams));
    packUvIslands(geometry, marginPx, partial ? targetFaces : undefined);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function applyUvProjection(
  source: THREE.BufferGeometry,
  projection: UVProjection,
  options: { axis?: UVAxis; stretch?: boolean; faces?: number[]; marginPx?: number; angleDeg?: number } = {},
) {
  if (ISLAND_MODES.has(projection)) return applyIslandProjection(source, projection, options);
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
    const kind = projection === "Auto Unwrap" ? "Box" : (projection as "Planar" | "Box" | "Cylindrical");
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

type Island = { faces: number[]; minU: number; maxU: number; minV: number; maxV: number };

function islandBounds(geometry: THREE.BufferGeometry, uv: THREE.BufferAttribute, island: Island) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const face of island.faces) {
    for (const vertex of faceVertices(geometry, face)) {
      minU = Math.min(minU, uv.getX(vertex));
      maxU = Math.max(maxU, uv.getX(vertex));
      minV = Math.min(minV, uv.getY(vertex));
      maxV = Math.max(maxV, uv.getY(vertex));
    }
  }
  island.minU = minU;
  island.maxU = maxU;
  island.minV = minV;
  island.maxV = maxV;
}

/** Rotates an island (in 3° steps) to the angle with the smallest bounding box. */
function rotateIslandToFit(geometry: THREE.BufferGeometry, uv: THREE.BufferAttribute, island: Island) {
  const vertices = [...new Set(island.faces.flatMap((face) => faceVertices(geometry, face)))];
  if (vertices.length < 3) return;
  let centreU = 0;
  let centreV = 0;
  vertices.forEach((vertex) => {
    centreU += uv.getX(vertex);
    centreV += uv.getY(vertex);
  });
  centreU /= vertices.length;
  centreV /= vertices.length;
  let bestAngle = 0;
  let bestArea = Infinity;
  for (let degrees = 0; degrees < 90; degrees += 3) {
    const radians = THREE.MathUtils.degToRad(degrees);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const vertex of vertices) {
      const x = uv.getX(vertex) - centreU;
      const y = uv.getY(vertex) - centreV;
      const u = x * cos - y * sin;
      const v = x * sin + y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-12) {
      bestArea = area;
      bestAngle = radians;
    }
  }
  if (bestAngle === 0) return;
  const cos = Math.cos(bestAngle);
  const sin = Math.sin(bestAngle);
  for (const vertex of vertices) {
    const x = uv.getX(vertex) - centreU;
    const y = uv.getY(vertex) - centreV;
    uv.setXY(vertex, centreU + x * cos - y * sin, centreV + x * sin + y * cos);
  }
  islandBounds(geometry, uv, island);
}

/**
 * Repacks UV islands inside 0–1 without overlap. Each island is rotated to its tightest fit,
 * then all islands are scaled up (or down) together to the largest size that still fits.
 * Returns the number of islands.
 */
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
  const islands: Island[] = [];
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
    const island: Island = { faces: islandFaces, minU: 0, maxU: 0, minV: 0, maxV: 0 };
    islandBounds(geometry, uv, island);
    rotateIslandToFit(geometry, uv, island);
    islands.push(island);
  }

  const margin = Math.max(0, Math.min(64, marginPx)) / 1024;
  const usable = Math.max(0.05, 1 - margin * 2);
  const ordered = [...islands].sort((a, b) => b.maxV - b.minV - (a.maxV - a.minV));
  const tryPack = (scale: number) => {
    const placed: Array<{ island: Island; x: number; y: number }> = [];
    let x = margin;
    let y = margin;
    let rowHeight = 0;
    for (const island of ordered) {
      const width = Math.max((island.maxU - island.minU) * scale, 0.003);
      const height = Math.max((island.maxV - island.minV) * scale, 0.003);
      if (x + width > 1 - margin && x > margin) {
        x = margin;
        y += rowHeight + margin;
        rowHeight = 0;
      }
      if (y + height > 1 - margin) return null;
      placed.push({ island, x, y });
      x += width + margin;
      rowHeight = Math.max(rowHeight, height);
    }
    return placed;
  };

  const largest = Math.max(...islands.map((island) => Math.max(island.maxU - island.minU, island.maxV - island.minV)), 1e-6);
  const highest = usable / largest;
  let scale = highest;
  let placements = tryPack(highest);
  if (!placements) {
    let low = highest * 0.001;
    let high = highest;
    let best = tryPack(low);
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      const attempt = tryPack(middle);
      if (attempt) {
        low = middle;
        best = attempt;
      } else {
        high = middle;
      }
    }
    scale = low;
    placements = best;
    while (!placements && scale > 1e-9) {
      scale *= 0.5;
      placements = tryPack(scale);
    }
  }

  for (const { island, x, y } of placements ?? []) {
    const moved = new Set<number>();
    for (const face of island.faces) {
      for (const vertex of faceVertices(geometry, face)) {
        if (moved.has(vertex)) continue;
        moved.add(vertex);
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
