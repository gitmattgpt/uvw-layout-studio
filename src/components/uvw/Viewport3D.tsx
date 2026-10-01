import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

function Model({ object }: { object: THREE.Object3D }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(4.8, 3.8, 5.8);
    camera.lookAt(0, 0, 0);
  }, [camera, object]);
  return <primitive object={object} />;
}

export function Viewport3D({ object }: { object: THREE.Object3D }) {
  return (
    <div className="h-full min-h-0 w-full">
      <Canvas dpr={[1, 1.5]} camera={{ position: [4.8, 3.8, 5.8], fov: 42 }} gl={{ antialias: true }}>
        <color attach="background" args={["#101216"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 6]} intensity={2.2} />
        <Environment>
          <Lightformer intensity={1.7} position={[0, 5, 1]} scale={[10, 10, 1]} />
          <Lightformer intensity={1} color="#aeb9a4" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
        </Environment>
        <Grid args={[30, 30]} position={[0, -1.8, 0]} cellSize={1} cellThickness={0.5} cellColor="#30343a" sectionSize={5} sectionColor="#42474f" fadeDistance={22} infiniteGrid />
        <Model object={object} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={12} />
      </Canvas>
    </div>
  );
}
