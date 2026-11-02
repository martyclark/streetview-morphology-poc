# Street View morphology PoC

Estimate building storeys/use from street imagery, sampled by LCZ type and linked to GBA footprints.

- `data/chiang_mai/gba_buildings.gpkg` — GBA footprints (copied from urban-heat-TARGET)
- `data/chiang_mai/lcz_sample.gpkg` — LCZ-stratified sample (351 buildings)
- `scripts/lcz_sample_frame.py` — builds the sample from the global 100 m LCZ map
- `scripts/streetview_pilot.py` — pano coverage / attrition pilot (key in `.env.toml` or `GOOGLE_MAPS_API_KEY`)
- `scripts/streetview_multiview.py` — multi-view candidate selection (9 free metadata calls per building; `--max-image-requests` caps billed images)
- `scripts/apply_labels.py` — merges labels, derives storey-based height
- `data/chiang_mai/lcz_sample_neyman.gpkg` — Neyman-allocated sample (1,072 draws, target 300 usable)
- `scripts/mapillary_coverage.py` — Mapillary alternative (abandoned)
- `outputs/` — pilot results and images (gitignored)

Setup: `/path/to/python3.12 -m venv .venv && .venv/bin/pip install -e .`, then `.venv/bin/python scripts/...`.
`gba_buildings.gpkg` is gitignored (over GitHub 100 MB limit); copy it from `urban-heat-TARGET/data/target/THA_chiang_mai/`.

## Web viewer (`webapp/`)

Static React + MapLibre app: all GBA footprints (PMTiles), switch between GBA height / LLM height / difference, 3D extrusion, filters, scatter plot, and per-building image inspection.

- Build data: `.venv/bin/python scripts/export_web.py chiang_mai --gba … --sample … --labels outputs/final_labelled.csv --multiview outputs/full/multiview.csv outputs/full2/multiview.csv --second-pass outputs/second_pass_gemini3flash.csv` (about 5 min; writes `webapp/public/data/<city>/`, gitignored)
- Add the city to `webapp/public/data/cities.json`
- Dev: `cd webapp && npm install && npm run dev`
- Deploy: `npm run build && firebase deploy --only hosting` (needs `firebase login` and a project id in `.firebaserc`)

### Embedded 360° Street View (optional, free)

The "Explore in 360°" button uses the Google Maps Embed API. Create a key in Google Cloud: enable "Maps Embed API", then restrict the key to that API and to HTTP referrers (`http://127.0.0.1:*`, `http://localhost:*`, your Firebase domain). Put it in `webapp/.env.local` as `VITE_GMAPS_EMBED_KEY=...` and rebuild. The key ends up in the public bundle, so never use the unrestricted pipeline key from `.env.toml`. Without a key the button falls back to a Google Maps link.
