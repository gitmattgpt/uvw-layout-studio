# UVW Layout Studio

A browser-based UV mapping editor for importing 3D models, assigning material textures, editing UVs, and exporting models.

## Supported model imports

- **OBJ** (`.obj`), with optional `.mtl` files and image textures
- **glTF** (`.gltf`, `.glb`), including Draco-compressed geometry and KTX2 textures
- **STL** (`.stl`)
- **3D Manufacturing Format** (`.3mf`)
- **Autodesk FBX** (`.fbx`)
- **Stanford PLY** (`.ply`)
- **COLLADA** (`.dae`)
- **STEP** (`.step`, `.stp`) and **IGES** (`.iges`, `.igs`) CAD models

For models that reference external files (including `.gltf`, OBJ/MTL, FBX, and COLLADA), select the model and its companion files together, or place the complete set in a `.zip` bundle. GLB and 3MF commonly package their resources inside the model file.

STEP and IGES files are tessellated into triangle meshes for UV editing; parametric CAD solids/features are not retained. The OpenCascade-based WebAssembly parser is loaded only when a STEP or IGES file is imported (about 7.3 MB). Its license notices are included in `public/decoders/step/`.

**`.3ma` is not currently supported.** If you meant `.3mf`, that format is supported.

## Supported model exports

- **GLB** (`.glb`) and **glTF JSON** (`.gltf`), including embedded geometry and supported texture/material data
- **FBX** (`.fbx`) binary export, including bones, skin weights, and imported animation clips when present; physically based materials are converted to FBX Phong, so material appearance may differ
- **OBJ** (`.obj`) as plain text with mesh geometry, UVs, and normals; texture images are provided separately in the optional ZIP package
- **STL** (`.stl`) as binary surface geometry; STL does not preserve UVs, textures, or units
- **PLY** (`.ply`) as ASCII mesh data, including available vertex attributes and UV coordinates; PLY does not include texture images
- **OBJ package** (`.zip`) with an MTL file and the user-uploaded base-color texture, when supplied
- **UV layout preview** (`.png`)

The editor can also create `.txt` copies for paste workflows: OBJ text remains OBJ syntax, and glTF text remains JSON. A GLB text copy is a Base64 data URI for binary GLB data; it is larger than the original file and the receiving service must decode it. A `.txt` extension does not make a new standard 3D format. 3MF, COLLADA, STEP, and IGES are import-only in the current export panel.

## Build with Lovable

This project was built with [Lovable](https://lovable.dev). Continue developing it in the [Lovable editor](https://lovable.dev/projects/75e66b2e-1dc2-474c-a77c-8c43a574ab7e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: push to `main` on GitHub and your changes sync back into Lovable.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
