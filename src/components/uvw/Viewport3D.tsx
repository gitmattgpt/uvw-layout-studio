import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  faceCount,
  faceVertex,
  getMeshes,
  islandFaces,
  selectionOverlay,
  type ElementType,
  type Selection,
  type SelectionHit,
  type SelectionMode,
} from "@/lib/selection";

export type ViewName = "persp" | "ortho" | "front" | "back" | "left" | "right" | "top" | "bottom";

export type CameraState = {
  view: ViewName;
  focusNonce: number;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
};

type SelectionRectangle = { x: number; y: number; width: number; height: number };
type ScreenPoint = { x: number; y: number; z: number };
type SelectionTarget = { mesh: THREE.Mesh; hit: SelectionHit };
type SelectionCallback = (
  mesh: THREE.Mesh,
  hit: SelectionHit,
  element: ElementType,
  mode: SelectionMode,
) => void;

const LONG_PRESS_DELAY_MS = 450;
const ORBIT_DRAG_THRESHOLD_PX = 7;
const MARQUEE_DRAG_THRESHOLD_PX = 5;

function CameraRig({
  view,
  focusNonce,
  locked,
  savedCamera,
  onCameraSave,
}: {
  view: ViewName;
  focusNonce: number;
  locked: boolean;
  savedCamera: CameraState | null;
  onCameraSave: (state: CameraState) => void;
}) {
  const { camera, controls } = useThree();
  const latestSavedCamera = useRef(savedCamera);
  latestSavedCamera.current = savedCamera;
  useEffect(() => {
    const saved = latestSavedCamera.current;
    const canRestore = saved && saved.view === view && saved.focusNonce === focusNonce;
    if (canRestore) {
      camera.position.set(...saved.position);
      camera.zoom = saved.zoom;
      camera.updateProjectionMatrix();
      if (controls && "target" in controls) {
        const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
        orbit.target.set(...saved.target);
        orbit.update();
      }
      return;
    }
    const positions: Record<ViewName, [number, number, number]> = {
      persp: [4.8, 3.8, 5.8],
      ortho: [4.8, 3.8, 5.8],
      front: [0, 0, 6],
      back: [0, 0, -6],
      left: [-6, 0, 0],
      right: [6, 0, 0],
      top: [0, 6, 0.01],
      bottom: [0, -6, 0.01],
    };
    camera.position.set(...positions[view]);
    camera.lookAt(0, 0, 0);
    camera.zoom = view === "ortho" ? 1.25 : 1;
    camera.updateProjectionMatrix();
    if (controls && "target" in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
      orbit.target.set(0, 0, 0);
      orbit.update();
    }
  }, [camera, controls, view, focusNonce]);
  useEffect(
    () => () => {
      if (!controls || !("target" in controls)) return;
      const orbit = controls as unknown as { target: THREE.Vector3 };
      onCameraSave({
        view,
        focusNonce,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [orbit.target.x, orbit.target.y, orbit.target.z],
        zoom: camera.zoom,
      });
    },
    [controls, camera, view, focusNonce, onCameraSave],
  );
  return (
    <OrbitControls
      makeDefault
      enabled={!locked}
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={12}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}

function SelectionHighlight({
  object,
  selection,
}: {
  object: THREE.Object3D;
  selection: Selection;
}) {
  const geometry = useMemo(() => selectionOverlay(object, selection), [object, selection]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry || !selection) return null;
  const color = "#f26b2a";
  if (selection.element === "Vertex")
    return (
      <points geometry={geometry} raycast={() => null}>
        <pointsMaterial color={color} size={9} sizeAttenuation={false} depthTest={false} />
      </points>
    );
  if (selection.element === "Segment")
    return (
      <lineSegments geometry={geometry} raycast={() => null} renderOrder={3}>
        <lineBasicMaterial color={color} linewidth={2} depthTest={false} />
      </lineSegments>
    );
  return (
    <group>
      <mesh geometry={geometry} raycast={() => null} renderOrder={2}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
          depthTest={false}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>
      <mesh geometry={geometry} raycast={() => null} renderOrder={3}>
        <meshBasicMaterial color={color} wireframe depthTest={false} />
      </mesh>
    </group>
  );
}

function isVisible(mesh: THREE.Mesh) {
  for (let current: THREE.Object3D | null = mesh; current; current = current.parent)
    if (!current.visible) return false;
  return true;
}

function projectVertex(
  mesh: THREE.Mesh,
  vertex: number,
  camera: THREE.Camera,
  rect: DOMRect,
): ScreenPoint {
  const position = mesh.geometry.getAttribute("position");
  const point = new THREE.Vector3()
    .fromBufferAttribute(position, vertex)
    .applyMatrix4(mesh.matrixWorld)
    .project(camera);
  return {
    x: rect.left + ((point.x + 1) * rect.width) / 2,
    y: rect.top + ((1 - point.y) * rect.height) / 2,
    z: point.z,
  };
}

function pointInRect(
  point: ScreenPoint,
  rect: { left: number; top: number; right: number; bottom: number },
) {
  return (
    point.z >= -1 &&
    point.z <= 1 &&
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function pointSegmentDistance(point: { x: number; y: number }, a: ScreenPoint, b: ScreenPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared
    ? THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1)
    : 0;
  return Math.hypot(point.x - (a.x + amount * dx), point.y - (a.y + amount * dy));
}

function pointInTriangle(
  point: { x: number; y: number },
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
) {
  const sign = (p1: { x: number; y: number }, p2: ScreenPoint, p3: ScreenPoint) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  const orient = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) =>
    Math.abs(orient(p, q, r)) < 1e-7 &&
    r.x >= Math.min(p.x, q.x) - 1e-7 &&
    r.x <= Math.max(p.x, q.x) + 1e-7 &&
    r.y >= Math.min(p.y, q.y) - 1e-7 &&
    r.y <= Math.max(p.y, q.y) + 1e-7;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)))
    return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function segmentIntersectsRect(
  a: ScreenPoint,
  b: ScreenPoint,
  rect: { left: number; top: number; right: number; bottom: number },
) {
  if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) return false;
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  return corners.some((corner, index) =>
    segmentsIntersect(a, b, corner, corners[(index + 1) % corners.length]!),
  );
}

function triangleIntersectsRect(
  points: [ScreenPoint, ScreenPoint, ScreenPoint],
  rect: { left: number; top: number; right: number; bottom: number },
) {
  if (points.some((point) => pointInRect(point, rect))) return true;
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (corners.some((corner) => pointInTriangle(corner, points[0], points[1], points[2])))
    return true;
  return points.some((point, index) =>
    segmentIntersectsRect(point, points[(index + 1) % 3]!, rect),
  );
}

function makeRectangleHit(
  mesh: THREE.Mesh,
  projected: ScreenPoint[],
  rect: { left: number; top: number; right: number; bottom: number },
  element: ElementType,
): SelectionHit {
  const geometry = mesh.geometry;
  if (element === "Vertex") {
    const vertices: number[] = [];
    for (let vertex = 0; vertex < projected.length; vertex += 1)
      if (pointInRect(projected[vertex]!, rect)) vertices.push(vertex);
    return { vertices };
  }
  if (element === "Segment") {
    const edges = new Map<string, [number, number]>();
    for (let face = 0; face < faceCount(geometry); face += 1) {
      const ids = [0, 1, 2].map((corner) => faceVertex(geometry, face, corner));
      for (let edge = 0; edge < 3; edge += 1) {
        const a = ids[edge]!;
        const b = ids[(edge + 1) % 3]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (edges.has(key) || !segmentIntersectsRect(projected[a]!, projected[b]!, rect)) continue;
        edges.set(key, a < b ? [a, b] : [b, a]);
      }
    }
    return { edges: [...edges.values()] };
  }
  const faces: number[] = [];
  for (let face = 0; face < faceCount(geometry); face += 1) {
    const points = [0, 1, 2].map((corner) => projected[faceVertex(geometry, face, corner)]!) as [
      ScreenPoint,
      ScreenPoint,
      ScreenPoint,
    ];
    if (triangleIntersectsRect(points, rect)) faces.push(face);
  }
  return {
    faces:
      element === "Island"
        ? [...new Set(faces.flatMap((face) => islandFaces(geometry, face)))]
        : faces,
  };
}

function hitCount(hit: SelectionHit) {
  return hit.vertices?.length ?? hit.edges?.length ?? hit.faces?.length ?? 0;
}

function pickRectangle(
  object: THREE.Object3D,
  camera: THREE.Camera,
  canvasRect: DOMRect,
  selection: Selection,
  element: ElementType,
  rectangle: { left: number; top: number; right: number; bottom: number },
): SelectionTarget | null {
  object.updateMatrixWorld(true);
  const candidates: SelectionTarget[] = [];
  for (const mesh of getMeshes(object)) {
    if (!isVisible(mesh)) continue;
    const position = mesh.geometry.getAttribute("position");
    const projected = Array.from({ length: position.count }, (_, vertex) =>
      projectVertex(mesh, vertex, camera, canvasRect),
    );
    const hit = makeRectangleHit(mesh, projected, rectangle, element);
    if (hitCount(hit)) candidates.push({ mesh, hit });
  }
  if (!candidates.length) return null;
  const meshes = getMeshes(object);
  const selectedMesh = selection ? meshes[selection.mesh] : null;
  return (
    candidates.find((candidate) => candidate.mesh === selectedMesh) ??
    candidates.sort((a, b) => hitCount(b.hit) - hitCount(a.hit))[0] ??
    null
  );
}

function pickClick(
  object: THREE.Object3D,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  canvasRect: DOMRect,
  clientX: number,
  clientY: number,
  element: ElementType,
): SelectionTarget | null {
  object.updateMatrixWorld(true);
  const meshes = getMeshes(object).filter(isVisible);
  const pointer = new THREE.Vector2(
    ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
    -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster
    .intersectObjects(meshes, false)
    .find((hit) => hit.object instanceof THREE.Mesh && hit.faceIndex != null);
  if (!intersection || intersection.faceIndex == null) return null;
  const mesh = intersection.object as THREE.Mesh;
  const face = intersection.faceIndex;
  if (element === "Polygon") return { mesh, hit: { faces: [face] } };
  if (element === "Island") return { mesh, hit: { faces: islandFaces(mesh.geometry, face) } };
  const ids = [0, 1, 2].map((corner) => faceVertex(mesh.geometry, face, corner));
  const projected = ids.map((vertex) => projectVertex(mesh, vertex, camera, canvasRect)) as [
    ScreenPoint,
    ScreenPoint,
    ScreenPoint,
  ];
  if (element === "Vertex") {
    const distances = projected.map((point) => Math.hypot(point.x - clientX, point.y - clientY));
    const nearest = distances.indexOf(Math.min(...distances));
    return distances[nearest]! <= 20 ? { mesh, hit: { vertices: [ids[nearest]!] } } : null;
  }
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 0],
  ];
  const distances = edges.map(([a, b]) =>
    pointSegmentDistance({ x: clientX, y: clientY }, projected[a]!, projected[b]!),
  );
  const nearest = distances.indexOf(Math.min(...distances));
  const [a, b] = edges[nearest]!;
  const edge: [number, number] = ids[a]! < ids[b]! ? [ids[a]!, ids[b]!] : [ids[b]!, ids[a]!];
  return distances[nearest]! <= 16 ? { mesh, hit: { edges: [edge] } } : null;
}

function SelectionInput({
  object,
  locked,
  selection,
  element,
  mode,
  onSelect,
  onClear,
  onRectangleChange,
}: {
  object: THREE.Object3D;
  locked: boolean;
  selection: Selection;
  element: ElementType;
  mode: SelectionMode;
  onSelect: SelectionCallback;
  onClear: () => void;
  onRectangleChange: (rectangle: SelectionRectangle | null) => void;
}) {
  const { camera, controls, gl, raycaster } = useThree();
  const latest = useRef({
    object,
    locked,
    selection,
    element,
    mode,
    onSelect,
    onClear,
    onRectangleChange,
  });
  latest.current = {
    object,
    locked,
    selection,
    element,
    mode,
    onSelect,
    onClear,
    onRectangleChange,
  };
  useEffect(() => {
    const canvas = gl.domElement;
    const orbit =
      controls && "enabled" in controls ? (controls as unknown as { enabled: boolean }) : null;
    let gesture: {
      pointerId: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      dragged: boolean;
      orbiting: boolean;
      longPressActivated: boolean;
      longPressTimer: number | null;
      previousControlsEnabled: boolean | null;
    } | null = null;
    const clearLongPressTimer = (current: NonNullable<typeof gesture>) => {
      if (current.longPressTimer !== null) {
        window.clearTimeout(current.longPressTimer);
        current.longPressTimer = null;
      }
    };
    const release = () => {
      const current = gesture;
      if (!current) return;
      clearLongPressTimer(current);
      if (orbit && current.longPressActivated && current.previousControlsEnabled !== null)
        orbit.enabled = current.previousControlsEnabled;
      gesture = null;
      latest.current.onRectangleChange(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const config = latest.current;
      if (config.locked || event.button !== 0 || !event.isPrimary) return;
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragged: false,
        orbiting: false,
        longPressActivated: false,
        longPressTimer: null,
        previousControlsEnabled: null,
      };
      const activeGesture = gesture;
      activeGesture.longPressTimer = window.setTimeout(() => {
        if (gesture !== activeGesture || activeGesture.orbiting) return;
        activeGesture.longPressActivated = true;
        if (orbit) {
          activeGesture.previousControlsEnabled = orbit.enabled;
          orbit.enabled = false;
        }
        const rect = canvas.getBoundingClientRect();
        latest.current.onRectangleChange({
          x: activeGesture.startX - rect.left,
          y: activeGesture.startY - rect.top,
          width: 0,
          height: 0,
        });
      }, LONG_PRESS_DELAY_MS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const activeGesture = gesture;
      const distance = Math.hypot(
        event.clientX - activeGesture.startX,
        event.clientY - activeGesture.startY,
      );
      if (!activeGesture.longPressActivated) {
        if (distance >= ORBIT_DRAG_THRESHOLD_PX) {
          activeGesture.orbiting = true;
          clearLongPressTimer(activeGesture);
        }
        return;
      }
      activeGesture.x = event.clientX;
      activeGesture.y = event.clientY;
      if (!activeGesture.dragged && distance >= MARQUEE_DRAG_THRESHOLD_PX)
        activeGesture.dragged = true;
      if (activeGesture.dragged) {
        const rect = canvas.getBoundingClientRect();
        latest.current.onRectangleChange({
          x: Math.min(activeGesture.startX, activeGesture.x) - rect.left,
          y: Math.min(activeGesture.startY, activeGesture.y) - rect.top,
          width: Math.abs(activeGesture.x - activeGesture.startX),
          height: Math.abs(activeGesture.y - activeGesture.startY),
        });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (gesture?.longPressActivated) event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const currentGesture = gesture;
      const config = latest.current;
      const rect = canvas.getBoundingClientRect();
      try {
        if (currentGesture.longPressActivated && currentGesture.dragged) {
          const bounds = {
            left: Math.min(currentGesture.startX, event.clientX),
            top: Math.min(currentGesture.startY, event.clientY),
            right: Math.max(currentGesture.startX, event.clientX),
            bottom: Math.max(currentGesture.startY, event.clientY),
          };
          const target = pickRectangle(
            config.object,
            camera,
            rect,
            config.selection,
            config.element,
            bounds,
          );
          if (target) config.onSelect(target.mesh, target.hit, config.element, config.mode);
          else if (config.mode === "Select") config.onClear();
        } else if (!currentGesture.orbiting) {
          const target = pickClick(
            config.object,
            camera,
            raycaster,
            rect,
            event.clientX,
            event.clientY,
            config.element,
          );
          if (target) config.onSelect(target.mesh, target.hit, config.element, config.mode);
          else if (config.mode === "Select") config.onClear();
        }
      } finally {
        release();
      }
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      release();
    };
    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove, true);
    canvas.addEventListener("pointerup", onPointerUp, true);
    canvas.addEventListener("pointercancel", onPointerCancel, true);
    canvas.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("pointermove", onPointerMove, true);
      canvas.removeEventListener("pointerup", onPointerUp, true);
      canvas.removeEventListener("pointercancel", onPointerCancel, true);
      canvas.removeEventListener("contextmenu", onContextMenu, true);
      release();
    };
  }, [camera, controls, gl, raycaster]);
  return null;
}

export function Viewport3D({
  object,
  locked,
  view,
  focusNonce,
  selection,
  elementType,
  selectionMode,
  onSelect,
  onClearSelection,
  savedCamera,
  onCameraSave,
}: {
  object: THREE.Object3D;
  locked: boolean;
  view: ViewName;
  focusNonce: number;
  selection: Selection;
  elementType: ElementType;
  selectionMode: SelectionMode;
  onSelect: SelectionCallback;
  onClearSelection: () => void;
  savedCamera: CameraState | null;
  onCameraSave: (state: CameraState) => void;
}) {
  const [selectionRectangle, setSelectionRectangle] = useState<SelectionRectangle | null>(null);
  return (
    <div
      className={`selection-viewport h-full min-h-0 w-full${selectionRectangle ? " is-box-selecting" : ""}`}
    >
      <Canvas
        dpr={[1, 1.5]}
        orthographic={view === "ortho"}
        camera={
          view === "ortho"
            ? { position: [4.8, 3.8, 5.8], zoom: 125 }
            : { position: [4.8, 3.8, 5.8], fov: 42 }
        }
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#101216"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 6]} intensity={2.2} />
        <Environment>
          <Lightformer intensity={1.7} position={[0, 5, 1]} scale={[10, 10, 1]} />
          <Lightformer
            intensity={1}
            color="#aeb9a4"
            position={[-5, 1, -1]}
            rotation-y={Math.PI / 2}
            scale={[10, 2, 1]}
          />
        </Environment>
        <Grid
          args={[30, 30]}
          position={[0, -1.8, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#30343a"
          sectionSize={5}
          sectionColor="#42474f"
          fadeDistance={22}
          infiniteGrid
        />
        <primitive object={object} />
        <SelectionHighlight object={object} selection={selection} />
        <SelectionInput
          object={object}
          locked={locked}
          selection={selection}
          element={elementType}
          mode={selectionMode}
          onSelect={onSelect}
          onClear={onClearSelection}
          onRectangleChange={setSelectionRectangle}
        />
        <CameraRig
          view={view}
          focusNonce={focusNonce}
          locked={locked}
          savedCamera={savedCamera}
          onCameraSave={onCameraSave}
        />
      </Canvas>
      {selectionRectangle && (
        <div
          className={`selection-rectangle${selectionRectangle.width === 0 && selectionRectangle.height === 0 ? " is-armed" : ""}`}
          aria-hidden="true"
          style={{
            left: selectionRectangle.x,
            top: selectionRectangle.y,
            width: selectionRectangle.width,
            height: selectionRectangle.height,
          }}
        />
      )}
    </div>
  );
}
