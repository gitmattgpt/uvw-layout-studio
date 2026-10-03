# UVForge Controls and Menus

## What I’ll build
- Turn the existing toolbar icons into working controls following the guide’s tap, press-and-hold, and double-tap behavior.
- Add the documented 3D viewport tools: viewport lock, hide/show states, element and selection modes, wireframe options, perspective/orthographic and named views, mapping choices, seam feedback, zoom, and undo/redo.
- Add the documented UV editor tools: selection and transform modes, axis constraints, numeric transform bar, mapping, island repacking, background choices, zoom, and undo/redo.
- Complete import and export states: STL support, loading/error feedback, texture-loaded indicator, missing-texture prompts, and correct OBJ/MTL/texture packaging.
- Upgrade Materials so each slot can receive, preview, activate, and clear its own texture.
- Do not add a Help tab, Help button, embedded guide, or PDF viewer.

## Interaction design
- A tap runs the primary action immediately.
- A press-and-hold opens the full tool menu.
- A double-tap opens the short quick menu where the guide defines one.
- Tool menus will be touch-friendly popovers anchored to the toolbar, with current choices and disabled states clearly shown.
- Actions that cannot apply without a selection or texture will remain visible but disabled rather than silently doing nothing.

## Technical details
- Keep all model files, textures, edits, history, and downloads local to the browser.
- Add STLLoader beside the current OBJ and glTF loaders.
- Preserve imported UV coordinates so Original can restore them.
- Implement practical mesh selection/hiding and UV transforms with Three.js geometry attributes and ray picking.
- Implement Planar, Box, and Cylindrical projection locally. Auto Unwrap will use a deterministic browser-local projection and island packing pass; seam cutting will mark/split selected boundaries for subsequent unwraps.
- Maintain bounded undo/redo snapshots for model visibility, UV coordinates, selection, and transform changes.
- Extend the 3D viewport interface for camera commands, locking, picking, hidden geometry, view flashes, and framing.
- Extend the UV canvas into an interactive editor with hit testing, marquee selection, transforms, panning, zooming, and backgrounds.
- Preserve the current mobile-first layout and existing visual system while fitting the contextual menus and number bar safely on phone and desktop screens.

## Validation
- Test OBJ, GLB/glTF, and STL import states plus image texture assignment.
- Exercise tap, hold, and double-tap menus on touch-sized and desktop viewports.
- Verify 3D camera, hide/show, mapping, UV transforms, backgrounds, material slots, undo/redo, and all three downloads.
- Confirm the Help feature is absent and the preview has no build, runtime, or console errors.
