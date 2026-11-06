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

## How the model works

The "model" is a pipeline, not a trained network: a multimodal LLM reads Street View photos of a sampled building and reports storeys and use, and a fixed lookup turns those into a height that is compared with the GBA height. Nothing is fitted to GBA, so the comparison is independent of it.

1. **Sample (`lcz_sample_frame.py`).** Buildings of 30 m² or more are classed by the global 100 m Local Climate Zone map (Demuzere et al. 2022). Only buildings whose whole 3x3 LCZ neighbourhood has the same class are kept, so each one is representative of its zone, and drawn buildings are at least 150 m apart. Draws are allocated across LCZ classes by Neyman allocation (class size x the spread of GBA heights in that class, as a stand-in for storey spread), with a floor of 25 usable labels per class. The draw is larger than the target because only about 27% of draws end up with a usable label.
2. **Views (`streetview_multiview.py`).** For each building, free Street View metadata lookups are made at the centroid and eight points on a 25 m ring. Candidate panoramas are kept if they are 6-35 m from the building and no other footprint over 20 m² blocks the line of sight. They are ranked by closeness to 15 m, and up to 3 are kept with headings at least 30° apart. Only then are images fetched (billed, 640x640, with the field of view set from the footprint width and distance). Buildings with no clear view drop out here: 61% of Chiang Mai sample buildings keep at least one view, 21% in Jos.
3. **Label (`classify_gemini.py`).** All views of a building go to Gemini in one request (default `gemini-3.1-flash-lite`, temperature 0, JSON output forced by a schema). The prompt asks, per view, whether the target building is actually visible, then for one consensus answer: above-ground `storeys` (null if it cannot be judged), `use` (residential, commercial, mixed, institutional, industrial, ancillary, vacant, unknown), `confidence`, and a free-text `note`. It is told to be conservative: if views disagree about which building is the target, storeys is null. With `--hints-sample`, each photo gets red tick marks on the vertical line through the target's centre, plus the camera distance and mapped footprint area. A second model (`gemini-3-flash`) was run over the same views and is shown in the viewer as a second opinion only; it is not merged into the labels.
4. **Height (`apply_labels.py`, `common.py`).** `height = storeys x floor height for the use + roof allowance`. Floor heights are 3.0 m residential, 3.2 m institutional, commercial and mixed, 4.5 m industrial, 3.0 m ancillary. The roof allowance is 0 m, because the shophouses checked so far have flat roofs. Vacant buildings get 0 m. These are placeholders, not measurements, and the viewer's About tab shows the values in use.
5. **Compare.** The LLM height is compared with the GBA height per building. For Chiang Mai (538 buildings with an LLM height) the mean absolute difference is about 2.1 m, the LLM is 0.3 m taller on average, and the correlation is low (0.18). There is no ground truth yet, so a difference does not say which source is right.

### Known limits

- Heights are steps (storeys x a fixed floor height), so they cannot match GBA's continuous values.
- Roofs are sometimes cropped out of the frame, so tall buildings can be undercounted or flagged.
- The Jos sample is biased to street-facing buildings, because only those can have a clear view.
- The prompt and the floor heights were written for Chiang Mai; Jos reuses them unchanged.
- The model is not told the building's mapped height, so it cannot anchor on GBA.
- Photo dates differ between buildings (Jos captures are 2022-2024), and a building may have changed since.

## Web viewer (`webapp/`)

Static React + MapLibre app: all GBA footprints (PMTiles), switch between GBA height / LLM height / difference, 3D extrusion, filters, scatter plot, and per-building image inspection.

- Build data: `.venv/bin/python scripts/export_web.py chiang_mai --gba … --sample … --labels outputs/final_labelled.csv --multiview outputs/full/multiview.csv outputs/full2/multiview.csv --second-pass outputs/second_pass_gemini3flash.csv` (about 5 min; writes `webapp/public/data/<city>/`, gitignored)
- Add the city to `webapp/public/data/cities.json`
- Dev: `cd webapp && npm install && npm run dev`
- Deploy: `npm run build && firebase deploy --only hosting` (needs `firebase login` and a project id in `.firebaserc`)

### Embedded 360° Street View (optional, free)

The "Explore in 360°" button uses the Google Maps Embed API. Create a key in Google Cloud: enable "Maps Embed API", then restrict the key to that API and to HTTP referrers (`http://127.0.0.1:*`, `http://localhost:*`, your Firebase domain). Put it in `webapp/.env.local` as `VITE_GMAPS_EMBED_KEY=...` and rebuild. The key ends up in the public bundle, so never use the unrestricted pipeline key from `.env.toml`. Without a key the button falls back to a Google Maps link.
