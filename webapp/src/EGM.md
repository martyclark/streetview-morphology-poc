# webapp/src

## Overview

Source of the single-page viewer. `main.tsx` mounts `App` in `StrictMode`. `App.tsx` owns all state: it loads the city list and per-city samples, builds a MapLibre map over a PMTiles archive of building footprints, and drives the colour mode, 3D extrusion, satellite toggle, filters, selection and verdicts. `lib.ts` holds the shared types, colour scales, statistics and `localStorage` helpers. The panel and overlay components live in `./components`.

## Interface

- `main.tsx`: entry point. Renders `<App />` into `#root` and imports `styles.css`.
- `App.tsx`: default export `App()`. Three tabs (`overview`, `inspect`, `about`), three colour modes (`gba`, `llm`, `diff`), and the map layers `bld-fill`, `bld-ext`, `bld-line`, `bld-sel`, `samples-halo`, `samples`, `samples-sel`.
- `lib.ts`:
  - Types: `Mode`, `Img`, `Alt`, `Sample`, `City`, `Stats`, `Verdict`.
  - Colour: `HEIGHT_STOPS`, `DIFF_STOPS`, `NO_DATA`, `colorExpr(mode)`, `heightExpr(mode)`, `colorFor(stops, v)`.
  - Statistics: `computeStats(samples)` returns `{ n, mae, bias, corr }` over samples with `hl != null`, or `null` when fewer than 2.
  - Verdicts: `VERDICTS`, `loadVerdicts(city)`, `saveVerdicts(city, v)`, `verdictsCsv(samples, v)`.
  - Constants: `USES`, `CONFS`, `LCZ_NAMES`, `EMBED_KEY`.
  - URLs and formatting: `embedUrl(im)`, `streetViewUrl(pano)`, `fmt`, `signed`.
- `vite-env.d.ts`: Vite client type declarations.
- `styles.css`: styles for the classes used in the components.
- [components/](./components/EGM.md): About, Detail, Legend and Scatter.

## Invariants

- Data contract with `scripts/export_web.py`: the `Sample` fields (`fid, lcz, h, storeys, use, conf, hl, note, nvis, imgs, vt, sliver, cut, alt`) match the properties written to `samples.geojson`. `lon` and `lat` come from the GeoJSON point, and `dh` is computed in `App.tsx` as `hl - h`.
- Vector tiles use source layer `b` with feature properties `h`, `fid`, `hl`, `dh`. `bld-sel` and `samples-sel` select by `fid`, with `-1` meaning nothing selected.
- Data is expected at `${import.meta.env.BASE_URL}data/cities.json` and `.../data/<city>/{buildings.pmtiles,samples.geojson,img/<f>}`. `cities.json` is maintained by hand (no script in `scripts/` writes it) and is not gitignored.
- A city with `labelled === false` is forced to `gba` mode and has no Inspect tab.
- The map is created once; changing city swaps the tile URL on source `bld` and flies to the new centre. The `pmtiles` protocol is registered once (module-level `protocolAdded`).
- Basemap layers whose id starts with `building` are hidden after load so the GBA footprints are visible.
- Verdicts are stored per city under the `localStorage` key `verdicts:<city>`; failures are swallowed and verdicts then last for the session only.
- The sample list in the Browse panel is capped at 200 rows.

## Side Effects

- Network: `fetch` of `cities.json` and `samples.geojson`; MapLibre loads the CARTO Positron style (`BASEMAP_STYLE`), Esri World Imagery tiles when satellite is on, and PMTiles byte ranges.
- Reads the `city` query parameter to choose the initial city.
- `localStorage` reads and writes for verdicts.
- Creates a Blob URL and clicks a temporary anchor to download `<city>_verdicts.csv`.
- In development builds only, exposes the map as `window.__map`.
- Runs a `requestAnimationFrame` loop while "spin" is on, stopped by mouse or touch.

## Verification

- Run: `cd webapp && npm test && npm run build`. `lib.test.ts` covers `computeStats`, `colorFor`, `verdictsCsv`, `fmt` and `signed`; the build type-checks with `tsc -b`.
