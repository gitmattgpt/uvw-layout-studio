import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type TouchEvent,
  type WheelEvent,
} from "react";
import * as THREE from "three";
import {
  faceCount,
  faceVertex,
  getMeshes,
  type ElementType,
  type Selection,
  type SelectionHit,
  type SelectionMode,
} from "@/lib/selection";
import { uvBounds, uvSelectionVertexIds } from "@/lib/uv-tools";

export type UVView = { zoom: number; panX: number; panY: number };
export type UVTransformMode = "Select" | "Move" | "Rotate" | "Scale";
export type UVTransformAxis = "free" | "x" | "y";
export type UVBackground = "checker" | "grid" | "texture" | "colour";

type UVWorkspaceProps = {
  object: THREE.Object3D;
  selection: Selection;
  elementType: ElementType;
  selectionMode: SelectionMode;
  transformMode: UVTransformMode;
  transformAxis: UVTransformAxis;
  locked: boolean;
  background: UVBackground;
  colour: string;
  textureUrl: string | null;
  hiddenFaces: ReadonlySet<string>;
  uvView: UVView;
  setUvView: Dispatch<SetStateAction<UVView>>;
  frameRef: RefObject<HTMLDivElement | null>;
  onSelect: (
    mesh: THREE.Mesh,
    hit: SelectionHit,
    element: ElementType,
    mode: SelectionMode,
  ) => void;
  onClearSelection: () => void;
  onTransformStart: () => void;
  onTransformFinish: (label: string) => void;
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void;
  status: string;
};

type LocalPoint = { u: number; v: number; x: number; y: number; unitCss: number };
type Rect = { left: number; top: number; right: number; bottom: number };
type TransformGesture = {
  mode: Exclude<UVTransformMode, "Select">;
  start: LocalPoint;
  centerU: number;
  centerV: number;
  vertices: Map<number, [number, number]>;
  changed: boolean;
};
type Gesture = {
  pointerId: number;
  kind: "candidate" | "marquee" | "transform";
  startClientX: number;
  startClientY: number;
  start: LocalPoint;
  transform?: TransformGesture;
};

function uvTriangle(geometry: THREE.BufferGeometry, face: number) {
  const uv = geometry.getAttribute("uv");
  if (!uv) return [] as Array<[number, number]>;
  return [0, 1, 2].map((corner) => {
    const vertex = faceVertex(geometry, face, corner);
    return [uv.getX(vertex), uv.getY(vertex)] as [number, number];
  });
}

function pointInTriangle(point: { u: number; v: number }, triangle: Array<[number, number]>) {
  if (triangle.length !== 3) return false;
  const [[ax, ay], [bx, by], [cx, cy]] = triangle as [
    [number, number],
    [number, number],
    [number, number],
  ];
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = point.u - ax;
  const v2y = point.v - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) < 1e-12) return false;
  const inverse = 1 / denominator;
  const a = (dot11 * dot02 - dot01 * dot12) * inverse;
  const b = (dot00 * dot12 - dot01 * dot02) * inverse;
  return a >= 0 && b >= 0 && a + b <= 1;
}

function pointSegmentDistance(
  point: { u: number; v: number },
  a: [number, number],
  b: [number, number],
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((point.u - a[0]) * dx + (point.v - a[1]) * dy) / lengthSq))
    : 0;
  return Math.hypot(point.u - (a[0] + t * dx), point.v - (a[1] + t * dy));
}

function inside(point: [number, number], rect: Rect) {
  return (
    point[0] >= rect.left &&
    point[0] <= rect.right &&
    point[1] >= rect.bottom &&
    point[1] <= rect.top
  );
}

function orientation(a: [number, number], b: [number, number], c: [number, number]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  const epsilon = 1e-10;
  const onSegment = (start: [number, number], point: [number, number], end: [number, number]) =>
    point[0] >= Math.min(start[0], end[0]) - epsilon &&
    point[0] <= Math.max(start[0], end[0]) + epsilon &&
    point[1] >= Math.min(start[1], end[1]) - epsilon &&
    point[1] <= Math.max(start[1], end[1]) + epsilon;
  if (
    ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon)) &&
    ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))
  )
    return true;
  return (
    (Math.abs(o1) <= epsilon && onSegment(a, c, b)) ||
    (Math.abs(o2) <= epsilon && onSegment(a, d, b)) ||
    (Math.abs(o3) <= epsilon && onSegment(c, a, d)) ||
    (Math.abs(o4) <= epsilon && onSegment(c, b, d))
  );
}

function segmentIntersectsRect(a: [number, number], b: [number, number], rect: Rect) {
  if (inside(a, rect) || inside(b, rect)) return true;
  const corners: Array<[number, number]> = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ];
  return corners.some((corner, index) =>
    segmentsIntersect(a, b, corner, corners[(index + 1) % 4]!),
  );
}

function triangleIntersectsRect(triangle: Array<[number, number]>, rect: Rect) {
  if (triangle.some((point) => inside(point, rect))) return true;
  const corners: Array<[number, number]> = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ];
  if (corners.some((corner) => pointInTriangle({ u: corner[0], v: corner[1] }, triangle)))
    return true;
  return triangle.some((point, index) =>
    segmentIntersectsRect(point, triangle[(index + 1) % 3]!, rect),
  );
}

function uvIslandMap(
  geometry: THREE.BufferGeometry,
  meshIndex: number,
  hiddenFaces: ReadonlySet<string>,
) {
  const uv = geometry.getAttribute("uv");
  const position = geometry.getAttribute("position");
  if (!uv || !position) return new Map<number, number[]>();
  const edgeFaces = new Map<string, number[]>();
  const faceEdges = new Map<number, string[]>();
  const vertexKey = (vertex: number) =>
    [
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
      uv.getX(vertex),
      uv.getY(vertex),
    ]
      .map((value) => value.toFixed(5))
      .join(":");
  for (let face = 0; face < faceCount(geometry); face += 1) {
    if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
    const vertices = [0, 1, 2].map((corner) => faceVertex(geometry, face, corner));
    const edges: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = vertexKey(vertices[corner]!);
      const b = vertexKey(vertices[(corner + 1) % 3]!);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.push(key);
      const adjoiningFaces = edgeFaces.get(key) ?? [];
      adjoiningFaces.push(face);
      edgeFaces.set(key, adjoiningFaces);
    }
    faceEdges.set(face, edges);
  }
  const mapping = new Map<number, number[]>();
  const unseen = new Set(faceEdges.keys());
  while (unseen.size) {
    const startFace = unseen.values().next().value as number;
    const island = new Set([startFace]);
    const stack = [startFace];
    unseen.delete(startFace);
    while (stack.length) {
      const face = stack.pop()!;
      for (const key of faceEdges.get(face) ?? []) {
        for (const neighbor of edgeFaces.get(key) ?? []) {
          if (!unseen.has(neighbor)) continue;
          unseen.delete(neighbor);
          island.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    const faces = [...island];
    faces.forEach((face) => mapping.set(face, faces));
  }
  return mapping;
}

function selectedVertices(geometry: THREE.BufferGeometry, selection: Selection) {
  return uvSelectionVertexIds(geometry, selection);
}

export function fitUVView(
  object: THREE.Object3D,
  selection: Selection,
  width: number,
  height: number,
  selectedOnly: boolean,
): UVView {
  const meshes = getMeshes(object);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const targets =
    selectedOnly && selection
      ? [meshes[selection.mesh]].filter((mesh): mesh is THREE.Mesh => !!mesh)
      : meshes;
  for (const mesh of targets) {
    const indices =
      selectedOnly && selection && mesh === meshes[selection.mesh]
        ? selectedVertices(mesh.geometry, selection)
        : undefined;
    const bounds = uvBounds(mesh.geometry, indices);
    if (!bounds) continue;
    minU = Math.min(minU, bounds.minU);
    maxU = Math.max(maxU, bounds.maxU);
    minV = Math.min(minV, bounds.minV);
    maxV = Math.max(maxV, bounds.maxV);
  }
  if (!Number.isFinite(minU)) return { zoom: 1, panX: 0, panY: 0 };
  const unitCss = Math.max(1, Math.min(width, height) * 0.84);
  const boundsWidth = Math.max(maxU - minU, 0.01);
  const boundsHeight = Math.max(maxV - minV, 0.01);
  const zoom = Math.max(
    0.15,
    Math.min(
      8,
      Math.min((width * 0.9) / (boundsWidth * unitCss), (height * 0.9) / (boundsHeight * unitCss)),
    ),
  );
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  return {
    zoom,
    panX: -(centerU - 0.5) * unitCss * zoom,
    panY: (centerV - 0.5) * unitCss * zoom,
  };
}

export function UVWorkspace(props: UVWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = props.frameRef;
  const gestureRef = useRef<Gesture | null>(null);
  const activePointersRef = useRef(0);
  const drawRef = useRef<() => void>(() => undefined);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const {
    object,
    selection,
    elementType,
    selectionMode,
    transformMode,
    transformAxis,
    locked,
    background,
    colour,
    textureUrl,
    hiddenFaces,
    uvView,
  } = props;

  const draw = useCallback(
    (image?: HTMLImageElement) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const host = hostRef.current;
      if (!canvas || !context || !host) return;
      const cssWidth = Math.max(1, host.clientWidth);
      const cssHeight = Math.max(1, host.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const unit = Math.min(width, height) * 0.84;
      const offsetX = (width - unit) / 2;
      const offsetY = (height - unit) / 2;
      const meshes = getMeshes(object);
      const drawPoint = (u: number, v: number): [number, number] => [
        offsetX + u * unit,
        offsetY + (1 - v) * unit,
      ];
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#111318";
      context.fillRect(0, 0, width, height);
      if (background === "texture" && image) context.drawImage(image, offsetX, offsetY, unit, unit);
      else if (background === "colour") {
        context.fillStyle = colour;
        context.fillRect(offsetX, offsetY, unit, unit);
      } else if (background === "checker") {
        const cells = 8;
        const cell = unit / cells;
        for (let y = 0; y < cells; y += 1) {
          for (let x = 0; x < cells; x += 1) {
            context.fillStyle = (x + y) % 2 ? "#252932" : "#171a20";
            context.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
          }
        }
      } else {
        context.fillStyle = "#171a20";
        context.fillRect(offsetX, offsetY, unit, unit);
        context.strokeStyle = "#454b57";
        context.lineWidth = Math.max(1, dpr);
        for (let i = 0; i <= 8; i += 1) {
          const p = (i * unit) / 8;
          context.beginPath();
          context.moveTo(offsetX + p, offsetY);
          context.lineTo(offsetX + p, offsetY + unit);
          context.stroke();
          context.beginPath();
          context.moveTo(offsetX, offsetY + p);
          context.lineTo(offsetX + unit, offsetY + p);
          context.stroke();
        }
      }
      context.strokeStyle = background === "grid" ? "#77808e" : "rgba(230,235,245,.36)";
      context.lineWidth = Math.max(1, dpr);
      context.strokeRect(offsetX, offsetY, unit, unit);

      meshes.forEach((mesh, meshIndex) => {
        const uv = mesh.geometry.getAttribute("uv");
        const position = mesh.geometry.getAttribute("position");
        if (!uv || !position) return;
        context.lineWidth = Math.max(1.2 * dpr, 1);
        context.strokeStyle = "#19c4d0";
        for (let face = 0; face < faceCount(mesh.geometry); face += 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          const points = uvTriangle(mesh.geometry, face).map(([u, v]) => drawPoint(u, v));
          if (points.length !== 3) continue;
          context.beginPath();
          points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
          context.closePath();
          context.stroke();
        }
        if (!selection || selection.mesh !== meshIndex) return;
        context.strokeStyle = "#f47a3a";
        context.fillStyle = "rgba(244,122,58,.28)";
        context.lineWidth = Math.max(2 * dpr, 1.5);
        if (selection.element === "Vertex") {
          context.fillStyle = "#ff945c";
          for (const vertex of selection.vertices) {
            const [x, y] = drawPoint(uv.getX(vertex), uv.getY(vertex));
            context.beginPath();
            context.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
            context.fill();
          }
        } else if (selection.element === "Segment") {
          for (const [a, b] of selection.edges) {
            const [ax, ay] = drawPoint(uv.getX(a), uv.getY(a));
            const [bx, by] = drawPoint(uv.getX(b), uv.getY(b));
            context.beginPath();
            context.moveTo(ax, ay);
            context.lineTo(bx, by);
            context.stroke();
          }
        } else {
          for (const face of selection.faces) {
            if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
            const points = uvTriangle(mesh.geometry, face).map(([u, v]) => drawPoint(u, v));
            if (points.length !== 3) continue;
            context.beginPath();
            points.forEach(([x, y], index) =>
              index ? context.lineTo(x, y) : context.moveTo(x, y),
            );
            context.closePath();
            context.fill();
            context.stroke();
          }
        }
      });

      if (selection && transformMode !== "Select") {
        const mesh = meshes[selection.mesh];
        const uv = mesh?.geometry.getAttribute("uv");
        const ids = mesh ? selectedVertices(mesh.geometry, selection) : [];
        const bounds = mesh ? uvBounds(mesh.geometry, ids) : null;
        if (uv && bounds) {
          const [left, top] = drawPoint(bounds.minU, bounds.maxV);
          const [right, bottom] = drawPoint(bounds.maxU, bounds.minV);
          const centerX = (left + right) / 2;
          const centerY = (top + bottom) / 2;
          context.save();
          context.strokeStyle = "#ffac63";
          context.fillStyle = "#171a20";
          context.lineWidth = 2 * dpr;
          if (transformMode === "Move") {
            const length = 29 * dpr;
            context.beginPath();
            context.moveTo(centerX - length, centerY);
            context.lineTo(centerX + length, centerY);
            context.moveTo(centerX, centerY - length);
            context.lineTo(centerX, centerY + length);
            context.stroke();
            const arrows: Array<[number, number, number, number]> = [
              [centerX + length, centerY, -1, 0],
              [centerX - length, centerY, 1, 0],
              [centerX, centerY - length, 0, 1],
              [centerX, centerY + length, 0, -1],
            ];
            for (const [x, y, dx, dy] of arrows) {
              context.beginPath();
              context.moveTo(x, y);
              context.lineTo(x + dx * 8 * dpr - dy * 5 * dpr, y + dy * 8 * dpr + dx * 5 * dpr);
              context.lineTo(x + dx * 8 * dpr + dy * 5 * dpr, y + dy * 8 * dpr - dx * 5 * dpr);
              context.closePath();
              context.fill();
            }
          } else if (transformMode === "Rotate") {
            context.beginPath();
            context.arc(centerX, centerY, 25 * dpr, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.arc(centerX, centerY, 3.5 * dpr, 0, Math.PI * 2);
            context.fill();
          } else {
            const scaleHandles: Array<[number, number]> = [
              [left, top],
              [right, top],
              [left, bottom],
              [right, bottom],
            ];
            for (const [x, y] of scaleHandles)
              context.fillRect(x - 5 * dpr, y - 5 * dpr, 10 * dpr, 10 * dpr);
            context.strokeRect(left, top, right - left, bottom - top);
          }
          context.restore();
        }
      }
    },
    [object, selection, transformMode, background, colour, hiddenFaces],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let image: HTMLImageElement | undefined;
    drawRef.current = () => draw(image);
    drawRef.current();
    if (background === "texture" && textureUrl) {
      image = new Image();
      image.onload = () => drawRef.current();
      image.src = textureUrl;
    }
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(host);
    return () => {
      observer.disconnect();
      drawRef.current = () => undefined;
    };
  }, [draw, background, textureUrl]);

  const eventPoint = (event: ReactPointerEvent<HTMLCanvasElement>): LocalPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return null;
    const rect = canvas.getBoundingClientRect();
    const zoom = Math.max(0.01, props.uvView.zoom);
    const cssX = (event.clientX - rect.left) / zoom;
    const cssY = (event.clientY - rect.top) / zoom;
    const scaleX = canvas.width / canvas.clientWidth;
    const scaleY = canvas.height / canvas.clientHeight;
    const x = cssX * scaleX;
    const y = cssY * scaleY;
    const unit = Math.min(canvas.width, canvas.height) * 0.84;
    const offsetX = (canvas.width - unit) / 2;
    const offsetY = (canvas.height - unit) / 2;
    return {
      u: (x - offsetX) / unit,
      v: 1 - (y - offsetY) / unit,
      x: cssX,
      y: cssY,
      unitCss: unit / scaleX,
    };
  };

  const visibleVertexIds = (meshIndex: number, mesh: THREE.Mesh) => {
    const result = new Set<number>();
    for (let face = 0; face < faceCount(mesh.geometry); face += 1) {
      if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
      [0, 1, 2].forEach((corner) => result.add(faceVertex(mesh.geometry, face, corner)));
    }
    return result;
  };

  const pickAt = (point: LocalPoint) => {
    const meshes = getMeshes(object);
    const threshold = 12 / Math.max(point.unitCss, 1);
    for (let meshIndex = meshes.length - 1; meshIndex >= 0; meshIndex -= 1) {
      const mesh = meshes[meshIndex]!;
      const uv = mesh.geometry.getAttribute("uv");
      if (!uv) continue;
      if (elementType === "Vertex") {
        let best: { vertex: number; distance: number } | null = null;
        for (const vertex of visibleVertexIds(meshIndex, mesh)) {
          const distance = Math.hypot(uv.getX(vertex) - point.u, uv.getY(vertex) - point.v);
          if (distance <= threshold && (!best || distance < best.distance))
            best = { vertex, distance };
        }
        if (best) return { mesh, hit: { vertices: [best.vertex] } satisfies SelectionHit };
      } else if (elementType === "Segment") {
        let best: { edge: [number, number]; distance: number } | null = null;
        const visited = new Set<string>();
        for (let face = 0; face < faceCount(mesh.geometry); face += 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          const vertices = [0, 1, 2].map((corner) => faceVertex(mesh.geometry, face, corner));
          for (let corner = 0; corner < 3; corner += 1) {
            const a = vertices[corner]!;
            const b = vertices[(corner + 1) % 3]!;
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const distance = pointSegmentDistance(
              point,
              [uv.getX(a), uv.getY(a)],
              [uv.getX(b), uv.getY(b)],
            );
            if (distance <= threshold && (!best || distance < best.distance))
              best = { edge: [a, b], distance };
          }
        }
        if (best) return { mesh, hit: { edges: [best.edge] } satisfies SelectionHit };
      } else {
        const islands =
          elementType === "Island" ? uvIslandMap(mesh.geometry, meshIndex, hiddenFaces) : null;
        for (let face = faceCount(mesh.geometry) - 1; face >= 0; face -= 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          if (pointInTriangle(point, uvTriangle(mesh.geometry, face)))
            return {
              mesh,
              hit: {
                faces: [face],
                ...(elementType === "Island" ? { islandFaces: islands?.get(face) ?? [face] } : {}),
              } satisfies SelectionHit,
            };
        }
      }
    }
    return null;
  };

  const pickRectangle = (rect: Rect) => {
    const meshes = getMeshes(object);
    for (let meshIndex = meshes.length - 1; meshIndex >= 0; meshIndex -= 1) {
      const mesh = meshes[meshIndex]!;
      const uv = mesh.geometry.getAttribute("uv");
      if (!uv) continue;
      if (elementType === "Vertex") {
        const vertices = [...visibleVertexIds(meshIndex, mesh)].filter((vertex) =>
          inside([uv.getX(vertex), uv.getY(vertex)], rect),
        );
        if (vertices.length) return { mesh, hit: { vertices } satisfies SelectionHit };
      } else if (elementType === "Segment") {
        const edges = new Map<string, [number, number]>();
        for (let face = 0; face < faceCount(mesh.geometry); face += 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          const vertices = [0, 1, 2].map((corner) => faceVertex(mesh.geometry, face, corner));
          for (let corner = 0; corner < 3; corner += 1) {
            const a = vertices[corner]!;
            const b = vertices[(corner + 1) % 3]!;
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            edges.set(key, [a, b]);
          }
        }
        const chosen = [...edges.values()].filter(([a, b]) =>
          segmentIntersectsRect([uv.getX(a), uv.getY(a)], [uv.getX(b), uv.getY(b)], rect),
        );
        if (chosen.length) return { mesh, hit: { edges: chosen } satisfies SelectionHit };
      } else {
        const islands =
          elementType === "Island" ? uvIslandMap(mesh.geometry, meshIndex, hiddenFaces) : null;
        const faces: number[] = [];
        for (let face = 0; face < faceCount(mesh.geometry); face += 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          if (triangleIntersectsRect(uvTriangle(mesh.geometry, face), rect)) faces.push(face);
        }
        if (faces.length)
          return {
            mesh,
            hit: {
              faces,
              ...(elementType === "Island"
                ? {
                    islandFaces: [
                      ...new Set(faces.flatMap((face) => islands?.get(face) ?? [face])),
                    ],
                  }
                : {}),
            } satisfies SelectionHit,
          };
      }
    }
    return null;
  };

  const selectionCenter = () => {
    if (!selection) return null;
    const mesh = getMeshes(object)[selection.mesh];
    if (!mesh) return null;
    const bounds = uvBounds(mesh.geometry, selectedVertices(mesh.geometry, selection));
    if (!bounds) return null;
    return {
      u: (bounds.minU + bounds.maxU) / 2,
      v: (bounds.minV + bounds.maxV) / 2,
      left: bounds.minU,
      right: bounds.maxU,
      top: bounds.maxV,
      bottom: bounds.minV,
    };
  };

  const isGizmoHit = (point: LocalPoint, center: ReturnType<typeof selectionCenter>) => {
    if (!center || transformMode === "Select") return false;
    const dx = (point.u - center.u) * point.unitCss;
    const dy = (point.v - center.v) * point.unitCss;
    const distance = Math.hypot(dx, dy);
    if (transformMode === "Move") return distance < 19;
    if (transformMode === "Rotate") return Math.abs(distance - 25) < 10;
    const corners: Array<[number, number]> = [
      [center.left, center.top],
      [center.right, center.top],
      [center.left, center.bottom],
      [center.right, center.bottom],
    ];
    return corners.some(
      ([u, v]) => Math.hypot((point.u - u) * point.unitCss, (point.v - v) * point.unitCss) < 12,
    );
  };

  const applyPointerTransform = (gesture: TransformGesture, point: LocalPoint) => {
    if (!selection) return;
    const mesh = getMeshes(object)[selection.mesh];
    const uv = mesh?.geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (!uv) return;
    const deltaU = point.u - gesture.start.u;
    const deltaV = point.v - gesture.start.v;
    const startRadius = Math.hypot(
      gesture.start.u - gesture.centerU,
      gesture.start.v - gesture.centerV,
    );
    const currentRadius = Math.hypot(point.u - gesture.centerU, point.v - gesture.centerV);
    const angle =
      Math.atan2(point.v - gesture.centerV, point.u - gesture.centerU) -
      Math.atan2(gesture.start.v - gesture.centerV, gesture.start.u - gesture.centerU);
    const uniformScale = startRadius > 1e-5 ? currentRadius / startRadius : 1;
    for (const [vertex, [originU, originV]] of gesture.vertices) {
      let u = originU;
      let v = originV;
      if (gesture.mode === "Move") {
        u += transformAxis === "y" ? 0 : deltaU;
        v += transformAxis === "x" ? 0 : deltaV;
      } else if (gesture.mode === "Rotate") {
        const radians = angle;
        const x = originU - gesture.centerU;
        const y = originV - gesture.centerV;
        u = gesture.centerU + x * Math.cos(radians) - y * Math.sin(radians);
        v = gesture.centerV + x * Math.sin(radians) + y * Math.cos(radians);
      } else {
        const scaleX =
          transformAxis === "x"
            ? Math.abs(gesture.start.u - gesture.centerU) > 1e-5
              ? (point.u - gesture.centerU) / (gesture.start.u - gesture.centerU)
              : 1
            : transformAxis === "free"
              ? uniformScale
              : 1;
        const scaleY =
          transformAxis === "y"
            ? Math.abs(gesture.start.v - gesture.centerV) > 1e-5
              ? (point.v - gesture.centerV) / (gesture.start.v - gesture.centerV)
              : 1
            : transformAxis === "free"
              ? uniformScale
              : 1;
        u = gesture.centerU + (originU - gesture.centerU) * scaleX;
        v = gesture.centerV + (originV - gesture.centerV) * scaleY;
      }
      uv.setXY(vertex, u, v);
    }
    uv.needsUpdate = true;
    gesture.changed = true;
    drawRef.current();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current += 1;
    if (locked || activePointersRef.current > 1) {
      gestureRef.current = null;
      setMarquee(null);
      return;
    }
    const point = eventPoint(event);
    if (!point) return;
    const center = selectionCenter();
    if (selection && transformMode !== "Select" && isGizmoHit(point, center)) {
      const mesh = getMeshes(object)[selection.mesh];
      const uv = mesh?.geometry.getAttribute("uv");
      const ids = mesh ? selectedVertices(mesh.geometry, selection) : [];
      const vertices = new Map<number, [number, number]>();
      ids.forEach((vertex) => {
        if (uv) vertices.set(vertex, [uv.getX(vertex), uv.getY(vertex)]);
      });
      if (center && vertices.size) {
        props.onTransformStart();
        gestureRef.current = {
          pointerId: event.pointerId,
          kind: "transform",
          startClientX: event.clientX,
          startClientY: event.clientY,
          start: point,
          transform: {
            mode: transformMode,
            start: point,
            centerU: center.u,
            centerV: center.v,
            vertices,
            changed: false,
          },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      kind: "candidate",
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: point,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || activePointersRef.current > 1) return;
    const point = eventPoint(event);
    if (!point) return;
    const delta = Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY,
    );
    if (gesture.kind === "transform") {
      if (delta > 2 && gesture.transform) applyPointerTransform(gesture.transform, point);
      return;
    }
    if (gesture.kind === "candidate" && transformMode === "Select" && delta > 5)
      gesture.kind = "marquee";
    if (gesture.kind === "marquee") {
      const hostRect = hostRef.current?.getBoundingClientRect();
      if (!hostRect) return;
      setMarquee({
        left: Math.min(gesture.startClientX, event.clientX) - hostRect.left,
        top: Math.min(gesture.startClientY, event.clientY) - hostRect.top,
        right: Math.max(gesture.startClientX, event.clientX) - hostRect.left,
        bottom: Math.max(gesture.startClientY, event.clientY) - hostRect.top,
      });
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) => {
    activePointersRef.current = Math.max(0, activePointersRef.current - 1);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const point = eventPoint(event) ?? gesture.start;
    if (gesture.kind === "transform" && gesture.transform?.changed)
      props.onTransformFinish(`${gesture.transform.mode} applied`);
    if (!cancelled && gesture.kind === "marquee") {
      const rect = {
        left: Math.min(gesture.start.u, point.u),
        right: Math.max(gesture.start.u, point.u),
        bottom: Math.min(gesture.start.v, point.v),
        top: Math.max(gesture.start.v, point.v),
      };
      const found = pickRectangle(rect);
      if (found) props.onSelect(found.mesh, found.hit, elementType, selectionMode);
      else if (selectionMode === "Select") props.onClearSelection();
    } else if (!cancelled && gesture.kind === "candidate") {
      const found = pickAt(point);
      if (found) props.onSelect(found.mesh, found.hit, elementType, selectionMode);
      else if (selectionMode === "Select") props.onClearSelection();
    }
    setMarquee(null);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const oldZoom = props.uvView.zoom;
    const zoom = Math.max(0.3, Math.min(8, oldZoom * Math.exp(-event.deltaY * 0.001)));
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;
    const ratio = zoom / oldZoom;
    props.setUvView((current) => ({
      zoom,
      panX: anchorX * (1 - ratio) + current.panX * ratio,
      panY: anchorY * (1 - ratio) + current.panY * ratio,
    }));
  };

  return (
    <div
      className={`uv-workspace is-${transformMode.toLowerCase()} ${locked ? "is-locked" : ""}`}
      ref={hostRef}
      onTouchStart={props.onTouchStart}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      onWheel={onWheel}
    >
      <canvas
        ref={canvasRef}
        className="uv-workspace-canvas"
        aria-label="UV layout workspace. Tap to select; drag to marquee; use two fingers to pan and zoom."
        width={1}
        height={1}
        style={{
          transform: `translate(${uvView.panX}px, ${uvView.panY}px) scale(${uvView.zoom})`,
          transformOrigin: "center center",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
      />
      {marquee && (
        <div
          className="uv-marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
          aria-hidden="true"
        />
      )}
      <div className="uv-workspace-status">
        <span>
          UV 0–1 · {transformMode}
          {uvView.zoom !== 1 ? ` · ${uvView.zoom.toFixed(1)}×` : ""}
        </span>
        <span>{props.status}</span>
      </div>
    </div>
  );
}
