import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type ViewName = "persp" | "ortho" | "front" | "back" | "left" | "right" | "top" | "bottom";

function CameraRig({ view, focusNonce, locked }: { view: ViewName; focusNonce: number; locked: boolean }) {
  const { camera, controls } = useThree();
  useEffect(() => {
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
  }, [camera, controls, view, focusNonce]);
  return <OrbitControls makeDefault enabled={!locked} enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={12} />;
}

function Model({ object, locked, onPick }: { object: THREE.Object3D; locked: boolean; onPick: (mesh: THREE.Mesh) => void }) {
  const picked = useRef<THREE.Mesh | null>(null);
  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    if (locked || !(event.object instanceof THREE.Mesh)) return;
    event.stopPropagation(); picked.current = event.object; onPick(event.object);
  };
  return <primitive object={object} onPointerDown={handlePointer} />;
}

export function Viewport3D({ object, locked, view, focusNonce, onPick }: { object: THREE.Object3D; locked: boolean; view: ViewName; focusNonce: number; onPick: (mesh: THREE.Mesh) => void }) {
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
        <Model object={object} locked={locked} onPick={onPick} />
        <CameraRig view={view} focusNonce={focusNonce} locked={locked} />
      </Canvas>
    </div>
  );
}
