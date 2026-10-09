# STEP/IGES browser parser assets

This directory contains the browser build of **occt-import-js 0.0.23**, by kovacsv, from <https://github.com/kovacsv/occt-import-js>.

- `occt-import-js.js` and `occt-import-js.wasm` are the parser runtime and its WebAssembly module.
- The runtime is loaded only when a user imports a STEP or IGES file.
- The parser returns triangulated geometry for the editor; it does not preserve editable CAD feature history.

License texts are retained in `LICENSE.md`, `license.occt-import-js.txt`, and `license.occt.txt`. The project identifies occt-import-js as LGPL-2.1; consult the included notices for the applicable terms. The upstream repository includes the parser source and build instructions.
