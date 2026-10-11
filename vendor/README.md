# Bundled dependencies

These are local snapshots from the Wireface workspace, taken on 11 October 2026, so builds do not depend on sibling checkouts or a remote model download. Source work in those projects was in progress; these snapshots include their working-tree changes.

- `wireface/core/{canonical-data,canonical,rig-data,rig}.js`: `wireface-core/src/engine/`.
- `wireface/core/mesh-data.js`: `wireface-2d/src/core/engine/mesh-data.js`.
- `wireface/{transfer,prepare-transfer}.js`: `wireface-2d/src/engine/`. The two imports in `prepare-transfer.js` point to the bundled `core/` files.
- `mediapipe/`: MediaPipe Tasks Vision 1.0.1, CPU WASM and face landmarker model, copied from `wireface-site/assets/mediapipe/`. See its README and the root Apache licence.

The desktop logo is checked in under `assets/icons/`; fixture portraits/landmarks from `wireface-core/assets/skins/` are under `test/fixtures/`. Fixture portraits were generated for Wireface.

Retain `LICENSE.md`, `NOTICE` and `licenses/Apache-2.0.txt` when updating or redistributing these files. When refreshing a snapshot, run both the unit and browser checks before packaging.
