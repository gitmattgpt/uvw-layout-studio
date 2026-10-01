import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Box, BoxSelect, Download, Eye, Focus, Grid2X2, Image as ImageIcon, Layers3,
  Lock, Map, MousePointer2, RotateCcw, Scissors, Shapes, Upload, X,
} from "lucide-react";
import * as THREE from "three";
import JSZip from "jszip";
import { Viewport3D } from "./Viewport3D";
import {
  applyTexture, createCheckerTexture, downloadBlob, exportGlb, exportObj,
  getFirstGeometry, getStats, loadModel, normalizeModel, planarUnwrap,
  primitiveGeometry, type PrimitiveName,
} from "../../lib/uvw";

type Tab = "import" | "view" | "uvw" | "export";
type MaterialMode = "gltf" | "obj";
const primitives: PrimitiveName[] = ["Box", "Sphere", "Cylinder", "Torus", "Knot", "Plane"];
const gltfSlots = [
  ["Base Color", "RGB + Alpha"], ["Metallic–Roughness", "B = Metallic, G = Roughness"],
  ["Normal Map", "Tangent space"], ["Occlusion", "Ambient Occlusion"], ["Emissive", "RGB"],
  ["Clearcoat", "KHR_materials_clearcoat"], ["Clearcoat Roughness", "KHR_materials_clearcoat"],
  ["Clearcoat Normal", "KHR_materials_clearcoat"], ["Sheen Color", "KHR_materials_sheen"],
  ["Sheen Roughness", "KHR_materials_sheen"], ["Transmission", "KHR_materials_transmission"],
  ["Volume Thickness", "KHR_materials_volume"], ["Specular Color", "KHR_materials_specular"],
  ["Specular Factor", "KHR_materials_specular"], ["Iridescence", "KHR_materials_iridescence"],
  ["Iridescence Thickness", "KHR_materials_iridescence"], ["Anisotropy", "KHR_materials_anisotropy"],
];
const objSlots = [
  ["Diffuse Color", "map_Kd"], ["Specular Color", "map_Ks"], ["Ambient Color", "map_Ka"],
  ["Specular Highlight / Glossiness", "map_Ns"], ["Alpha / Opacity", "map_d"],
  ["Bump / Normal", "map_bump / bump"], ["Displacement", "disp"], ["Reflection", "refl"],
];

function makePrimitive(name: PrimitiveName) {
  const group = new THREE.Group();
  const geometry = primitiveGeometry(name);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  applyTexture(group, createCheckerTexture());
  return group;
}

function ToolButton({ label, active, children, onClick }: { label: string; active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" className={`tool-button ${active ? "is-active" : ""}`} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function UVCanvas({ geometry, textureUrl, canvasRef }: { geometry: THREE.BufferGeometry | null; textureUrl: string | null; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = (image?: HTMLImageElement) => {
      const size = canvas.width;
      ctx.clearRect(0, 0, size, size);
      if (image) ctx.drawImage(image, 0, 0, size, size);
      else {
        const cells = 8; const unit = size / cells;
        for (let y = 0; y < cells; y += 1) for (let x = 0; x < cells; x += 1) {
          ctx.fillStyle = (x + y) % 2 ? "#1b1e22" : "#0d0f12";
          ctx.fillRect(x * unit, y * unit, unit, unit);
        }
      }
      const uv = geometry?.getAttribute("uv");
      const position = geometry?.getAttribute("position");
      if (!uv || !position) return;
      ctx.strokeStyle = "#12c6d2"; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.94;
      const index = geometry?.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        ctx.beginPath();
        for (let j = 0; j < 3; j += 1) {
          const vertex = index ? index.getX(i + j) : i + j;
          const x = uv.getX(vertex) * size; const y = (1 - uv.getY(vertex)) * size;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    if (!textureUrl) { draw(); return; }
    const image = new Image(); image.onload = () => draw(image); image.src = textureUrl;
  }, [geometry, textureUrl, canvasRef]);
  return <canvas ref={canvasRef} width={1024} height={1024} className="uv-canvas" aria-label="Current UV layout" />;
}

export function UVWEditor() {
  const [tab, setTab] = useState<Tab>("import");
  const [primitive, setPrimitive] = useState<PrimitiveName>("Box");
  const [object, setObject] = useState<THREE.Group>(() => makePrimitive("Box"));
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [textureUrl, setTextureUrl] = useState<string | null>(null);
  const [textureFile, setTextureFile] = useState<File | null>(null);
  const [modelName, setModelName] = useState("Box");
  const [notice, setNotice] = useState("Ready");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialMode, setMaterialMode] = useState<MaterialMode>("gltf");
  const [wireframe, setWireframe] = useState(false);
  const modelInput = useRef<HTMLInputElement>(null);
  const textureInput = useRef<HTMLInputElement>(null);
  const slotInput = useRef<HTMLInputElement>(null);
  const uvCanvasRef = useRef<HTMLCanvasElement>(null);
  const stats = useMemo(() => getStats(object), [object]);
  const geometry = useMemo(() => getFirstGeometry(object), [object]);

  useEffect(() => () => { if (textureUrl) URL.revokeObjectURL(textureUrl); }, [textureUrl]);

  const selectPrimitive = (name: PrimitiveName) => {
    const next = makePrimitive(name);
    if (texture) applyTexture(next, texture, wireframe);
    setPrimitive(name); setModelName(name); setObject(next); setNotice(`${name} created`); setTab("view");
  };
  const onModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setNotice(`Reading ${file.name}…`);
    try {
      const next = normalizeModel(await loadModel(file));
      applyTexture(next, texture, wireframe);
      setObject(next); setModelName(file.name.replace(/\.[^.]+$/, "")); setNotice(`${file.name} imported`); setTab("view");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import model"); }
    event.target.value = "";
  };
  const onTexture = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (textureUrl) URL.revokeObjectURL(textureUrl);
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (next) => {
      next.colorSpace = THREE.SRGBColorSpace; next.flipY = false;
      setTexture(next); setTextureUrl(url); setTextureFile(file); applyTexture(object, next, wireframe);
      setObject(object.clone()); setNotice(`${file.name} applied`); setTab("view");
    }, undefined, () => { URL.revokeObjectURL(url); setNotice("Could not read that texture"); });
    event.target.value = "";
  };
  const unwrap = () => {
    object.traverse((item) => { if (item instanceof THREE.Mesh) planarUnwrap(item.geometry); });
    setObject(object.clone()); setNotice("Planar UV map generated"); setTab("uvw");
  };
  const toggleWireframe = () => {
    const next = !wireframe; setWireframe(next); applyTexture(object, texture, next); setObject(object.clone());
  };
  const downloadUv = () => uvCanvasRef.current?.toBlob((blob) => { if (blob) downloadBlob(blob, "uvw-layout.png"); }, "image/png");
  const downloadObjZip = async () => {
    const zip = new JSZip();
    const source = new (await import("three/examples/jsm/exporters/OBJExporter.js")).OBJExporter().parse(object);
    zip.file("uvw-model.obj", source);
    zip.file("uvw-model.mtl", "newmtl uvw_material\nKd 1.0 1.0 1.0\nmap_Kd texture.png\n");
    if (textureFile) zip.file(`texture.${textureFile.name.split(".").pop() ?? "png"}`, textureFile);
    downloadBlob(await zip.generateAsync({ type: "blob" }), "uvw-model.zip");
  };

  const tabs = [
    ["import", Upload, "Import"], ["view", Box, "3D View"], ["uvw", Grid2X2, "UVW"], ["export", Download, "Export"],
  ] as const;
  return (
    <main className="editor-shell">
      <header className="editor-header">
        <div className="brand-mark"><span>U</span><span>V</span><span>W</span></div>
        <div className="file-status"><strong>{modelName}</strong><span>{notice}</span></div>
        <button className="close-button" type="button" aria-label="Clear workspace" title="Clear workspace" onClick={() => selectPrimitive("Box")}><X /></button>
      </header>
      <nav className="tab-bar" aria-label="Editor sections">
        {tabs.map(([id, Icon, label]) => <button type="button" key={id} className={`tab-button ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}
      </nav>
      {(tab === "view" || tab === "uvw") && <div className="tool-strip">
        <ToolButton label="Lock selection"><Lock /></ToolButton><ToolButton label="Show model"><Eye /></ToolButton>
        <ToolButton label="Toggle wireframe" active={wireframe} onClick={toggleWireframe}><BoxSelect /></ToolButton>
        <ToolButton label="Select"><MousePointer2 /></ToolButton><ToolButton label="Generate planar UV" active onClick={unwrap}><Map /></ToolButton>
        <ToolButton label="Focus view"><Focus /></ToolButton><ToolButton label="UV islands"><Grid2X2 /></ToolButton>
        <ToolButton label="Cut seams"><Scissors /></ToolButton><ToolButton label="Reset view"><RotateCcw /></ToolButton>
      </div>}

      <section className={`workspace workspace-${tab}`}>
        {tab === "import" && <div className="import-panel">
          <div className="intro"><span className="eyebrow">01 / SOURCE</span><h1>UVW Mapping Tool</h1><p>Import a model or start from a primitive</p></div>
          <button type="button" className="primary-action" onClick={() => modelInput.current?.click()}><Upload />Import Model <small>OBJ · GLB · GLTF</small></button>
          <div className="secondary-actions">
            <button type="button" onClick={() => textureInput.current?.click()}><ImageIcon />Import Texture</button>
            <button type="button" onClick={() => setMaterialsOpen(true)}><Layers3 />Materials</button>
          </div>
          <div className="primitive-panel"><div className="section-label"><Shapes />Primitives</div><div className="primitive-grid">{primitives.map((name) => <button type="button" key={name} className={primitive === name ? "is-selected" : ""} onClick={() => selectPrimitive(name)}>{name}</button>)}</div></div>
          <p className="stats">Current: {modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p>
        </div>}
        {tab === "view" && <div className="viewport-wrap"><Viewport3D object={object} /><span className="view-label">PERSP</span><div className="viewport-info"><span>{modelName}</span><strong>{stats.faces.toLocaleString()} tris</strong></div></div>}
        {tab === "uvw" && <div className="uv-stage"><div className="uv-frame"><UVCanvas geometry={geometry} textureUrl={textureUrl} canvasRef={uvCanvasRef} /></div><div className="uv-footer"><span>UV SPACE 0—1</span><button type="button" onClick={unwrap}><Map />Planar unwrap</button></div></div>}
        {tab === "export" && <div className="export-panel"><span className="eyebrow">04 / OUTPUT</span><h1>Export</h1><p>{textureFile ? `${textureFile.name} will be included where supported.` : "No texture imported — exports will use the checker grid."}</p>
          <div className="export-list">
            <button type="button" onClick={() => void exportGlb(object)}><Box /><span><strong>GLB</strong><small>Mesh + UVs + texture</small></span><Download /></button>
            <button type="button" onClick={() => void downloadObjZip()}><Box /><span><strong>OBJ + MTL</strong><small>Packaged as .zip</small></span><Download /></button>
            <button type="button" onClick={downloadUv}><ImageIcon /><span><strong>UV Layout PNG</strong><small>1024 × 1024 wireframe</small></span><Download /></button>
          </div><p className="stats">{modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p>
          <div className="hidden-canvas"><UVCanvas geometry={geometry} textureUrl={textureUrl} canvasRef={uvCanvasRef} /></div>
        </div>}
      </section>
      <input ref={modelInput} className="sr-only" type="file" accept=".obj,.glb,.gltf,model/gltf-binary" onChange={(event) => void onModel(event)} />
      <input ref={textureInput} className="sr-only" type="file" accept="image/*" onChange={onTexture} />
      <input ref={slotInput} className="sr-only" type="file" accept="image/*" onChange={onTexture} />
      {materialsOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) setMaterialsOpen(false); }}><section className="materials-modal" role="dialog" aria-modal="true" aria-labelledby="materials-title">
        <header><div><h2 id="materials-title"><Layers3 />Materials</h2><p>Assign textures to material slots and choose which slot drives the active UVW texture.</p></div><button type="button" onClick={() => setMaterialsOpen(false)} aria-label="Close materials"><X /></button></header>
        <div className="mode-switch"><button type="button" className={materialMode === "gltf" ? "is-active" : ""} onClick={() => setMaterialMode("gltf")}>GLB / glTF (PBR)</button><button type="button" className={materialMode === "obj" ? "is-active" : ""} onClick={() => setMaterialMode("obj")}>OBJ / MTL</button></div>
        <div className="slot-list">{(materialMode === "gltf" ? gltfSlots : objSlots).map(([label, detail], index) => <div className="slot-row" key={label}><button className={`slot-select ${index === 0 && texture ? "is-active" : ""}`} type="button" aria-label={`Use ${label} for UV preview`} /><div><strong>{label}</strong><span>{detail}</span></div><button className="slot-upload" type="button" onClick={() => slotInput.current?.click()} aria-label={`Upload ${label}`}><Upload /></button></div>)}</div>
        <footer>Active UVW texture: {textureFile?.name ?? "none"}</footer>
      </section></div>}
    </main>
  );
}
