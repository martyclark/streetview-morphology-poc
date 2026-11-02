# webapp

## Overview

Static single-page viewer (React 19, MapLibre GL, PMTiles, built with Vite) for comparing Global Building Atlas heights with heights estimated from Street View by an image model. It has no backend. The data it displays is produced offline by `scripts/export_web.py` and placed under `public/data/`. Build configuration is in `package.json`, `vite.config.ts`, `tsconfig*.json` and `firebase.json`. The page shell is `index.html`.

## Subdirectories & Boundaries

- src: [./src/EGM.md](./src/EGM.md) - application code: entry point, `App`, shared helpers and components.
- public: static assets served as-is. `public/data/<city>/` is generated and gitignored (`webapp/public/data/*/`).

## Global Invariants

- `package.json` scripts: `dev` (`vite`), `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`).
- `dist/`, `node_modules/`, `*.tsbuildinfo`, `vite.config.js` and `vite.config.d.ts` are gitignored.
- The optional build-time variable `VITE_GMAPS_EMBED_KEY` enables the embedded 360° view; without it the viewer links out to Google Maps.

## Global Side Effects

- `npm run build` writes `dist/`.
- The built app fetches third-party map styles and tiles at runtime (CARTO, Esri) and, when a key is set, Google Maps Embed.

## Verification

- Run: `cd webapp && npm test && npm run build`.
