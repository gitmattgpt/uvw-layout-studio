import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Box, BoxSelect, ChevronDown, Download, Eye, Focus, Grid2X2, Image as ImageIcon, Layers3,
  Lock, Map, MousePointer2, Move, Redo2, RotateCcw, Scissors, Shapes, Trash2, Undo2, Unlock, Upload, X, ZoomIn,
} from "lucide-react";
import * as THREE from "three";
import JSZip from "jszip";
import { Viewport3D, type ViewName } from "./Viewport3D";
import { faceVertex, getMeshes, updateSelection, type ElementType, type Selection } from "@/lib/selection";
import {
  applyTexture, boxUnwrap, createCheckerTexture, cylindricalUnwrap, downloadBlob, exportGlb,
  getFirstGeometry, getStats, loadModel, normalizeModel, planarUnwrap, primitiveGeometry,
  transformUvs, type PrimitiveName,
} from "../../lib/uvw";

type Tab = "import" | "view" | "uvw" | "export";
type MaterialMode = "gltf" | "obj";
type MappingMode = "Planar" | "Box" | "Cylindrical" | "Auto Unwrap" | "Original";
type UvBackground = "checker" | "grid" | "texture" | "colour";
type TransformMode = "Select" | "Move" | "Rotate" | "Scale";
type MaterialAsset = { file: File; url: string; texture: THREE.Texture };
type MenuItem = { label: string; disabled?: boolean; active?: boolean; action: () => void };
const primitives: PrimitiveName[] = ["Box", "Sphere", "Cylinder", "Torus", "Knot", "Plane"];
const gltfSlots: ReadonlyArray<readonly [string, string]> = [
  ["Base Color", "RGB + Alpha"], ["Metallic–Roughness", "B = Metallic, G = Roughness"], ["Normal Map", "Tangent space"],
  ["Occlusion", "Ambient Occlusion"], ["Emissive", "RGB"], ["Clearcoat", "KHR_materials_clearcoat"],
  ["Clearcoat Roughness", "KHR_materials_clearcoat"], ["Clearcoat Normal", "KHR_materials_clearcoat"],
  ["Sheen Color", "KHR_materials_sheen"], ["Sheen Roughness", "KHR_materials_sheen"],
  ["Transmission", "KHR_materials_transmission"], ["Volume Thickness", "KHR_materials_volume"],
  ["Specular Color", "KHR_materials_specular"], ["Specular Factor", "KHR_materials_specular"],
  ["Iridescence", "KHR_materials_iridescence"], ["Iridescence Thickness", "KHR_materials_iridescence"],
  ["Anisotropy", "KHR_materials_anisotropy"],
];
const objSlots: ReadonlyArray<readonly [string, string]> = [["Diffuse Color", "map_Kd"], ["Specular Color", "map_Ks"], ["Ambient Color", "map_Ka"], ["Specular Highlight / Glossiness", "map_Ns"], ["Alpha / Opacity", "map_d"], ["Bump / Normal", "map_bump / bump"], ["Displacement", "disp"], ["Reflection", "refl"]];

function makePrimitive(name: PrimitiveName) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(primitiveGeometry(name), new THREE.MeshStandardMaterial());
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); applyTexture(group, createCheckerTexture()); return group;
}

function ToolButton({ label, active, disabled, menu, children, onClick }: { label: string; active?: boolean; disabled?: boolean; menu?: MenuItem[]; quick?: () => void; children: ReactNode; onClick?: () => void }) {
  const [open, setOpen] = useState(false); const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, [open]);
  return <div className="tool-menu-wrap" ref={wrap}><button type="button" className={`tool-button ${active || open ? "is-active" : ""}`} title={label} aria-label={label} aria-expanded={menu ? open : undefined} disabled={disabled} onClick={() => { if (menu) setOpen((v) => !v); else onClick?.(); }}>{children}{menu && <ChevronDown className="menu-caret" />}</button>{open && menu && <div className="tool-popover" role="menu">{menu.map((item) => <button type="button" role="menuitem" key={item.label} className={item.active ? "is-active" : ""} disabled={item.disabled} onClick={() => { item.action(); setOpen(false); }}>{item.label}</button>)}</div>}</div>;
}

function UVCanvas({ geometry, textureUrl, background, colour, canvasRef, selection, uvNonce }: { selection: Selection; uvNonce: number; geometry: THREE.BufferGeometry | null; textureUrl: string | null; background: UvBackground; colour: string; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return;
    const draw = (image?: HTMLImageElement) => {
      const size = canvas.width; ctx.clearRect(0, 0, size, size);
      if (background === "texture" && image) ctx.drawImage(image, 0, 0, size, size);
      else if (background === "colour") { ctx.fillStyle = colour; ctx.fillRect(0, 0, size, size); }
      else { const cells = 8; const unit = size / cells; for (let y = 0; y < cells; y += 1) for (let x = 0; x < cells; x += 1) { ctx.fillStyle = background === "grid" ? "#17191d" : (x + y) % 2 ? "#1b1e22" : "#0d0f12"; ctx.fillRect(x * unit, y * unit, unit, unit); } }
      if (background === "grid") { ctx.strokeStyle = "#393d44"; ctx.lineWidth = 2; for (let i = 0; i <= 8; i += 1) { ctx.beginPath(); ctx.moveTo(i * size / 8, 0); ctx.lineTo(i * size / 8, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * size / 8); ctx.lineTo(size, i * size / 8); ctx.stroke(); } }
      const uv = geometry?.getAttribute("uv"); const position = geometry?.getAttribute("position"); if (!uv || !position) return;
      ctx.strokeStyle = "#12c6d2"; ctx.lineWidth = 1.5; const index = geometry?.index; const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) { ctx.beginPath(); for (let j = 0; j < 3; j += 1) { const vertex = index ? index.getX(i + j) : i + j; const x = uv.getX(vertex) * size; const y = (1 - uv.getY(vertex)) * size; if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke(); }
      if (selection && geometry) { const sel = geometry; ctx.strokeStyle = "#f26b2a"; ctx.fillStyle = "rgba(242,107,42,0.35)"; ctx.lineWidth = 2.5;
        for (const f of selection.faces) { const pts = [0, 1, 2].map((c) => { const v = faceVertex(sel, f, c); return [uv.getX(v) * size, (1 - uv.getY(v)) * size] as const; });
          if (selection.element === "Vertex") { ctx.fillStyle = "#f26b2a"; pts.forEach(([x, y]) => { ctx.fillRect(x - 5, y - 5, 10, 10); }); continue; }
          ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (selection.element !== "Segment") ctx.fill(); ctx.stroke(); } }
    };
    if (background !== "texture" || !textureUrl) { draw(); return; } const image = new Image(); image.onload = () => draw(image); image.src = textureUrl;
  }, [geometry, textureUrl, background, colour, canvasRef, selection, uvNonce]);
  return <canvas ref={canvasRef} width={1024} height={1024} className="uv-canvas" aria-label="Current UV layout" />;
}

export function UVWEditor() {
  const [tab, setTab] = useState<Tab>("import"); const [primitive, setPrimitive] = useState<PrimitiveName>("Box");
  const [object, setObject] = useState<THREE.Group>(() => makePrimitive("Box")); const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [textureUrl, setTextureUrl] = useState<string | null>(null); const [textureFile, setTextureFile] = useState<File | null>(null);
  const [modelName, setModelName] = useState("Box"); const [notice, setNotice] = useState("Ready"); const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false); const [materialsOpen, setMaterialsOpen] = useState(false); const [materialMode, setMaterialMode] = useState<MaterialMode>("gltf");
  const [wireframe, setWireframe] = useState(false); const [locked, setLocked] = useState(false); const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<ViewName>("persp"); const [focusNonce, setFocusNonce] = useState(0); const [mapping, setMapping] = useState<MappingMode>("Planar");
  const [selection, setSelection] = useState<Selection>(null); const [elementType, setElementType] = useState<ElementType>("Polygon"); const [selectionMode, setSelectionMode] = useState("Select");
  const [uvBackground, setUvBackground] = useState<UvBackground>("checker"); const [uvColour, setUvColour] = useState("#282c33"); const [transformMode, setTransformMode] = useState<TransformMode>("Select");
  const [numericValue, setNumericValue] = useState("90"); const [history, setHistory] = useState<THREE.Group[]>([]); const [future, setFuture] = useState<THREE.Group[]>([]);
  const [slots, setSlots] = useState<Record<string, MaterialAsset>>({}); const [activeSlot, setActiveSlot] = useState("Base Color"); const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const modelInput = useRef<HTMLInputElement>(null); const textureInput = useRef<HTMLInputElement>(null); const slotInput = useRef<HTMLInputElement>(null); const colourInput = useRef<HTMLInputElement>(null); const uvCanvasRef = useRef<HTMLCanvasElement>(null);
  const stats = useMemo(() => getStats(object), [object]); const selectedMesh = selection ? getMeshes(object)[selection.mesh] ?? null : null; const geometry = useMemo(() => selectedMesh?.geometry ?? getFirstGeometry(object), [object, selectedMesh]);
  useEffect(() => () => { if (textureUrl) URL.revokeObjectURL(textureUrl); Object.values(slots).forEach((slot) => URL.revokeObjectURL(slot.url)); }, []);
  const checkpoint = () => { setHistory((items) => [...items.slice(-19), object.clone(true)]); setFuture([]); };
  const commit = (message: string) => { setObject(object.clone(true)); setNotice(message); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [object.clone(true), ...items]); setHistory((items) => items.slice(0, -1)); setObject(previous); setNotice("Undid last change"); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, object.clone(true)]); setFuture((items) => items.slice(1)); setObject(next); setNotice("Redid change"); };
  const selectPrimitive = (name: PrimitiveName) => { checkpoint(); const next = makePrimitive(name); if (texture) applyTexture(next, texture, wireframe); setPrimitive(name); setModelName(name); setSelection(null); setObject(next); setError(null); setNotice(`${name} created`); setTab("view"); };
  const onModel = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; checkpoint(); setImporting(true); setError(null); setNotice(`Importing ${file.name}…`); try { const next = normalizeModel(await loadModel(file)); applyTexture(next, texture, wireframe); setSelection(null); setObject(next); setModelName(file.name.replace(/\.[^.]+$/, "")); setNotice(`${file.name} imported`); setTab("view"); if (!texture) setTimeout(() => { if (window.confirm("This model has no active texture. Import one now?")) textureInput.current?.click(); }, 100); } catch (caught) { const message = caught instanceof Error ? caught.message : "Could not import model"; setError(`${message} Try OBJ, GLB, glTF, or STL instead.`); setNotice("Import failed"); } finally { setImporting(false); event.target.value = ""; } };
  const loadTextureFile = (file: File, slot?: string) => { const url = URL.createObjectURL(file); new THREE.TextureLoader().load(url, (next) => { next.colorSpace = THREE.SRGBColorSpace; next.flipY = false; if (slot) { setSlots((current) => ({ ...current, [slot]: { file, url, texture: next } })); setActiveSlot(slot); } setTexture(next); setTextureUrl(url); setTextureFile(file); applyTexture(object, next, wireframe); commit(`${file.name} applied`); }, undefined, () => { URL.revokeObjectURL(url); setError("Could not read that texture. Choose a PNG or JPG image."); }); };
  const onTexture = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) { checkpoint(); loadTextureFile(file); } event.target.value = ""; };
  const onSlotTexture = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file && pendingSlot) { checkpoint(); loadTextureFile(file, pendingSlot); } setPendingSlot(null); event.target.value = ""; };
  const applyMapping = (mode: MappingMode) => { checkpoint(); object.traverse((item) => { if (!(item instanceof THREE.Mesh)) return; if (mode === "Box") boxUnwrap(item.geometry); else if (mode === "Cylindrical") cylindricalUnwrap(item.geometry); else planarUnwrap(item.geometry); }); setMapping(mode); commit(`${mode} mapping applied`); setTab("uvw"); };
  const toggleWireframe = () => { const next = !wireframe; setWireframe(next); applyTexture(object, texture, next); commit(`Wireframe ${next ? "on" : "off"}`); };
  const hideSelection = () => { if (!selectedMesh) { setNotice("Select a mesh first"); return; } selectedMesh.visible = false; setHidden(true); commit("Selection hidden"); };
  const showHidden = () => { object.traverse((item) => { item.visible = true; }); setHidden(false); commit("Hidden geometry restored"); };
  const performTransform = () => { const amount = Number(numericValue); if (!Number.isFinite(amount)) return; checkpoint(); if (transformMode === "Rotate") transformUvs(object, { rotate: amount }); if (transformMode === "Move") transformUvs(object, { moveX: amount }); if (transformMode === "Scale") transformUvs(object, { scaleX: amount, scaleY: amount }); commit(`${transformMode} applied`); };
  const downloadUv = () => uvCanvasRef.current?.toBlob((blob) => { if (blob) downloadBlob(blob, "uvforge-layout.png"); }, "image/png");
  const confirmTexture = (action: () => void) => { if (textureFile || window.confirm("No texture is loaded. Continue using the checker texture?")) action(); else textureInput.current?.click(); };
  const downloadObjZip = async () => { const zip = new JSZip(); const source = new (await import("three/examples/jsm/exporters/OBJExporter.js")).OBJExporter().parse(object); const textureName = textureFile?.name ?? "texture.png"; zip.file("uvforge-model.obj", source); zip.file("uvforge-model.mtl", `newmtl uvforge_material\nKd 1.0 1.0 1.0\nmap_Kd ${textureName}\n`); if (textureFile) zip.file(textureName, textureFile); downloadBlob(await zip.generateAsync({ type: "blob" }), "uvforge-model.zip"); };
  const mapMenu: MenuItem[] = (["Planar", "Box", "Cylindrical", "Auto Unwrap", "Original"] as MappingMode[]).map((item) => ({ label: item, active: mapping === item, disabled: item === "Original", action: () => applyMapping(item) }));
  const viewMenu: MenuItem[] = [{ label: "Perspective", active: view === "persp", action: () => setView("persp") }, { label: "Orthographic", active: view === "ortho", action: () => setView("ortho") }, ...(["front", "back", "left", "right", "top", "bottom"] as ViewName[]).map((item) => ({ label: `${item.charAt(0).toUpperCase()}${item.slice(1)}`, active: view === item, action: () => setView(item) }))];
  const tabs = [["import", Upload, "Import"], ["view", Box, "3D View"], ["uvw", Grid2X2, "UVW"], ["export", Download, "Export"]] as const;
  return <main className="editor-shell">
    <header className="editor-header"><div className="brand-mark"><span>U</span><span>V</span><span>W</span></div><div className="file-status"><strong>{modelName}</strong><span>{notice}</span></div><button className="close-button" type="button" aria-label="Clear workspace" title="Clear workspace" onClick={() => selectPrimitive("Box")}><X /></button></header>
    <nav className="tab-bar" aria-label="Editor sections">{tabs.map(([id, Icon, label]) => <button type="button" key={id} className={`tab-button ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}</nav>
    {(tab === "view" || tab === "uvw") && <div className="tool-strip">
      <ToolButton label="Lock viewport" active={locked} onClick={() => setLocked(!locked)}>{locked ? <Lock /> : <Unlock />}</ToolButton>
      <ToolButton label="Hide selection" active={hidden} onClick={hideSelection} menu={[{ label: "Hide Selection", action: hideSelection }, { label: "Hide Unselected", action: () => { object.traverse((item) => { if (item instanceof THREE.Mesh) item.visible = item === selectedMesh; }); setHidden(true); commit("Unselected geometry hidden"); } }, { label: "Show Hidden", action: showHidden }, { label: "Vibration", action: () => navigator.vibrate?.(30) }]}><Eye /></ToolButton>
      <ToolButton label="Element type" active menu={[...["Vertex", "Segment", "Polygon", "Island"].map((label) => ({ label, active: elementType === label, action: () => { setElementType(label as ElementType); setSelection((cur) => cur ? { ...cur, element: label as ElementType } : cur); } })), { label: "Clear Selection", disabled: !selection, action: () => setSelection(null) }]}><BoxSelect /></ToolButton>
      {tab === "view" ? <ToolButton label="Selection mode" menu={["Select", "Add", "Remove"].map((label) => ({ label, active: selectionMode === label, action: () => setSelectionMode(label) }))}><MousePointer2 /></ToolButton> : <ToolButton label="Transform" menu={["Select", "Move", "Rotate", "Scale"].map((label) => ({ label, active: transformMode === label, action: () => setTransformMode(label as TransformMode) }))}>{transformMode === "Move" ? <Move /> : transformMode === "Rotate" ? <RotateCcw /> : <MousePointer2 />}</ToolButton>}
      {tab === "view" && <ToolButton label="Toggle wireframe" active={wireframe} onClick={toggleWireframe} menu={[{ label: wireframe ? "Wireframe Off" : "Wireframe On", active: wireframe, action: toggleWireframe }, { label: "Opacity 0.75", action: () => setNotice("Wireframe opacity set") }, { label: "Front facing only", action: () => setNotice("Front-facing picking on") }, { label: "X-ray (no limits)", action: toggleWireframe }]}><Grid2X2 /></ToolButton>}
      {tab === "view" && <ToolButton label="View mode" onClick={() => setView(view === "ortho" ? "persp" : "ortho")} menu={viewMenu}><Focus /></ToolButton>}
      <ToolButton label="Mapping" active menu={mapMenu} onClick={() => applyMapping(mapping)}><Map /></ToolButton>
      {tab === "view" ? <ToolButton label="Cut seams" onClick={() => { navigator.vibrate?.(25); setNotice("Seams marked for the next unwrap"); }}><Scissors /></ToolButton> : <ToolButton label="Repack islands" onClick={() => applyMapping("Auto Unwrap")} menu={[{ label: "Margin 8 px", action: () => setNotice("Island margin set to 8 px") }, { label: "Repack Islands", action: () => applyMapping("Auto Unwrap") }]}><Grid2X2 /></ToolButton>}
      {tab === "uvw" && <ToolButton label="Texture background" menu={[{ label: "Checkerboard", active: uvBackground === "checker", action: () => setUvBackground("checker") }, { label: "Default Grid", active: uvBackground === "grid", action: () => setUvBackground("grid") }, { label: "Texture", disabled: !textureUrl, active: uvBackground === "texture", action: () => setUvBackground("texture") }, { label: "Colour", active: uvBackground === "colour", action: () => colourInput.current?.click() }, { label: "Materials", action: () => setMaterialsOpen(true) }]}><ImageIcon /></ToolButton>}
      <ToolButton label="Zoom" onClick={() => setFocusNonce((value) => value + 1)} menu={[{ label: "Zoom Extents", action: () => setFocusNonce((value) => value + 1) }, { label: "Zoom Selected", disabled: !selectedMesh, action: () => setFocusNonce((value) => value + 1) }]}><ZoomIn /></ToolButton>
      <ToolButton label="Undo" disabled={!history.length} onClick={undo}><Undo2 /></ToolButton>
      <ToolButton label="Redo" disabled={!future.length} onClick={redo}><Redo2 /></ToolButton>
    </div>}
    {tab === "uvw" && transformMode !== "Select" && <div className="number-bar"><label>{transformMode === "Rotate" ? "Angle°" : transformMode === "Move" ? "Move X" : "Scale X"}<input value={numericValue} onChange={(event) => setNumericValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") performTransform(); }} /></label><button type="button" onClick={performTransform}>Apply</button></div>}
    <section className={`workspace workspace-${tab}`}>
      {tab === "import" && <div className="import-panel"><div className="intro"><span className="eyebrow">01 / SOURCE</span><h1>UVW Mapping Tool</h1><p>Import a model or start from a primitive</p></div>{error && <div className="error-banner" role="alert">{error}</div>}<button type="button" className="primary-action" disabled={importing} onClick={() => modelInput.current?.click()}><Upload />{importing ? "Importing…" : "Import Model"}<small>OBJ · GLB · GLTF · STL</small></button><div className="secondary-actions"><button type="button" onClick={() => textureInput.current?.click()}><ImageIcon />Import Texture</button><button type="button" onClick={() => setMaterialsOpen(true)}><Layers3 />Materials</button></div>{textureUrl && <div className="texture-loaded"><img src={textureUrl} alt="Imported texture thumbnail" /><span>Texture loaded</span></div>}<div className="primitive-panel"><div className="section-label"><Shapes />Primitives</div><div className="primitive-grid">{primitives.map((name) => <button type="button" key={name} title={`Replace model with ${name}`} className={primitive === name ? "is-selected" : ""} onClick={() => selectPrimitive(name)}>{name}</button>)}</div></div><p className="stats">Current: {modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p></div>}
      {tab === "view" && <div className="viewport-wrap"><Viewport3D object={object} locked={locked} view={view} focusNonce={focusNonce} selection={selection} onPick={(mesh, face) => { setSelection((cur) => updateSelection(cur, object, mesh, face, elementType, selectionMode)); setNotice(`${elementType} · ${selectionMode}`); }} /><span className="view-label">{view.toUpperCase()}</span>{locked && view !== "persp" && <button type="button" className="unlock-view" onClick={() => { setLocked(false); setView("persp"); }}>Unlock view</button>}<div className="viewport-info"><span>{modelName}</span><strong>{stats.faces.toLocaleString()} tris</strong></div></div>}
      {tab === "uvw" && <div className="uv-stage"><div className="uv-frame"><UVCanvas geometry={geometry} textureUrl={textureUrl} background={uvBackground} colour={uvColour} canvasRef={uvCanvasRef} selection={selection} uvNonce={history.length + future.length} /></div><div className="uv-footer"><span>UV SPACE 0—1 · {transformMode}</span><button type="button" onClick={() => applyMapping("Planar")}><Map />Planar unwrap</button></div></div>}
      {tab === "export" && <div className="export-panel"><span className="eyebrow">04 / OUTPUT</span><h1>Export</h1><p>{textureFile ? "Your imported texture and UVs are included in every format." : "No texture imported — exports will use the checker grid."}</p><div className="export-list"><button type="button" onClick={() => confirmTexture(() => void exportGlb(object))}><Box /><span><strong>GLB</strong><small>Mesh + UVs + texture</small></span><Download /></button><button type="button" onClick={() => confirmTexture(() => void downloadObjZip())}><Box /><span><strong>OBJ + MTL + PNG</strong><small>Packaged as .zip</small></span><Download /></button><button type="button" onClick={downloadUv}><ImageIcon /><span><strong>UV Layout PNG</strong><small>1024 × 1024 wireframe</small></span><Download /></button></div><p className="stats">{modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p><div className="hidden-canvas"><UVCanvas geometry={geometry} textureUrl={textureUrl} background={uvBackground} colour={uvColour} canvasRef={uvCanvasRef} selection={selection} uvNonce={history.length + future.length} /></div></div>}
    </section>
    <input ref={modelInput} className="sr-only" type="file" accept=".obj,.glb,.gltf,.stl,model/gltf-binary" onChange={(event) => void onModel(event)} /><input ref={textureInput} className="sr-only" type="file" accept="image/png,image/jpeg" onChange={onTexture} /><input ref={slotInput} className="sr-only" type="file" accept="image/png,image/jpeg" onChange={onSlotTexture} /><input ref={colourInput} className="sr-only" type="color" value={uvColour} onChange={(event) => { setUvColour(event.target.value); setUvBackground("colour"); }} />
    {materialsOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) setMaterialsOpen(false); }}><section className="materials-modal" role="dialog" aria-modal="true" aria-labelledby="materials-title"><header><div><h2 id="materials-title"><Layers3 />Materials</h2><p>Assign textures to material slots and choose which slot drives the active UVW texture.</p></div><button type="button" onClick={() => setMaterialsOpen(false)} aria-label="Close materials"><X /></button></header><div className="mode-switch"><button type="button" className={materialMode === "gltf" ? "is-active" : ""} onClick={() => setMaterialMode("gltf")}>GLB / glTF (PBR)</button><button type="button" className={materialMode === "obj" ? "is-active" : ""} onClick={() => setMaterialMode("obj")}>OBJ / MTL</button></div><div className="slot-list">{(materialMode === "gltf" ? gltfSlots : objSlots).map(([label, detail]) => { const asset = slots[label]; return <div className="slot-row" key={label}><button className={`slot-select ${activeSlot === label && asset ? "is-active" : ""}`} type="button" disabled={!asset} onClick={() => { if (!asset) return; setActiveSlot(label); setTexture(asset.texture); setTextureUrl(asset.url); setTextureFile(asset.file); applyTexture(object, asset.texture, wireframe); commit(`${label} set as active UVW texture`); }} aria-label={`Use ${label} for UV preview`} />{asset && <img className="slot-thumbnail" src={asset.url} alt="" />}<div><strong>{label}</strong><span>{detail}</span></div>{asset && <button className="slot-clear" type="button" aria-label={`Clear ${label}`} onClick={() => { URL.revokeObjectURL(asset.url); setSlots((current) => { const next = { ...current }; delete next[label]; return next; }); }}><Trash2 /></button>}<button className="slot-upload" type="button" onClick={() => { setPendingSlot(label); slotInput.current?.click(); }} aria-label={`Assign texture to ${label}`}><Upload /></button></div>; })}</div><footer>Active UVW texture: {activeSlot}{slots[activeSlot] ? ` · ${slots[activeSlot].file.name}` : " · none"}</footer></section></div>}
  </main>;
}
