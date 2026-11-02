# streetview-morphology-poc Blueprint

## System Overview

Proof of concept that estimates building height from Street View photos and compares it with Global Building Atlas (GBA) heights. An offline Python pipeline samples buildings stratified by Local Climate Zone, finds and fetches Street View crops, labels storeys and use with Gemini, converts those labels to heights, and exports tiles and JSON. A static React viewer then displays the comparison. See the hand-written [README.md](./README.md) for project background and usage notes; this file only records contracts.

```text
GBA footprints (data/<city>/gba_buildings.gpkg)
   -> scripts/lcz_sample_frame.py   -> sample .gpkg
   -> scripts/streetview_multiview.py -> outputs/.../multiview.csv + img/
   -> scripts/classify_gemini.py    -> labels .csv
   -> scripts/export_web.py         -> webapp/public/data/<city>/
   -> webapp (Vite build)           -> static site
```

## Local Interface & Invariants

- `pyproject.toml`: package `streetview-morphology-poc` 0.1.0, `requires-python >=3.12`, dependencies `geopandas, rasterio, shapely, scipy, pandas, numpy, requests, pyogrio, pillow`. `[tool.setuptools] packages = []`, so nothing is importable as a package; the scripts are run directly.
- `pyproject.toml` also lists `mapbox-vector-tile` and `pmtiles` (used by `scripts/export_web.py`) and a `dev` extra with `pytest`.
- `.env.toml.example` documents `GOOGLE_MAPS_API_KEY`. The real `.env.toml` is gitignored and read by `scripts/streetview_*.py` and `scripts/classify_gemini.py`.

## Subdirectories & System Boundaries

- scripts: [./scripts/EGM.md](./scripts/EGM.md) - command-line pipeline from footprints to web export.
- webapp: [./webapp/EGM.md](./webapp/EGM.md) - static viewer; consumes the export under `webapp/public/data/`.
- data: input GeoPackages per city (`data/chiang_mai`, `data/jos`). `gba_buildings.gpkg` files are gitignored because of GitHub's 100 MB limit. No source code.
- outputs: gitignored intermediate CSVs, logs and images produced by the scripts. No source code.

## Global Invariants

- The files `scripts/export_web.py` writes and `webapp/src/lib.ts` reads must stay in step (`Sample` fields, tile properties `h, fid, hl, dh`).
- The `FLOOR_H` and `ROOF` height assumptions live only in `scripts/common.py`. `scripts/export_web.py` publishes them as `assumptions.json` and the viewer's About tab displays that file.
- The sample's row index is the `fid` used across every CSV and the viewer.

## Global Side Effects

- Paid Google Street View Static API requests and Gemini API requests from the `scripts/`; Street View metadata is free.
- Large local artefacts in `outputs/` and `webapp/public/data/`.

## System Verification

- Run: `pytest tests` (scripts) and `cd webapp && npm test && npm run build` (viewer).
