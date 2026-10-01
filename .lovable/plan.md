# UVW Editor Foundation

## What I’ll build
- Recreate the supplied dark mobile-first editor layout at `/`, with the four top work areas: Import, 3D View, UVW, and Export.
- Keep the same restrained charcoal, warm ivory, muted gray, and orange visual system, with compact square tool controls and fixed workspace proportions.
- Add responsive desktop behavior while preserving the supplied phone layout and spacing.

## Working foundation
- Import local `.obj`, `.glb`, and `.gltf` models directly in the browser.
- Import an image texture and apply it to the active model.
- Include Box, Sphere, Cylinder, Torus, Knot, and Plane starter shapes.
- Provide an orbitable 3D preview with checker texture fallback and basic framing.
- Generate basic planar UV coordinates and show the resulting triangle layout over a checker/image backdrop.
- Add initial client-side exports for GLB, OBJ, and UV layout PNG.
- Build the Materials panel shell from the references so its individual controls can be specified next.

## Technical details
- Use Three.js with React Three Fiber and Drei on a client-only TanStack route.
- Parse user-selected files locally; no uploads or server storage are required.
- Preserve model geometry state between the Import, 3D View, UVW, and Export work areas.
- UV layout PNG export will draw the current UV topology to a canvas.
- Add accessible labels/tooltips and validate the central import → preview → UV → export flow on phone and desktop sizes.
