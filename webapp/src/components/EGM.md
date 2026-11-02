# webapp/src/components

## Overview

Presentational React components for the viewer's side panel and map overlay. They hold only local UI state (lightbox, selected panorama) and receive all data and callbacks as props from `App.tsx`. Shared types, colour scales and helpers come from `../lib`.

## Interface

- `About.tsx`: default export `About({ city?: City })`. Static explanation of method, datasets and limits. Contains a `FLOOR_ROWS` table of floor heights per use and a hard-coded list of data sources.
- `Detail.tsx`: default export `Detail({ sample, base, position, verdict?, onVerdict, onPrev, onNext, onClose })`. Shows heights, the right/wrong/unsure verdict buttons, warnings for `sample.sliver` and `sample.cut`, the photos from `${base}/img/<f>`, the model's label and note, the optional second opinion `sample.alt`, a full-size image lightbox, and a panorama modal.
- `Legend.tsx`: default export `Legend({ mode })`. Colour bar from `HEIGHT_STOPS` or `DIFF_STOPS` plus a "not sampled" swatch for `NO_DATA` when `mode !== "gba"`.
- `Scatter.tsx`: default export `Scatter({ samples, selected, onSelect })`. SVG plot of GBA height (`h`) against LLM height (`hl`), both clipped to `MAX = 25` m, with a 1:1 line. Samples with `hl == null` are not drawn. Clicking a dot calls `onSelect(fid)`.

## Invariants

- Components do not fetch data or touch the map. `Detail` loads images by URL only.
- `Detail` renders the embedded 360° view only when `embedUrl` returns a URL, which requires `VITE_GMAPS_EMBED_KEY` at build time. Otherwise it links to Google Maps through `streetViewUrl`.
- The floor heights in `About.tsx` (`FLOOR_ROWS`) mirror `FLOOR_H` in `scripts/export_web.py` and `scripts/apply_labels.py`. They are typed separately and do not update automatically.
- `Scatter` cannot show points above 25 m; `Math.min(v, MAX)` pins them to the edge.

## Side Effects

- `Detail` opens `www.google.com/maps` links in a new tab and loads a Google Maps Embed iframe when a key is configured.
- `About` links to external sites (GBA, Zenodo, Google, MapLibre, Protomaps, CARTO, OpenStreetMap).
- No local or session storage is touched here. Verdict persistence is done in `../lib` (`saveVerdicts`) and called from `App.tsx`.

## Verification

- Run: `cd webapp && npm run build` (type-checks with `tsc -b`). The components have no tests; `npm test` covers `../lib.ts` only.
