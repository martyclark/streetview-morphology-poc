# scripts

## Overview

Command-line pipeline that turns a city's Global Building Atlas (GBA) footprints into a Street View labelled sample and a static web export. Each file is a standalone script run with `python scripts/<name>.py`. Files hand data to each other through CSV and GeoPackage files on disk, not through imports. Run order: `lcz_sample_frame.py` → `streetview_pilot.py` or `streetview_multiview.py` → `contact_sheets.py` (optional manual labelling) or `classify_gemini.py` → `apply_labels.py` → `export_web.py`. `mapillary_coverage.py` is a separate coverage check.

## Interface

- `common.py`: `FLOOR_H` (storey height by use), `ROOF` (roof allowance, currently 0.0 for flat roofs; both are placeholders), `LCZ_URL` (global LCZ raster, also used by `lcz_sample_frame.py`), `fov_deg`. Imported as `common`, which works because Python puts the script's directory on `sys.path`.

Each script's entry point is `main()` guarded by `if __name__ == "__main__"`, except `apply_labels.py` and `contact_sheets.py`, which run at module level and read `sys.argv` positionally.

- `lcz_sample_frame.py` (`main`): `gpkg out [--allocation equal|proportional|neyman] [--usable-target 300] [--floor 25] [--yield-rate 0.27] [--min-area 30] [--min-spacing 150]`. Reads GBA footprints, assigns each an LCZ class from the remote raster `LCZ_URL`, and writes a stratified sample GeoPackage with `lcz` and `lcz_name` columns. Constant `LCZ_NAMES`.
- `streetview_pilot.py` (`main`, `api_key`, `bearing`): `sample buildings outdir [--per-class 15] [--fetch-images]`. One nearest panorama per building. Writes `outdir/pilot.csv` and, with `--fetch-images`, `outdir/img/lcz<lcz>_<fid>.jpg`. Constants `META`, `IMG`, `MAX_DIST`.
- `streetview_multiview.py` (`main`, `api_key`, `bearing`, `hdiff`): `sample buildings outdir [--views 3] [--min-heading-sep 30] [--fetch-images] [--max-image-requests 200] [--per-class N] [--skip-done multiview.csv]`. Writes `outdir/multiview.csv` (columns `fid, lcz, view, n_candidates, pano_id, date, dist_m, heading, blockers, img`) and `outdir/img/lcz<lcz>_<fid>_v<j>.jpg`. Constants `RING_M`, `MIN_D`, `MAX_D`.
- `contact_sheets.py` (module level): `multiview.csv outdir`. Writes `outdir/sheet_<nn>_fids_<a>_<b>.jpg`, two buildings per sheet. Constant `TILE`.
- `classify_gemini.py` (`main`, `classify`, `marked_jpeg`, `api_key`): `multiview out [--model gemini-3.1-flash-lite] [--sleep 4] [--hints-sample sample.gpkg]`. Writes a CSV with `fid, lcz, n_views, storeys, use, confidence, n_visible, note`. Constants `URL`, `PROMPT`, `HINT_PROMPT`, `SCHEMA`.
- `apply_labels.py` (module level): `pilot.csv labels.csv out.csv`. Joins on `fid`, adds `height_new` and `diff_gba_minus_new`, and prints error statistics. Constants `FLOOR_H`, `ROOF`.
- `export_web.py` (`main`, `build_tiles`, `lcz_features`, `export_lcz`, `height_from`, `view_geometry`, `is_sliver`, `tile_bounds`): `city --gba gpkg [--sample gpkg] [--labels csv] [--multiview csv ...] [--second-pass csv] [--skip-tiles] [--out webapp/public/data]`. Writes `<out>/<city>/buildings.pmtiles`, `samples.geojson`, `lcz.geojson` (one polygon per connected run of equal LCZ codes 1-17 over the city's bounds, property `lcz`), `assumptions.json` (`{floor_h, roof_m}` from `common.py`) and `img/<fid>_<view>.jpg`. LLM heights (`hl`) are computed here with `height_from(storeys, use)`; the `height_new` column in the labels CSV is not read. Constants `FLOOR_H`, `ROOF`, `CAMERA_H`, `PITCH`, `ZOOMS`, `EXTENT`, `MIN_AREA_Z12`.
- `mapillary_coverage.py` (`main`, `fetch_tile`): `gpkg [--n 5000] [--radius 40] [--out gpkg]`. Prints Mapillary coverage statistics for a random building sample. Constants `API`, `TILE_DEG`.

## Invariants

- `fid` is the row index of the sample GeoPackage. `streetview_*`, `classify_gemini.py`, `contact_sheets.py` and `export_web.py` all rely on it (`export_web.py` indexes `sample.geometry[fid]` and asserts every sample building matches a GBA footprint with the same height).
- `FLOOR_H`, `ROOF` and `fov_deg(width_m, dist_m)` live in `common.py` and are imported by `apply_labels.py`, `export_web.py` and (for `fov_deg`) `streetview_pilot.py` and `streetview_multiview.py`. The viewer does not repeat them: it reads the published `assumptions.json`. Changing `common.py` changes the exported heights only after `export_web.py` is re-run, because heights are baked into the tiles.
- `export_web.py` (`view_geometry`) recomputes the field of view to describe the crops the fetch scripts made, so it must keep using `fov_deg`. `streetview_*` take `width` from bounds in UTM metres; `export_web.py` converts degrees to metres with 111320 m/deg.
- `streetview_multiview.py` keeps only panoramas with zero blocking footprints (area > 20 m²) and `MIN_D <= dist_m <= MAX_D`, and fetches images with `pitch=10`, which matches `PITCH` in `export_web.py`.
- `streetview_multiview.py` stops fetching when `--max-image-requests` is reached, writing the rows gathered so far. It also rewrites `multiview.csv` every 25 buildings, so a crash cannot lose the rows for images already billed. Images are billed; metadata calls are not.
- `classify_gemini.py` calls Gemini at temperature 0 with a JSON response schema, and retries HTTP 429, 500 and 503 up to 6 times with exponential backoff.
- `lcz_sample_frame.py` draws with `np.random.default_rng(0)`, so a fixed input gives the same sample.
- `export_web.py` writes tile geometry with exterior rings counter-clockwise (`orient_polygons(exterior_cw=False)`) because GBA mixes ring directions.

## Side Effects

- Network: Google Street View metadata and Static APIs (`streetview_pilot.py`, `streetview_multiview.py`), Gemini `generateContent` (`classify_gemini.py`), Mapillary Graph API (`mapillary_coverage.py`), and a remote range-read of the Zenodo LCZ GeoTIFF through GDAL `/vsicurl/` (`lcz_sample_frame.py` and `export_web.py`, so an export needs network access even when the labels are local).
- Credentials: `GOOGLE_MAPS_API_KEY`, `GEMINI_API_KEY` and `MAPILLARY_TOKEN` are read from the environment. The first two fall back to `.env.toml` at the repository root. Scripts exit with "Set ..." if none is found.
- Disk: each script writes only the output paths named in Interface. `export_web.py` skips existing `img/<fid>_<view>.jpg` files but always rewrites `samples.geojson` and, unless `--skip-tiles`, `buildings.pmtiles`.
- Console: `apply_labels.py`, `lcz_sample_frame.py`, `streetview_*`, `classify_gemini.py` and `mapillary_coverage.py` print their statistics to stdout. `classify_gemini.py` prints per-building errors to stderr and continues.

## Verification

- Run: `pytest tests` from the repository root (needs `pip install -e ".[dev]"`). It covers `fov_deg`, `height_from`, `is_sliver` and `view_geometry`. The CLI wiring of the argparse-based scripts is checked with `python scripts/<name>.py --help`.
