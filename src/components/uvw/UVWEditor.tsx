import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import {
  ArrowRightToLine, Blend, Box, Camera, Check, ChevronDown, Contrast, Database, Dot, Download, Eye, EyeClosed, EyeOff, FlipHorizontal2, FlipVertical2, Focus, Globe,
  Grid2X2, Image as ImageIcon, LandPlot, Layers3, LayoutDashboard, LayoutGrid, LayoutTemplate, Lock, Map as MapIcon, Minus, MousePointer2, Move, MoveHorizontal, MoveVertical,
  Package, PackageOpen, Palette, Pentagon, RectangleHorizontal, RectangleVertical, Redo2, RotateCw, Scaling, Scissors, Shapes, SquareDashed, SquareScissors,
  SwitchCamera, Trash2, Triangle, Undo2, Unlock, Upload, Vibrate, X, ZoomIn,
} from "lucide-react";
import { CheckerboardIcon, CpuAi, Grid2x2Plus, RulerDimensionLine, SquaresSubtract, SquaresUnite } from "./icons";
import * as THREE from "three";
import { clone as cloneWithSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import JSZip from "jszip";
import { Viewport3D, type CameraState, type ViewName } from "./Viewport3D";
import { applyMeshVisibilityAction, convertSelectionElement, faceVertex, getMeshes, updateSelection, type ElementType, type Selection, type SelectionMode } from "@/lib/selection";
import { UVWorkspace, fitUVView, type UVBackground, type UVTransformAxis, type UVTransformMode, type UVView } from "./UVWorkspace";
import { addSeamsFromSelection, applyUvProjection, clearSeams, geometrySeamCount, packUvIslands, rememberOriginalUvs, seamCount, transformSelectedUvs, type UVAxis, type UVProjection } from "@/lib/uv-tools";
import {
  applyTexture, applyTextureToSlot, createCheckerTexture, downloadBlob,
  exportFbx, exportGlb, exportGltf, exportObj, exportPly, exportStl, getStats, hasBaseColorTexture, loadModel,
  normalizeModel, primitiveGeometry, type PrimitiveName,
} from "../../lib/uvw";
import "./uvw-menus.css";

type Tab = "import" | "view" | "uvw" | "export";
type MaterialMode = "gltf" | "obj";
type MappingMode = UVProjection;
type MappingScope = "Entire" | "Selected";
type MaterialAsset = { file: File; url: string; texture: THREE.Texture };
type PendingTextureSlot = { mode: MaterialMode; label: string };
const textureSlotKey = (mode: MaterialMode, label: string) => `${mode}:${label}`;
const isBaseColorSlot = (mode: MaterialMode, label: string) => mode === "gltf" ? label === "Base Color" : label === "Diffuse Color";
const isColorTextureSlot = (mode: MaterialMode, label: string) => mode === "gltf" ? ["Base Color", "Emissive", "Sheen Color", "Specular Color"].includes(label) : ["Diffuse Color", "Specular Color", "Emissive", "Reflection"].includes(label);
type MenuItem = { label: string; icon?: ReactNode; disabled?: boolean; active?: boolean; checked?: boolean; separated?: boolean; action: () => void };
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
const objSlots: ReadonlyArray<readonly [string, string]> = [["Diffuse Color", "map_Kd"], ["Specular Color", "map_Ks"], ["Ambient Color", "map_Ka / AO"], ["Emissive", "map_Ke"], ["Alpha / Opacity", "map_d"], ["Bump", "map_bump / bump"], ["Normal", "norm"], ["Displacement", "disp"], ["Reflection", "refl"]];
const GLTF_CORE_SLOT_COUNT = 5;
const REINDEXING_MODES: ReadonlyArray<MappingMode> = ["Cylinder Caps", "Sphere", "Custom Unwrap", "Unfold Box", "Layout Islands"];

function makePrimitive(name: PrimitiveName) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(primitiveGeometry(name), new THREE.MeshStandardMaterial());
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); applyTexture(group, createCheckerTexture()); rememberOriginalUvs(group); return group;
}

type ToolButtonProps = {
  label: string; active?: boolean; disabled?: boolean; menu?: MenuItem[]; grid?: MenuItem[]; panel?: (close: () => void) => ReactNode;
  quick?: (() => void) | undefined; longPressMenu?: boolean; children: ReactNode; onClick?: (() => void) | undefined;
};

function ToolButton({ label, active, disabled, menu, grid, panel, children, onClick, quick, longPressMenu = false }: ToolButtonProps) {
  const [open, setOpen] = useState(false); const wrap = useRef<HTMLDivElement>(null); const holdTimer = useRef<number | null>(null); const heldRef = useRef(false);
  const hasPopover = Boolean(menu || grid || panel);
  const clearHold = () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); holdTimer.current = null; };
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, [open]);
  const handleClick = () => { if (heldRef.current) { heldRef.current = false; return; } if (hasPopover && longPressMenu) { if (quick) quick(); else setOpen((value) => !value); } else if (hasPopover) setOpen((value) => !value); else if (quick) quick(); else onClick?.(); };
  const popoverClass = grid ? "tool-popover-grid" : panel ? "tool-popover-panel" : menu?.some((item) => item.icon) ? "tool-popover-icons" : "";
  return <div className={`tool-menu-wrap ${panel ? "has-panel" : ""}`} ref={wrap}><button type="button" className={`tool-button ${active || open ? "is-active" : ""}`} title={label} aria-label={label} aria-expanded={hasPopover ? open : undefined} disabled={disabled} onPointerDown={() => { if (!hasPopover || !longPressMenu || disabled) return; heldRef.current = false; holdTimer.current = window.setTimeout(() => { heldRef.current = true; setOpen(true); }, 480); }} onPointerUp={clearHold} onPointerCancel={() => { clearHold(); heldRef.current = false; }} onContextMenu={(event) => { if (longPressMenu) event.preventDefault(); }} onClick={handleClick}>{children}{hasPopover && <ChevronDown className="menu-caret" />}</button>
    {open && hasPopover && <div className={`tool-popover ${popoverClass}`} role={panel ? "dialog" : "menu"} aria-label={label}>
      {grid ? grid.map((item) => <button type="button" role="menuitem" key={item.label} title={item.label} aria-label={item.label} className={`tool-grid-item ${item.active ? "is-active" : ""}`} disabled={item.disabled} onClick={() => { item.action(); setOpen(false); }}>{item.icon}</button>)
        : panel ? panel(() => setOpen(false))
          : menu?.map((item) => <button type="button" role="menuitem" key={item.label} className={`tool-menu-item ${item.active ? "is-active" : ""} ${item.separated ? "is-separated" : ""}`} disabled={item.disabled} onClick={() => { item.action(); setOpen(false); }}>{item.icon && <span className="tool-menu-icon" aria-hidden="true">{item.icon}</span>}<span>{item.label}</span>{item.checked && <Check className="tool-menu-check" aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}

const DEFAULT_UV_VIEW: UVView = { zoom: 1, panX: 0, panY: 0 };

function cloneObjectSnapshot<T extends THREE.Object3D>(source: T): T {
  const snapshot = cloneWithSkeleton(source) as T;
  const sourceMeshes = getMeshes(source);
  const snapshotMeshes = getMeshes(snapshot);
  sourceMeshes.forEach((mesh, index) => {
    const copy = snapshotMeshes[index];
    if (!copy) return;
    copy.geometry = mesh.geometry.clone();
    copy.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => material.clone())
      : mesh.material.clone();
  });
  return snapshot;
}

function useUVTouchGestures(frameRef: React.RefObject<HTMLDivElement | null>, uvView: UVView, setUvView: React.Dispatch<React.SetStateAction<UVView>>) {
  const gestureRef = useRef<{ mode: "none" | "pan" | "pinch"; startDist: number; startZoom: number; startX: number; startY: number; startPanX: number; startPanY: number }>({ mode: "none", startDist: 0, startZoom: 1, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  const onTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      const dx = first.clientX - second.clientX;
      const dy = first.clientY - second.clientY;
      gestureRef.current = {
        mode: "pinch",
        startDist: Math.hypot(dx, dy),
        startZoom: uvView.zoom,
        startX: (first.clientX + second.clientX) / 2,
        startY: (first.clientY + second.clientY) / 2,
        startPanX: uvView.panX,
        startPanY: uvView.panY,
      };
      event.preventDefault();
    }
  }, [uvView]);

  const onTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (g.mode === "none" || event.touches.length !== 2) return;
    event.preventDefault();

    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (!first || !second) return;
    const dx = first.clientX - second.clientX;
    const dy = first.clientY - second.clientY;
    const dist = Math.hypot(dx, dy);
    const midX = (first.clientX + second.clientX) / 2;
    const midY = (first.clientY + second.clientY) / 2;

    const scale = g.startDist > 0 ? dist / g.startDist : 1;
    const newZoom = Math.max(0.3, Math.min(8, g.startZoom * scale));

    const frameMidX = g.startX;
    const frameMidY = g.startY;
    const deltaMidX = midX - frameMidX;
    const deltaMidY = midY - frameMidY;

    setUvView({
      zoom: newZoom,
      panX: g.startPanX + deltaMidX,
      panY: g.startPanY + deltaMidY,
    });
  }, [setUvView]);

  const onTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) gestureRef.current.mode = "none";
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd };
}

function UVCanvas({ object, textureUrl, background, colour, hiddenFaces, canvasRef, uvNonce, uvView }: { object: THREE.Object3D; hiddenFaces: ReadonlySet<string>; uvNonce: number; textureUrl: string | null; background: UVBackground; colour: string; canvasRef: React.RefObject<HTMLCanvasElement | null>; uvView: UVView }) {
  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext("2d"); if (!canvas || !ctx) return;
    const draw = (image?: HTMLImageElement) => {
      const size = canvas.width; ctx.clearRect(0, 0, size, size);
      if (background === "texture" && image) ctx.drawImage(image, 0, 0, size, size);
      else if (background === "colour") { ctx.fillStyle = colour; ctx.fillRect(0, 0, size, size); }
      else { const cells = 8; const unit = size / cells; for (let y = 0; y < cells; y += 1) for (let x = 0; x < cells; x += 1) { ctx.fillStyle = background === "grid" ? "#17191d" : (x + y) % 2 ? "#1b1e22" : "#0d0f12"; ctx.fillRect(x * unit, y * unit, unit, unit); } }
      if (background === "grid") { ctx.strokeStyle = "#393d44"; ctx.lineWidth = 2; for (let i = 0; i <= 8; i += 1) { ctx.beginPath(); ctx.moveTo(i * size / 8, 0); ctx.lineTo(i * size / 8, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * size / 8); ctx.lineTo(size, i * size / 8); ctx.stroke(); } }
      ctx.strokeStyle = "#12c6d2"; ctx.lineWidth = 1.5;
      getMeshes(object).forEach((mesh, meshIndex) => {
        const uv = mesh.geometry.getAttribute("uv"); if (!uv) return;
        for (let face = 0; face < Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3); face += 1) {
          if (hiddenFaces.has(`${meshIndex}:${face}`)) continue;
          ctx.beginPath();
          for (let corner = 0; corner < 3; corner += 1) { const vertex = faceVertex(mesh.geometry, face, corner); const x = uv.getX(vertex) * size; const y = (1 - uv.getY(vertex)) * size; if (corner === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
          ctx.closePath(); ctx.stroke();
        }
      });
    };
    if (background !== "texture" || !textureUrl) { draw(); return; } const image = new Image(); image.onload = () => draw(image); image.src = textureUrl;
  }, [object, hiddenFaces, textureUrl, background, colour, canvasRef, uvNonce]);
  return <canvas ref={canvasRef} width={1024} height={1024} className="uv-canvas" aria-label="Current UV layout" style={{ transform: `translate(${uvView.panX}px, ${uvView.panY}px) scale(${uvView.zoom})`, transformOrigin: "center center" }} />;
}

export function UVWEditor() {
  const [tab, setTab] = useState<Tab>("import"); const [primitive, setPrimitive] = useState<PrimitiveName>("Box");
  const [object, setObject] = useState<THREE.Group>(() => makePrimitive("Box")); const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [textureUrl, setTextureUrl] = useState<string | null>(null); const [textureFile, setTextureFile] = useState<File | null>(null);
  const [modelName, setModelName] = useState("Box"); const [notice, setNotice] = useState("Ready"); const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false); const [materialsOpen, setMaterialsOpen] = useState(false); const [texturePrompt, setTexturePrompt] = useState(false); const [materialMode, setMaterialMode] = useState<MaterialMode>("gltf");
  const [wireframe, setWireframe] = useState(false); const [locked, setLocked] = useState(false); const [hidden, setHidden] = useState(false); const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [modelOpacity, setModelOpacity] = useState(1); const opacityTouched = useRef(false);
  const [view, setView] = useState<ViewName>("persp"); const [focusNonce, setFocusNonce] = useState(0); const [mapping, setMapping] = useState<MappingMode>("Planar");
  const [mappingScope, setMappingScope] = useState<MappingScope>("Entire"); const [planarAxis, setPlanarAxis] = useState<UVAxis>("Z"); const [planarStretch, setPlanarStretch] = useState(false); const [islandMargin, setIslandMargin] = useState(8); const [islandAngle, setIslandAngle] = useState(45);
  const [selection, setSelection] = useState<Selection>(null); const [elementType, setElementType] = useState<ElementType>("Polygon"); const [selectionMode, setSelectionMode] = useState<SelectionMode>("Select");
  const [uvBackground, setUvBackground] = useState<UVBackground>("checker"); const [uvColour, setUvColour] = useState("#282c33"); const [transformMode, setTransformMode] = useState<UVTransformMode>("Select"); const [transformAxis, setTransformAxis] = useState<UVTransformAxis>("free");
  const [hiddenUvFaces, setHiddenUvFaces] = useState<Set<string>>(() => new Set());
  const [numericValue, setNumericValue] = useState("90"); const [history, setHistory] = useState<THREE.Group[]>([]); const [future, setFuture] = useState<THREE.Group[]>([]);
  const [slots, setSlots] = useState<Record<string, MaterialAsset>>({}); const [activeSlot, setActiveSlot] = useState("gltf:Base Color"); const [pendingSlot, setPendingSlot] = useState<PendingTextureSlot | null>(null);
  const [uvView, setUvView] = useState<UVView>(DEFAULT_UV_VIEW);
  const savedCameraRef = useRef<CameraState | null>(null);
  const saveCamera = useCallback((state: CameraState) => {
    savedCameraRef.current = state;
  }, []);
  const modelInput = useRef<HTMLInputElement>(null); const textureInput = useRef<HTMLInputElement>(null); const slotInput = useRef<HTMLInputElement>(null); const colourInput = useRef<HTMLInputElement>(null); const uvCanvasRef = useRef<HTMLCanvasElement>(null); const undoTapTimer = useRef<number | null>(null);
  const uvFrameRef = useRef<HTMLDivElement>(null);
  const textureObjectUrlsRef = useRef(new Set<string>());
  const stats = useMemo(() => getStats(object), [object]); const selectedMesh = selection ? getMeshes(object)[selection.mesh] ?? null : null;
  const seamTotal = useMemo(() => seamCount(object), [object]);
  const createTextureObjectUrl = (file: File) => { const url = URL.createObjectURL(file); textureObjectUrlsRef.current.add(url); return url; };
  const revokeTextureObjectUrl = (url: string) => { if (textureObjectUrlsRef.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => () => { textureObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); textureObjectUrlsRef.current.clear(); }, []);
  useEffect(() => {
    if (modelOpacity === 1 && !opacityTouched.current) return;
    const transparent = modelOpacity < 1;
    getMeshes(object).forEach((mesh) => {
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
        if (material.opacity === modelOpacity && material.transparent === transparent) return;
        material.opacity = modelOpacity; material.transparent = transparent; material.needsUpdate = true;
      });
    });
  }, [object, modelOpacity]);
  const checkpoint = () => { const snapshot = cloneObjectSnapshot(object); setHistory((items) => [...items.slice(-19), snapshot]); setFuture([]); };
  const commit = (message: string) => { setObject(cloneWithSkeleton(object) as THREE.Group); setNotice(message); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [cloneObjectSnapshot(object), ...items]); setHistory((items) => items.slice(0, -1)); setObject(previous); setNotice("Undid last change"); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, cloneObjectSnapshot(object)]); setFuture((items) => items.slice(1)); setObject(next); setNotice("Redid change"); };
  const selectPrimitive = (name: PrimitiveName) => { checkpoint(); const next = makePrimitive(name); if (texture) applyTexture(next, texture, wireframe); setPrimitive(name); setModelName(name); setSelection(null); setObject(next); setError(null); setNotice(`${name} created`); setTab("view"); };
  const onModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const file = files.find((candidate) => /\.(obj|glb|gltf|stl|3mf|fbx|ply|dae|step|stp|iges|igs)$/i.test(candidate.name)) ?? files[0]!;
    checkpoint(); setImporting(true); setError(null); setNotice(`Importing ${file.name}…`);
    try {
      const loaded = await loadModel(files);
      const hasImportedTexture = hasBaseColorTexture(loaded.scene);
      const next = normalizeModel(loaded.scene, loaded.animations);
      rememberOriginalUvs(next);
      applyTexture(next, texture, wireframe);
      setSelection(null); setObject(next); setModelName(loaded.sourceName.replace(/\.[^.]+$/, ""));
      if (loaded.format === "obj") { setMaterialMode("obj"); setActiveSlot("obj:Diffuse Color"); }
      else if (["glb", "gltf", "3mf", "fbx", "ply", "dae", "step", "iges"].includes(loaded.format)) { setMaterialMode("gltf"); setActiveSlot("gltf:Base Color"); }
      setNotice(`${loaded.sourceName} imported`); setTab("view"); setTexturePrompt(!texture && !hasImportedTexture);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not import model";
      setError(`${message} Choose OBJ, GLB, glTF, STL, 3MF, FBX, PLY, COLLADA, STEP, IGES, or a ZIP bundle.`);
      setNotice("Import failed");
    } finally { setImporting(false); event.target.value = ""; }
  };
  const loadTextureFile = (file: File, slot?: PendingTextureSlot) => { const url = createTextureObjectUrl(file); new THREE.TextureLoader().load(url, (next) => { next.colorSpace = slot && !isColorTextureSlot(slot.mode, slot.label) ? THREE.NoColorSpace : THREE.SRGBColorSpace; if (slot) { const assigned = applyTextureToSlot(object, slot.mode, slot.label, next); if (!assigned) { revokeTextureObjectUrl(url); next.dispose(); setError(`${slot.label} is not supported by the current model material.`); return; } const key = textureSlotKey(slot.mode, slot.label); setSlots((current) => ({ ...current, [key]: { file, url, texture: next } })); setActiveSlot(key); if (isBaseColorSlot(slot.mode, slot.label)) { setTexture(next); setTextureFile(file); } setTextureUrl(url); } else { setTexture(next); setTextureFile(file); setTextureUrl(url); applyTexture(object, next, wireframe); } commit(`${file.name} applied`); }, undefined, () => { revokeTextureObjectUrl(url); setError("Could not read that texture image."); }); };
  const onTexture = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) { checkpoint(); loadTextureFile(file); } event.target.value = ""; };
  const onSlotTexture = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file && pendingSlot) { checkpoint(); loadTextureFile(file, pendingSlot); } setPendingSlot(null); event.target.value = ""; };
  const applyMapping = (mode: MappingMode, axis = planarAxis, stretch = planarStretch, scope: MappingScope = mappingScope) => {
    const meshes = getMeshes(object);
    if (scope === "Selected" && !selection?.faces.length) { setNotice("Select faces first"); return; }
    const targets = scope === "Selected" && selection
      ? [{ mesh: meshes[selection.mesh], faces: selection.faces }]
      : meshes.map((mesh) => ({ mesh, faces: undefined as number[] | undefined }));
    if (!targets.some((target) => target.mesh)) { setNotice("No mesh is available to map"); return; }
    if (mode === "Custom Unwrap" && !targets.some(({ mesh }) => mesh && geometrySeamCount(mesh.geometry) > 0)) { setNotice("Mark seams first — use the scissors button in 3D View"); return; }
    checkpoint();
    targets.forEach(({ mesh, faces }) => {
      if (!mesh) return;
      mesh.geometry = applyUvProjection(mesh.geometry, mode, { axis, stretch, marginPx: islandMargin, angleDeg: islandAngle, ...(faces ? { faces } : {}) });
    });
    if (scope === "Selected" && selection) setSelection({ mesh: selection.mesh, faces: selection.faces, vertices: [], edges: [], element: "Polygon" });
    else if (REINDEXING_MODES.includes(mode)) setSelection(null);
    setMapping(mode);
    commit(`${mode} applied to ${scope.toLowerCase()}`);
    setTab("uvw");
  };
  const repackIslands = () => {
    const meshes = getMeshes(object);
    if (mappingScope === "Selected" && !selection) { setNotice("Select UVs first"); return; }
    const targets = mappingScope === "Selected" && selection
      ? [{ mesh: meshes[selection.mesh], faces: selection.faces }]
      : meshes.map((mesh) => ({ mesh, faces: undefined as number[] | undefined }));
    checkpoint();
    let islandCount = 0;
    targets.forEach(({ mesh, faces }) => {
      if (!mesh) return;
      if (faces?.length) mesh.geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      islandCount += packUvIslands(mesh.geometry, islandMargin, faces);
    });
    if (mappingScope === "Selected" && selection) setSelection({ mesh: selection.mesh, faces: selection.faces, vertices: [], edges: [], element: "Polygon" });
    commit(`Repacked ${islandCount} UV island${islandCount === 1 ? "" : "s"} · ${islandMargin}px margin`);
  };
  const markSeams = () => {
    if (!selection) { setNotice("Select edges or polygons first, then cut seams"); return; }
    const mesh = getMeshes(object)[selection.mesh];
    if (!mesh) return;
    checkpoint();
    const added = addSeamsFromSelection(mesh.geometry, selection);
    if (vibrationEnabled) navigator.vibrate?.(25);
    commit(added ? `${added} seam edge${added === 1 ? "" : "s"} marked for Custom Unwrap` : "Those edges are already seams");
  };
  const clearAllSeams = () => { checkpoint(); clearSeams(object); commit("All seams cleared"); };
  const fitUvView = (selectedOnly: boolean) => {
    const frame = uvFrameRef.current;
    if (!frame) return;
    if (selectedOnly && !selection) { setNotice("Select UVs to zoom to selection"); return; }
    setUvView(fitUVView(object, selection, frame.clientWidth, frame.clientHeight, selectedOnly));
  };
  const fillScreen = () => { if (tab === "uvw") fitUvView(false); else setFocusNonce((value) => value + 1); };
  const hideUvSelection = () => {
    if (!selection?.faces.length) { setNotice("Select UV faces first"); return; }
    setHiddenUvFaces((current) => new Set([...current, ...selection.faces.map((face) => `${selection.mesh}:${face}`)]));
    setSelection(null);
    setNotice("Selected UV faces hidden");
    if (vibrationEnabled) navigator.vibrate?.(15);
  };
  const hideUnselectedUv = () => {
    if (!selection) { setNotice("Select UVs first"); return; }
    const meshes = getMeshes(object);
    const selected = new Set(selection.faces.map((face) => `${selection.mesh}:${face}`));
    const hiddenFaces = new Set<string>();
    meshes.forEach((mesh, meshIndex) => {
      for (let face = 0; face < Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3); face += 1) {
        const key = `${meshIndex}:${face}`;
        if (!selected.has(key)) hiddenFaces.add(key);
      }
    });
    setHiddenUvFaces(hiddenFaces);
    setNotice("Unselected UV faces hidden");
    if (vibrationEnabled) navigator.vibrate?.(15);
  };
  const showUvHidden = () => { setHiddenUvFaces(new Set()); setNotice("All UV faces shown"); if (vibrationEnabled) navigator.vibrate?.(15); };
  const hideActiveSelection = () => tab === "uvw" ? hideUvSelection() : hideSelection();
  const performSelectedTransform = (transform: { moveX?: number; moveY?: number; rotate?: number; scaleX?: number; scaleY?: number }, label: string) => {
    if (!selection) { setNotice("Select UVs first"); return; }
    const mesh = getMeshes(object)[selection.mesh];
    if (!mesh || !transformSelectedUvs(mesh.geometry, selection, transform)) { setNotice("No selected UVs to transform"); return; }
    commit(label);
  };
  const toggleWireframe = () => { const next = !wireframe; checkpoint(); setWireframe(next); applyTexture(object, texture, next); commit(`Wireframe ${next ? "on" : "off"}`); };
  const hideSelection = () => { if (!selectedMesh) { setNotice("Select a mesh first"); return; } checkpoint(); applyMeshVisibilityAction(object, selectedMesh, "hide-selection"); setHidden(getMeshes(object).some((mesh) => !mesh.visible)); setSelection(null); commit("Selection hidden"); if (vibrationEnabled) navigator.vibrate?.(15); };
  const hideUnselected = () => { if (!selectedMesh) { setNotice("Select a mesh first"); return; } checkpoint(); applyMeshVisibilityAction(object, selectedMesh, "hide-unselected"); setHidden(getMeshes(object).some((mesh) => !mesh.visible)); commit("Unselected geometry hidden"); if (vibrationEnabled) navigator.vibrate?.(15); };
  const showHidden = () => { if (!getMeshes(object).some((mesh) => !mesh.visible)) { setHidden(false); setNotice("Nothing is hidden"); return; } checkpoint(); applyMeshVisibilityAction(object, selectedMesh, "show-hidden"); setHidden(false); commit("Hidden geometry restored"); if (vibrationEnabled) navigator.vibrate?.(15); };
  const toggleVibration = () => { const next = !vibrationEnabled; setVibrationEnabled(next); if (next) navigator.vibrate?.(30); };
  const performTransform = () => {
    const amount = Number(numericValue);
    if (!Number.isFinite(amount)) return;
    if (!selection) { setNotice("Select UVs first"); return; }
    const transform = transformMode === "Rotate" ? { rotate: amount }
      : transformMode === "Move" ? transformAxis === "x" ? { moveX: amount } : { moveY: amount }
        : transformAxis === "x" ? { scaleX: amount } : { scaleY: amount };
    checkpoint();
    performSelectedTransform(transform, `${transformMode} applied`);
  };
  const undoRedoTap = () => {
    if (undoTapTimer.current !== null) {
      window.clearTimeout(undoTapTimer.current);
      undoTapTimer.current = null;
      redo();
      return;
    }
    undoTapTimer.current = window.setTimeout(() => { undoTapTimer.current = null; undo(); }, 260);
  };
  useEffect(() => () => { if (undoTapTimer.current !== null) window.clearTimeout(undoTapTimer.current); }, []);
  const exportFileStem = modelName.replace(/\.[^.]+$/, "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "uvw-model";
  const downloadUv = () => uvCanvasRef.current?.toBlob((blob) => { if (blob) downloadBlob(blob, `${exportFileStem}-uv.png`); }, "image/png");
  const downloadFbx = async () => {
    setError(null); setNotice("Exporting FBX…");
    try { await exportFbx(object, `${exportFileStem}.fbx`); setNotice("FBX exported"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not export FBX."); setNotice("FBX export failed"); }
  };
  const confirmTexture = (action: () => void) => { if (textureFile || hasBaseColorTexture(object) || window.confirm("No texture is loaded. Continue without an imported texture?")) action(); else textureInput.current?.click(); };
  const downloadObjZip = async () => {
    const zip = new JSZip();
    const objName = `${exportFileStem}.obj`;
    const mtlName = `${exportFileStem}.mtl`;
    let source = new (await import("three/examples/jsm/exporters/OBJExporter.js")).OBJExporter().parse(object);
    source = `mtllib ${mtlName}\n${source.replace(/^usemtl .*$/gm, "usemtl uvforge_material")}`;
    if (!/^usemtl uvforge_material$/m.test(source)) source = source.replace(/^(f\s)/m, "usemtl uvforge_material\n$1");
    const textureExtension = textureFile?.name.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".png";
    const textureName = `uvforge-texture${textureExtension}`;
    const mtl = [`newmtl uvforge_material`, `Kd 1.0 1.0 1.0`, ...(textureFile ? [`map_Kd ${textureName}`] : [])].join("\n") + "\n";
    zip.file(objName, source);
    zip.file(mtlName, mtl);
    if (textureFile) zip.file(textureName, textureFile);
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${exportFileStem}-obj.zip`);
  };

  const elementIcons: Record<ElementType, ReactNode> = { Vertex: <Dot />, Segment: <Minus />, Polygon: <Triangle />, Island: <Pentagon /> };
  const selectionModeIcons: Record<SelectionMode, ReactNode> = { Select: <MousePointer2 />, Add: <SquaresUnite />, Remove: <SquaresSubtract /> };
  const transformIcon: ReactNode = transformMode === "Move" ? transformAxis === "x" ? <MoveHorizontal /> : transformAxis === "y" ? <MoveVertical /> : <Move />
    : transformMode === "Rotate" ? <RotateCw /> : transformMode === "Scale" ? transformAxis === "x" ? <RectangleHorizontal /> : transformAxis === "y" ? <RectangleVertical /> : <Scaling />
      : selectionModeIcons[selectionMode];
  const hasOriginalUVs = getMeshes(object).some((mesh) => Array.isArray(mesh.geometry.userData["uvwOriginalFaceCornerUvs"]));
  const elementMenu: MenuItem[] = [
    ...(["Vertex", "Segment", "Polygon", "Island"] as ElementType[]).map((item) => ({ label: item, icon: elementIcons[item], active: elementType === item, action: () => { setElementType(item); setSelection((current) => convertSelectionElement(object, current, item)); } })),
    { label: "Clear Selection", icon: <X />, disabled: !selection, action: () => setSelection(null) },
  ];
  const selectionMenu: MenuItem[] = (["Select", "Add", "Remove"] as SelectionMode[]).map((item) => ({ label: item, icon: selectionModeIcons[item], active: selectionMode === item, action: () => setSelectionMode(item) }));
  const pickSelectMode = (mode: SelectionMode) => () => { setTransformMode("Select"); setTransformAxis("free"); setSelectionMode(mode); };
  const pickTransform = (mode: UVTransformMode, axis: UVTransformAxis, value: string) => () => { setTransformMode(mode); setTransformAxis(axis); setNumericValue(value); };
  const isTransform = (mode: UVTransformMode, axis: UVTransformAxis) => transformMode === mode && transformAxis === axis;
  const transformGrid: MenuItem[] = [
    { label: "Select", icon: <MousePointer2 />, active: transformMode === "Select" && selectionMode === "Select", action: pickSelectMode("Select") },
    { label: "Add", icon: <SquaresUnite />, active: transformMode === "Select" && selectionMode === "Add", action: pickSelectMode("Add") },
    { label: "Remove", icon: <SquaresSubtract />, active: transformMode === "Select" && selectionMode === "Remove", action: pickSelectMode("Remove") },
    { label: "Move", icon: <Move />, active: isTransform("Move", "free"), action: pickTransform("Move", "free", "0") },
    { label: "Move horizontal", icon: <MoveHorizontal />, active: isTransform("Move", "x"), action: pickTransform("Move", "x", "0") },
    { label: "Move vertical", icon: <MoveVertical />, active: isTransform("Move", "y"), action: pickTransform("Move", "y", "0") },
    { label: "Rotate", icon: <RotateCw />, active: transformMode === "Rotate", action: pickTransform("Rotate", "free", "90") },
    { label: "Mirror horizontal", icon: <FlipHorizontal2 />, disabled: !selection, action: () => { checkpoint(); performSelectedTransform({ scaleX: -1 }, "UVs mirrored horizontally"); } },
    { label: "Mirror vertical", icon: <FlipVertical2 />, disabled: !selection, action: () => { checkpoint(); performSelectedTransform({ scaleY: -1 }, "UVs mirrored vertically"); } },
    { label: "Scale", icon: <Scaling />, active: isTransform("Scale", "free"), action: pickTransform("Scale", "free", "1") },
    { label: "Scale vertical", icon: <RectangleVertical />, active: isTransform("Scale", "y"), action: pickTransform("Scale", "y", "1") },
    { label: "Scale horizontal", icon: <RectangleHorizontal />, active: isTransform("Scale", "x"), action: pickTransform("Scale", "x", "1") },
  ];
  const clampNumber = (raw: string, min: number, max: number, fallback: number) => { const value = Number(raw); return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback; };
  const mapPanel = (close: () => void) => {
    const run = (action: () => void) => () => { action(); close(); };
    return <div className="map-panel">
      <div className="map-scope" role="group" aria-label="Apply mapping to">
        {(["Entire", "Selected"] as MappingScope[]).map((scope) => <button type="button" key={scope} className={`map-chip ${mappingScope === scope ? "is-active" : ""}`} disabled={scope === "Selected" && !selection} onClick={() => setMappingScope(scope)}>{scope}</button>)}
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Planar" ? "is-active" : ""}`} onClick={run(() => applyMapping("Planar"))}><ArrowRightToLine /><span>Planar</span></button>
        <div className="map-options">{(["X", "Y", "Z"] as UVAxis[]).map((axis) => <button type="button" key={axis} className={`map-opt ${mapping === "Planar" && planarAxis === axis ? "is-active" : ""}`} aria-label={`Planar axis ${axis}`} onClick={run(() => { setPlanarAxis(axis); applyMapping("Planar", axis); })}>{axis}</button>)}</div>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${planarStretch ? "is-active" : ""}`} onClick={run(() => { setPlanarStretch(true); applyMapping("Planar", planarAxis, true); })}><Scaling /><span>Stretch to fit</span></button>
        <button type="button" className={`map-main ${!planarStretch ? "is-active" : ""}`} onClick={run(() => { setPlanarStretch(false); applyMapping("Planar", planarAxis, false); })}><RulerDimensionLine /><span>Maintain ratio</span></button>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Box" ? "is-active" : ""}`} onClick={run(() => applyMapping("Box"))}><Package /><span>Box</span></button>
        <div className="map-options">
          <button type="button" className={`map-opt ${mapping === "Unfold Box" ? "is-active" : ""}`} title="Unfold Box" aria-label="Unfold Box" onClick={run(() => applyMapping("Unfold Box"))}><PackageOpen />Unfold</button>
          <button type="button" className={`map-opt ${mapping === "Layout Islands" ? "is-active" : ""}`} title="Layout Islands" aria-label="Layout Islands" onClick={run(() => applyMapping("Layout Islands"))}><LayoutTemplate />Layout</button>
        </div>
      </div>
      <div className="map-row">
        <span className="map-main map-static"><span className="map-note">Island angle (Layout)</span></span>
        <div className="map-options"><input className="map-input" type="number" inputMode="decimal" min={1} max={180} step={1} value={islandAngle} aria-label="Layout Islands angle threshold in degrees" onChange={(event) => setIslandAngle(clampNumber(event.target.value, 1, 180, 45))} /><span className="map-unit">°</span></div>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Cylindrical" ? "is-active" : ""}`} onClick={run(() => applyMapping("Cylindrical"))}><Database /><span>Cylindrical</span></button>
        <div className="map-options"><button type="button" className={`map-opt ${mapping === "Cylinder Caps" ? "is-active" : ""}`} title="Cylinder with caps" aria-label="Cylinder with caps" onClick={run(() => applyMapping("Cylinder Caps"))}><Blend />Caps</button></div>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Sphere" ? "is-active" : ""}`} onClick={run(() => applyMapping("Sphere"))}><Globe /><span>Sphere</span></button>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Auto Unwrap" ? "is-active" : ""}`} onClick={run(() => applyMapping("Auto Unwrap"))}><CpuAi /><span>Auto Unwrap</span></button>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Custom Unwrap" ? "is-active" : ""}`} onClick={run(() => applyMapping("Custom Unwrap"))}><SquareScissors /><span>Custom Unwrap</span></button>
        <span className="map-note">{seamTotal} seam{seamTotal === 1 ? "" : "s"}</span>
      </div>
      <div className="map-row">
        <button type="button" className={`map-main ${mapping === "Original" ? "is-active" : ""}`} disabled={!hasOriginalUVs} onClick={run(() => applyMapping("Original"))}><LandPlot /><span>Original</span></button>
      </div>
      <div className="map-row">
        <button type="button" className="map-main" disabled><Camera /><span>Snapshot</span></button>
        <button type="button" className="map-main" onClick={run(fillScreen)}><Focus /><span>Fill Screen</span></button>
      </div>
    </div>;
  };
  const repackPanel = (close: () => void) => <div className="map-panel">
    <div className="map-row is-first">
      <span className="map-main map-static"><Grid2x2Plus /><span>Margin</span></span>
      <div className="map-options"><input className="map-input" type="number" inputMode="numeric" min={0} max={64} step={1} value={islandMargin} aria-label="Island margin in pixels" onChange={(event) => setIslandMargin(Math.round(clampNumber(event.target.value, 0, 64, 0)))} /><span className="map-unit">px</span></div>
    </div>
    <div className="map-row">
      <button type="button" className="map-main" onClick={() => { repackIslands(); close(); }}><LayoutGrid /><span>Repack Islands</span></button>
    </div>
  </div>;
  const wirePanel = (close: () => void) => <div className="map-panel">
    <div className="map-row is-first">
      <button type="button" className={`map-main ${wireframe ? "is-active" : ""}`} onClick={() => { toggleWireframe(); close(); }}><SquareDashed /><span>{wireframe ? "Wireframe On" : "Wireframe Off"}</span></button>
    </div>
    <div className="map-row">
      <span className="map-main map-static"><Contrast /><span>Opacity</span></span>
      <div className="map-options"><input className="map-input" type="number" inputMode="decimal" min={0} max={1} step={0.05} value={modelOpacity} aria-label="Model opacity from 0 to 1" onChange={(event) => { opacityTouched.current = true; setModelOpacity(clampNumber(event.target.value, 0, 1, 1)); }} /></div>
    </div>
    <div className="map-row">
      <button type="button" className="map-main" onClick={() => { setNotice("Front-facing picking on"); close(); }}><span>Front facing only</span></button>
    </div>
    <div className="map-row">
      <button type="button" className="map-main" onClick={() => { toggleWireframe(); close(); }}><span>X-ray (no limits)</span></button>
    </div>
  </div>;
  const seamMenu: MenuItem[] = [
    { label: "Cut seams", icon: <Scissors />, disabled: !selection, action: markSeams },
    { label: "Clear all seams", icon: <Trash2 />, disabled: seamTotal === 0, action: clearAllSeams },
  ];
  const backgroundIcons: Record<UVBackground, ReactNode> = {
    checker: <CheckerboardIcon />,
    grid: <Grid2X2 />,
    texture: <ImageIcon />,
    colour: <span className="uv-colour-icon" style={{ backgroundColor: uvColour }}><Palette /></span>,
  };
  const backgroundMenu: MenuItem[] = [
    { label: "Checkerboard", icon: <CheckerboardIcon />, active: uvBackground === "checker", action: () => setUvBackground("checker") },
    { label: "Default Grid", icon: <Grid2X2 />, active: uvBackground === "grid", action: () => setUvBackground("grid") },
    { label: "Texture", icon: <ImageIcon />, disabled: !textureUrl, active: uvBackground === "texture", action: () => setUvBackground("texture") },
    { label: "Colour", icon: <span className="uv-colour-icon" style={{ backgroundColor: uvColour }}><Palette /></span>, active: uvBackground === "colour", action: () => { setUvBackground("colour"); colourInput.current?.click(); } },
    { label: "Materials", icon: <Layers3 />, action: () => setMaterialsOpen(true) },
  ];
  const zoomMenu: MenuItem[] = [
    { label: "Zoom Extents", icon: <Focus />, action: () => fitUvView(false) },
    { label: "Zoom Selected", icon: <Focus />, disabled: !selection, action: () => fitUvView(true) },
    { label: "Fill Screen", icon: <ZoomIn />, separated: true, action: () => fitUvView(false) },
  ];
  const undoMenu: MenuItem[] = [
    { label: "Undo", icon: <Undo2 />, disabled: !history.length, action: undo },
    { label: "Redo", icon: <Redo2 />, disabled: !future.length, action: redo },
  ];
  const hideMenu: MenuItem[] = tab === "uvw" ? [
    { label: "Hide Selection", icon: <EyeClosed />, disabled: !selection, action: hideUvSelection },
    { label: "Hide Unselected", icon: <EyeOff />, disabled: !selection, action: hideUnselectedUv },
    { label: "Show Hidden", icon: <Eye />, disabled: hiddenUvFaces.size === 0, action: showUvHidden },
    { label: "Vibration", icon: <Vibrate />, checked: vibrationEnabled, separated: true, action: toggleVibration },
  ] : [
    { label: "Hide Selection", icon: <EyeClosed />, disabled: !selectedMesh, action: hideSelection },
    { label: "Hide Unselected", icon: <EyeOff />, disabled: !selectedMesh, action: hideUnselected },
    { label: "Show Hidden", icon: <Eye />, action: showHidden },
    { label: "Vibration", icon: <Vibrate />, checked: vibrationEnabled, separated: true, action: toggleVibration },
  ];
  const showUVNumberBar = tab === "uvw" && (transformMode === "Rotate" || ((transformMode === "Move" || transformMode === "Scale") && transformAxis !== "free"));
  const numberBarLabel = transformMode === "Rotate" ? "Angle°" : transformMode === "Move" ? `Move ${transformAxis.toUpperCase()}` : `Scale ${transformAxis.toUpperCase()}`;
  const transformButtonLabel = transformMode === "Select" ? `Transform: ${selectionMode}` : `Transform: ${transformMode}${transformAxis === "free" ? "" : ` · ${transformAxis.toUpperCase()} axis`}`;
  const viewMenu: MenuItem[] = [{ label: "Perspective", active: view === "persp", action: () => setView("persp") }, { label: "Orthographic", active: view === "ortho", action: () => setView("ortho") }, ...(["front", "back", "left", "right", "top", "bottom"] as ViewName[]).map((item) => ({ label: `${item.charAt(0).toUpperCase()}${item.slice(1)}`, active: view === item, action: () => setView(item) }))];
  const tabs = [["import", Upload, "Import"], ["view", Box, "3D View"], ["uvw", LayoutDashboard, "UVW"], ["export", Download, "Export"]] as const;
  const touchGestures = useUVTouchGestures(uvFrameRef, uvView, setUvView);
  const slotGroups = materialMode === "gltf"
    ? [{ title: `CORE (${GLTF_CORE_SLOT_COUNT})`, slots: gltfSlots.slice(0, GLTF_CORE_SLOT_COUNT) }, { title: "KHR EXTENSIONS", slots: gltfSlots.slice(GLTF_CORE_SLOT_COUNT) }]
    : [{ title: "", slots: objSlots }];
  const renderSlot = (label: string, detail: string) => {
    const key = textureSlotKey(materialMode, label); const asset = slots[key];
    return <div className="slot-row" key={key}>
      <button className={`slot-select ${activeSlot === key && asset ? "is-active" : ""}`} type="button" disabled={!asset} onClick={() => { if (!asset) return; const assigned = applyTextureToSlot(object, materialMode, label, asset.texture); if (!assigned) { setError(`${label} is not supported by the current model material.`); return; } setActiveSlot(key); setTextureUrl(asset.url); if (isBaseColorSlot(materialMode, label)) { setTexture(asset.texture); setTextureFile(asset.file); } commit(`${label} texture applied`); }} aria-label={`Use ${label} for UV preview`} />
      {asset && <img className="slot-thumbnail" src={asset.url} alt="" />}
      <div className="slot-text"><strong>{label}</strong><span>{detail}</span></div>
      <div className="slot-actions">
        {asset && <button className="slot-clear" type="button" aria-label={`Clear ${label}`} onClick={() => { checkpoint(); applyTextureToSlot(object, materialMode, label, null); revokeTextureObjectUrl(asset.url); setSlots((current) => { const next = { ...current }; delete next[key]; return next; }); if (activeSlot === key) { if (isBaseColorSlot(materialMode, label)) { setTexture(null); setTextureFile(null); } setTextureUrl(null); } commit(`${label} texture cleared`); }}><Trash2 /></button>}
        <button className="slot-upload" type="button" onClick={() => { setPendingSlot({ mode: materialMode, label }); slotInput.current?.click(); }} aria-label={`Assign texture to ${label}`}><Upload /></button>
      </div>
    </div>;
  };
  return <main className="editor-shell">
    <header className="editor-header"><div className="brand-mark"><span>U</span><span>V</span><span>W</span></div><div className="file-status"><strong>{modelName}</strong><span>{notice}</span></div><button className="close-button" type="button" aria-label="Clear workspace" title="Clear workspace" onClick={() => selectPrimitive("Box")}><X /></button></header>
    <nav className="tab-bar" aria-label="Editor sections">{tabs.map(([id, Icon, label]) => <button type="button" key={id} className={`tab-button ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}</nav>
    {(tab === "view" || tab === "uvw") && <div className="tool-strip">
      <ToolButton label="Lock viewport" active={locked} onClick={() => setLocked(!locked)}>{locked ? <Lock /> : <Unlock />}</ToolButton>
      <ToolButton label="Hide selection" active={hidden || (tab === "uvw" && hiddenUvFaces.size > 0)} onClick={hideActiveSelection} quick={tab === "uvw" ? hideActiveSelection : undefined} longPressMenu={tab === "uvw"} menu={hideMenu}><Eye /></ToolButton>
      <ToolButton label={`Element type: ${elementType}`} active menu={elementMenu}>{elementIcons[elementType]}</ToolButton>
      {tab === "view" ? <ToolButton label={`Selection mode: ${selectionMode}`} active={selectionMode !== "Select"} menu={selectionMenu}>{selectionModeIcons[selectionMode]}</ToolButton> : <ToolButton label={transformButtonLabel} active={transformMode !== "Select" || selectionMode !== "Select"} longPressMenu grid={transformGrid}>{transformIcon}</ToolButton>}
      {tab === "view" && <ToolButton label="Wireframe and opacity" active={wireframe} panel={wirePanel}><SquareDashed /></ToolButton>}
      {tab === "view" && <ToolButton label="View mode" active={view !== "persp"} onClick={() => setView(view === "ortho" ? "persp" : "ortho")} menu={viewMenu}><SwitchCamera /></ToolButton>}
      <ToolButton label="Mapping" active quick={tab === "uvw" ? () => applyMapping(mapping) : undefined} longPressMenu={tab === "uvw"} panel={mapPanel}><MapIcon /></ToolButton>
      {tab === "view" ? <ToolButton label="Cut seams" quick={markSeams} longPressMenu menu={seamMenu}><Scissors /></ToolButton> : <ToolButton label="Repack islands" active={mappingScope === "Selected"} quick={repackIslands} longPressMenu panel={repackPanel}><LayoutGrid /></ToolButton>}
      {tab === "uvw" && <ToolButton label={`Texture background: ${uvBackground}`} active={uvBackground !== "checker"} menu={backgroundMenu}>{backgroundIcons[uvBackground]}</ToolButton>}
      <ToolButton label="Zoom" quick={tab === "uvw" ? () => fitUvView(false) : undefined} longPressMenu={tab === "uvw"} onClick={() => { if (tab === "view") setFocusNonce((value) => value + 1); }} menu={tab === "uvw" ? zoomMenu : [{ label: "Zoom Extents", action: () => setFocusNonce((value) => value + 1) }, { label: "Zoom Selected", disabled: !selectedMesh, action: () => setFocusNonce((value) => value + 1) }]}><ZoomIn /></ToolButton>
      {tab === "uvw" ? <ToolButton label="Undo / Redo" disabled={!history.length && !future.length} quick={undoRedoTap} longPressMenu menu={undoMenu}><Undo2 /></ToolButton> : <><ToolButton label="Undo" disabled={!history.length} onClick={undo}><Undo2 /></ToolButton><ToolButton label="Redo" disabled={!future.length} onClick={redo}><Redo2 /></ToolButton></>}
    </div>}
    {showUVNumberBar && <div className="number-bar"><label>{numberBarLabel}<input type="number" value={numericValue} disabled={!selection} onChange={(event) => setNumericValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") performTransform(); }} /></label><button type="button" disabled={!selection} onClick={performTransform}>Apply</button></div>}
    <section className={`workspace workspace-${tab}`}>
      {tab === "import" && <div className="import-panel"><div className="intro"><span className="eyebrow">01 / SOURCE</span><h1>UVW Mapping Tool</h1><p>Import a model or start from a primitive</p></div>{error && <div className="error-banner" role="alert">{error}</div>}<button type="button" className="primary-action" disabled={importing} onClick={() => modelInput.current?.click()}><Upload />{importing ? "Importing…" : "Import Model"}<small>OBJ · GLB · glTF · STL · 3MF · FBX · PLY · DAE · STEP · IGES · ZIP</small></button><p className="import-format-hint">For glTF, OBJ/MTL, FBX, or COLLADA with external resources, select companion files or a ZIP. STEP/IGES are converted to triangle meshes for UV editing.</p><div className="secondary-actions"><button type="button" onClick={() => textureInput.current?.click()}><ImageIcon />Import Texture</button><button type="button" onClick={() => setMaterialsOpen(true)}><Layers3 />Materials</button></div>{textureUrl && <div className="texture-loaded"><img src={textureUrl} alt="Imported texture thumbnail" /><span>Texture loaded</span></div>}<div className="primitive-panel"><div className="section-label"><Shapes />Primitives</div><div className="primitive-grid">{primitives.map((name) => <button type="button" key={name} title={`Replace model with ${name}`} className={primitive === name ? "is-selected" : ""} onClick={() => selectPrimitive(name)}>{name}</button>)}</div></div><p className="stats">Current: {modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p></div>}
      <div className="viewport-wrap" style={{ display: tab === "view" ? undefined : "none" }}><Viewport3D object={object} locked={locked} view={view} focusNonce={focusNonce} selection={selection} elementType={elementType} selectionMode={selectionMode} onSelect={(mesh, hit, element, mode) => { setSelection((current) => updateSelection(current, object, mesh, hit, element, mode)); if (vibrationEnabled) navigator.vibrate?.(15); setNotice(`${element} · ${mode}`); }} onClearSelection={() => { setSelection(null); setNotice("Selection cleared"); }} savedCamera={savedCameraRef.current} onCameraSave={saveCamera} /><span className="view-label">{view.toUpperCase()}</span>{locked && view !== "persp" && <button type="button" className="unlock-view" onClick={() => { setLocked(false); setView("persp"); }}>Unlock view</button>}<div className="viewport-info"><span>{modelName}</span><strong>{stats.faces.toLocaleString()} tris</strong></div></div>
      {tab === "uvw" && <div className="uv-stage"><UVWorkspace
        object={object}
        selection={selection}
        elementType={elementType}
        selectionMode={selectionMode}
        transformMode={transformMode}
        transformAxis={transformAxis}
        locked={locked}
        background={uvBackground}
        colour={uvColour}
        textureUrl={textureUrl}
        hiddenFaces={hiddenUvFaces}
        uvView={uvView}
        setUvView={setUvView}
        frameRef={uvFrameRef}
        onSelect={(mesh, hit, element, mode) => { setSelection((current) => updateSelection(current, object, mesh, hit, element, mode)); if (vibrationEnabled) navigator.vibrate?.(15); setNotice(`${element} · ${mode}`); }}
        onClearSelection={() => { setSelection(null); setNotice("Selection cleared"); }}
        onTransformStart={checkpoint}
        onTransformFinish={commit}
        onTouchStart={touchGestures.onTouchStart}
        onTouchMove={touchGestures.onTouchMove}
        onTouchEnd={touchGestures.onTouchEnd}
        status={`${modelName} · ${stats.faces.toLocaleString()} tris · ${textureFile?.name ?? "no active texture"}`}
      /> </div>}
      {tab === "export" && <div className="export-panel">
        <span className="eyebrow">04 / OUTPUT</span><h1>Export</h1>
        <p>Choose a file format. Texture, UV, and material support differs by format; text copies may be large.</p>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="export-list">
          <button type="button" onClick={() => confirmTexture(() => void exportGlb(object, `${exportFileStem}.glb`))}><Box /><span><strong>GLB (.glb)</strong><small>Single-file model with UVs and supported materials/textures</small></span><Download /></button>
          <button type="button" onClick={() => confirmTexture(() => void downloadFbx())}><Box /><span><strong>FBX (.fbx)</strong><small>Binary; includes bones, skin weights, and imported animation clips when present. PBR materials convert to FBX Phong.</small></span><Download /></button>
          <button type="button" onClick={() => confirmTexture(() => void exportGltf(object, `${exportFileStem}.gltf`))}><Box /><span><strong>glTF JSON (.gltf)</strong><small>Text-based JSON with embedded geometry and images</small></span><Download /></button>
          <button type="button" onClick={() => exportObj(object, `${exportFileStem}.obj`)}><Box /><span><strong>OBJ (.obj)</strong><small>Plain-text mesh with UVs/normals; no embedded texture</small></span><Download /></button>
          <button type="button" onClick={() => confirmTexture(() => void downloadObjZip())}><Box /><span><strong>OBJ + MTL + texture (.zip)</strong><small>OBJ package with the uploaded base-color image, if any</small></span><Download /></button>
          <button type="button" onClick={() => exportStl(object, `${exportFileStem}.stl`)}><Box /><span><strong>STL (.stl)</strong><small>Binary surface geometry only; no UVs, textures, or units</small></span><Download /></button>
          <button type="button" onClick={() => exportPly(object, `${exportFileStem}.ply`)}><Box /><span><strong>PLY ASCII (.ply)</strong><small>Mesh attributes and UVs where present; no texture images</small></span><Download /></button>
          <button type="button" onClick={downloadUv}><ImageIcon /><span><strong>UV Layout PNG</strong><small>1024 × 1024 wireframe preview</small></span><Download /></button>
        </div>
        <p className="stats">{modelName} · {stats.faces.toLocaleString()} faces · {stats.vertices.toLocaleString()} verts</p>
        <div className="hidden-canvas"><UVCanvas object={object} hiddenFaces={hiddenUvFaces} textureUrl={textureUrl} background={uvBackground} colour={uvColour} canvasRef={uvCanvasRef} uvNonce={history.length + future.length} uvView={DEFAULT_UV_VIEW} /></div>
      </div>}
    </section>
    <input ref={modelInput} className="sr-only" type="file" multiple onChange={(event) => void onModel(event)} /><input ref={textureInput} className="sr-only" type="file" accept="image/*" onChange={onTexture} /><input ref={slotInput} className="sr-only" type="file" accept="image/*" onChange={onSlotTexture} /><input ref={colourInput} className="sr-only" type="color" value={uvColour} onChange={(event) => { setUvColour(event.target.value); setUvBackground("colour"); }} />
    {texturePrompt && <div className="modal-scrim texture-prompt-scrim"><section className="texture-prompt" role="dialog" aria-modal="true" aria-labelledby="texture-prompt-title" aria-describedby="texture-prompt-description"><span className="eyebrow">TEXTURE</span><h2 id="texture-prompt-title">Add a texture?</h2><p id="texture-prompt-description">This model has no active texture. Choose an image from Files or Photos to apply it to the model.</p><div className="texture-prompt-actions"><button type="button" className="texture-prompt-secondary" onClick={() => setTexturePrompt(false)}>Not now</button><button type="button" className="texture-prompt-primary" onClick={() => { setTexturePrompt(false); textureInput.current?.click(); }}>Choose texture</button></div></section></div>}
    {materialsOpen && <div className="modal-scrim" onMouseDown={(event) => { if (event.currentTarget === event.target) setMaterialsOpen(false); }}><section className="materials-modal" role="dialog" aria-modal="true" aria-labelledby="materials-title"><header><div><h2 id="materials-title"><Layers3 />Materials</h2><p>Assign textures to material slots and choose which slot drives the active UVW texture.</p></div><button type="button" onClick={() => setMaterialsOpen(false)} aria-label="Close materials"><X /></button></header><div className="mode-switch"><button type="button" className={materialMode === "gltf" ? "is-active" : ""} onClick={() => setMaterialMode("gltf")}>GLB / glTF (PBR)</button><button type="button" className={materialMode === "obj" ? "is-active" : ""} onClick={() => setMaterialMode("obj")}>OBJ / MTL</button></div><div className="slot-list">{slotGroups.map((group) => <div className="slot-group" key={group.title || materialMode}>{group.title && <h3 className="slot-heading">{group.title}</h3>}{group.slots.map(([label, detail]) => renderSlot(label, detail))}</div>)}</div><footer>Active UVW texture: {activeSlot.split(":").slice(1).join(":")}{slots[activeSlot] ? ` · ${slots[activeSlot].file.name}` : " · none"}</footer></section></div>}
  </main>;
}
