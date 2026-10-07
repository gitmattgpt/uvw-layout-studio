import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { selectionOverlay, type Selection } from "@/lib/selection";

export type ViewName = "persp" | "ortho" | "front" | "back" | "left" | "right" | "top" | "bottom";

export type CameraState = {
  view: ViewName;
  focusNonce: number;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
};

function CameraRig({ view, focusNonce, locked, savedCamera, onCameraSave }: { view: ViewName; focusNonce: number; locked: boolean; savedCamera: CameraState | null; onCameraSave: (state: CameraState) => void }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const canRestore = savedCamera && savedCamera.view === view && savedCamera.focusNonce === focusNonce;
    if (canRestore) {
      camera.position.set(...savedCamera.position);
      camera.zoom = savedCamera.zoom;
      camera.updateProjectionMatrix();
      if (controls && "target" in controls) {
        const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
        orbit.target.set(...savedCamera.target);
        orbit.update();
      }
      return;
    }
    const positions: Record<ViewName, [number, number, number]> = {
      persp: [4.8, 3.8, 5.8], ortho: [4.8, 3.8, 5.8], front: [0, 0, 6], back: [0, 0, -6],
      left: [-6, 0, 0], right: [6, 0, 0], top: [0, 6, 0.01], bottom: [0, -6, 0.01],
    };
    camera.position.set(...positions[view]);
    camera.lookAt(0, 0, 0);
    camera.zoom = view === "ortho" ? 1.25 : 1;
    camera.updateProjectionMatrix();
    if (controls && "target" in controls) {
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void };
      orbit.target.set(0, 0, 0); orbit.update();
    }
  }, [camera, controls, view, focusNonce, savedCamera]);
  useEffect(() => () => {
    if (!controls || !("target" in controls)) return;
    const orbit = controls as unknown as { target: THREE.Vector3 };
    onCameraSave({
      view, focusNonce,
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [orbit.target.x, orbit.target.y, orbit.target.z],
      zoom: camera.zoom,
    });
  }, [controls, camera, view, focusNonce, onCameraSave]);
  return <OrbitControls makeDefault enabled={!locked} enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={12} />;
}

function SelectionHighlight({ object, selection }: { object: THREE.Object3D; selection: Selection }) {
  const geometry = useMemo(() => selectionOverlay(object, selection), [object, selection]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry || !selection) return null;
  const color = "#f26b2a";
  if (selection.element === "Vertex") return <points geometry={geometry} raycast={() => null}><pointsMaterial color={color} size={8} sizeAttenuation={false} depthTest={false} /></points>;
  return <group>
    {selection.element !== "Segment" && <mesh geometry={geometry} raycast={() => null} renderOrder={2}><meshBasicMaterial color={color} transparent opacity={0.45} side={THREE.DoubleSide} depthTest={false} polygonOffset polygonOffsetFactor={-1} /></mesh>}
    <mesh geometry={geometry} raycast={() => null} renderOrder={3}><meshBasicMaterial color={color} wireframe depthTest={false} /></mesh>
  </group>;
}

export function Viewport3D({ object, locked, view, focusNonce, selection, onPick, savedCamera, onCameraSave }: { object: THREE.Object3D; locked: boolean; view: ViewName; focusNonce: number; selection: Selection; onPick: (mesh: THREE.Mesh, face: number) => void; savedCamera: CameraState | null; onCameraSave: (state: CameraState) => void }) {
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (locked || !(event.object instanceof THREE.Mesh) || event.faceIndex == null || event.delta > 6) return;
    event.stopPropagation(); onPick(event.object, event.faceIndex);
  };
  return (
    <div className="h-full min-h-0 w-full">
      <Canvas dpr={[1, 1.5]} orthographic={view === "ortho"} camera={view === "ortho" ? { position: [4.8, 3.8, 5.8], zoom: 125 } : { position: [4.8, 3.8, 5.8], fov: 42 }} gl={{ antialias: true }}>
        <color attach="background" args={["#101216"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 6]} intensity={2.2} />
        <Environment>
          <Lightformer intensity={1.7} position={[0, 5, 1]} scale={[10, 10, 1]} />
          <Lightformer intensity={1} color="#aeb9a4" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
        </Environment>
        <Grid args={[30, 30]} position={[0, -1.8, 0]} cellSize={1} cellThickness={0.5} cellColor="#30343a" sectionSize={5} sectionColor="#42474f" fadeDistance={22} infiniteGrid />
        <primitive object={object} onClick={handleClick} />
        <SelectionHighlight object={object} selection={selection} />
        <CameraRig view={view} focusNonce={focusNonce} locked={locked} savedCamera={savedCamera} onCameraSave={onCameraSave} />
      </Canvas>
    </div>
  );
}
