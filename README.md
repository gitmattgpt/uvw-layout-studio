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

For models that reference external files (including `.gltf`, OBJ/MTL, FBX, and COLLADA), select the model and its companion files together, or place the complete set in a `.zip` bundle. GLB and 3MF commonly package their resources inside the model file.

**`.3ma` is not currently supported.** If you meant `.3mf`, that format is supported.

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
