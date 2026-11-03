import { afterEach, expect, test } from "bun:test";
import { downloadBlob, saveFile } from "./file-save";

afterEach(() => { delete (globalThis).window; delete (globalThis).document; });

test("regular downloads preserve every supported native file extension", () => {
  const saved = [];
  const anchor = { href: "", download: "", click: () => saved.push(anchor.download), remove: () => {} };
  Object.assign(globalThis, {
    document: { createElement: () => anchor, body: { appendChild: () => {} } },
    window: { setTimeout: () => 0 },
  });
  for (const extension of ["glb", "fbx", "gltf", "obj", "zip", "stl", "ply", "png"]) {
    downloadBlob(new Blob(["model"]), `model.${extension}`);
  }
  expect(saved).toEqual(["model.glb", "model.fbx", "model.gltf", "model.obj", "model.zip", "model.stl", "model.ply", "model.png"]);
});

test("Save to Files writes the original binary blob and filename", async () => {
  let name = "";
  let written;
  let closed = false;
  Object.assign(globalThis, { window: { showSaveFilePicker: async (options) => {
    name = options.suggestedName;
    return { createWritable: async () => ({ write: async (blob) => { written = blob; }, close: async () => { closed = true; } }) };
  } } });
  const blob = new Blob([new Uint8Array([0, 255, 42])], { type: "model/gltf-binary" });
  await saveFile(blob, "model.glb");
  expect(name).toBe("model.glb");
  expect(written).toBe(blob);
  expect(closed).toBe(true);
});