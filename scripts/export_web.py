"""Export one city's footprints, LLM labels and images for the static web viewer.

Writes under webapp/public/data/<city>/:
  buildings.pmtiles  all GBA footprints (vector tiles; labelled ones carry fid, hl, dh)
  samples.geojson    one point per sampled building with labels, notes and image list
  img/<fid>_<view>.jpg

Usage: python scripts/export_web.py chiang_mai --gba data/chiang_mai/gba_buildings.gpkg \
        --sample data/chiang_mai/lcz_sample_neyman.gpkg --labels outputs/final_labelled.csv \
        --multiview outputs/full/multiview.csv outputs/full2/multiview.csv \
        --second-pass outputs/second_pass_gemini3flash.csv
"""
import argparse
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import mapbox_vector_tile
import numpy as np
import pandas as pd
import shapely
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write

from common import FLOOR_H, ROOF, fov_deg

CAMERA_H = 2.5  # m, assumed Street View camera height
PITCH = 10  # deg, as fetched
ZOOMS = range(12, 17)
EXTENT = 4096
WORLD = 2 * 20037508.342789244
MIN_AREA_Z12 = 150  # m2 (web-mercator, slightly inflated); sampled buildings always kept


def height_from(storeys, use):
    if pd.isna(storeys) or use not in FLOOR_H:
        return None
    return 0.0 if storeys == 0 else round(float(storeys) * FLOOR_H[use] + ROOF, 1)


def view_geometry(poly, dist_m, lat):
    """Field of view used by streetview_multiview.py for this footprint, and the height of its front wall that stays in frame."""
    b = poly.bounds
    width = max((b[2] - b[0]) * 111320 * math.cos(math.radians(lat)), (b[3] - b[1]) * 111320, 8)
    fov = fov_deg(width, dist_m)
    near = max(dist_m - width / 2, 3)  # distance to the front wall for a roughly square footprint
    top = CAMERA_H + near * math.tan(math.radians(PITCH + fov / 2))
    return fov, top


def is_sliver(geom_m):
    """Very thin footprints (under 4 m wide, or more than 5:1) are often not a real building on their own."""
    c = list(geom_m.minimum_rotated_rectangle.exterior.coords)
    a, b = math.dist(c[0], c[1]), math.dist(c[1], c[2])
    return min(a, b) < 4 or max(a, b) / max(min(a, b), 0.1) > 5


def tile_bounds(z, x, y):
    s = WORLD / 2 ** z
    x0 = -WORLD / 2 + x * s
    y1 = WORLD / 2 - y * s
    return x0, y1 - s, x0 + s, y1


def build_tiles(gdf, out, bounds_ll):
    """gdf: EPSG:3857 geometries + attribute columns. Writes a PMTiles archive."""
    geoms = gdf.geometry.values
    bb = shapely.bounds(geoms)
    area = shapely.area(geoms)
    props = gdf.drop(columns="geometry").to_dict("records")
    keep_always = gdf["fid"].notna().values
    tiles = {}
    for z in ZOOMS:
        n = 2 ** z
        s = WORLD / n
        sel = np.ones(len(gdf), bool) if z > ZOOMS.start else (area >= MIN_AREA_Z12) | keep_always
        x0 = np.floor((bb[:, 0] + WORLD / 2) / s).astype(int)
        x1 = np.floor((bb[:, 2] + WORLD / 2) / s).astype(int)
        y0 = np.floor((WORLD / 2 - bb[:, 3]) / s).astype(int)
        y1 = np.floor((WORLD / 2 - bb[:, 1]) / s).astype(int)
        buckets = defaultdict(list)
        for i in np.flatnonzero(sel):
            for x in range(x0[i], x1[i] + 1):
                for y in range(y0[i], y1[i] + 1):
                    buckets[(x, y)].append(i)
        tol = s / EXTENT * 0.8 if z < 15 else 0
        for (x, y), idx in buckets.items():
            b = tile_bounds(z, x, y)
            pad = s / EXTENT * 64
            clip = shapely.clip_by_rect(geoms[idx], b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)
            clip = shapely.orient_polygons(clip, exterior_cw=False)  # GBA mixes ring directions; MVT renderers drop the wrong one
            feats = []
            for g, i in zip(clip, idx):
                if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
                    continue
                if tol:
                    g = shapely.orient_polygons(g.simplify(tol), exterior_cw=False)
                    if g.is_empty:
                        continue
                feats.append({"geometry": g, "properties": {k: v for k, v in props[i].items() if not pd.isna(v)}})
            if feats:
                tiles[(z, x, y)] = mapbox_vector_tile.encode(
                    [{"name": "b", "features": feats}],
                    default_options={"quantize_bounds": b, "extents": EXTENT, "y_coord_down": False})
        print(f"z{z}: {sum(1 for k in tiles if k[0] == z)} tiles", flush=True)

    lon0, lat0, lon1, lat1 = bounds_ll
    meta = {"name": "buildings", "format": "pbf", "vector_layers": [{"id": "b", "minzoom": ZOOMS.start, "maxzoom": ZOOMS.stop - 1,
            "fields": {"h": "Number", "fid": "Number", "hl": "Number", "dh": "Number"}}]}
    header = {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP, "min_zoom": ZOOMS.start, "max_zoom": ZOOMS.stop - 1,
              "min_lon_e7": int(lon0 * 1e7), "min_lat_e7": int(lat0 * 1e7), "max_lon_e7": int(lon1 * 1e7), "max_lat_e7": int(lat1 * 1e7),
              "center_zoom": 13, "center_lon_e7": int((lon0 + lon1) / 2 * 1e7), "center_lat_e7": int((lat0 + lat1) / 2 * 1e7)}
    with write(out) as w:
        for key in sorted(tiles, key=lambda k: zxy_to_tileid(*k)):
            w.write_tile(zxy_to_tileid(*key), gzip.compress(tiles[key], 6))
        w.finalize(header, meta)
    print(f"{out}: {len(tiles)} tiles, {Path(out).stat().st_size / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city")
    ap.add_argument("--gba", required=True)
    ap.add_argument("--sample", help="omit for a footprints-only city (no street-view labels)")
    ap.add_argument("--labels")
    ap.add_argument("--multiview", nargs="+")
    ap.add_argument("--second-pass")
    ap.add_argument("--skip-tiles", action="store_true", help="reuse the existing buildings.pmtiles")
    ap.add_argument("--out", default="webapp/public/data")
    a = ap.parse_args()
    out = Path(a.out) / a.city
    (out / "img").mkdir(parents=True, exist_ok=True)
    (out / "assumptions.json").write_text(json.dumps({"floor_h": FLOOR_H, "roof_m": ROOF}, indent=1))

    gba = gpd.read_file(a.gba).reset_index(drop=True)
    gba["h"] = gba.height.round(1)
    gba["fid"] = np.nan
    gba["hl"] = np.nan
    gba["dh"] = np.nan
    if not a.sample:
        build_tiles(gba[["h", "fid", "hl", "dh", "geometry"]].to_crs(3857), out / "buildings.pmtiles", tuple(gba.total_bounds))
        print("bounds", [round(v, 4) for v in gba.total_bounds], "buildings", len(gba))
        return
    sample = gpd.read_file(a.sample)  # row index == fid
    labels = pd.read_csv(a.labels).set_index("fid")
    sample_m = sample.to_crs(sample.estimate_utm_crs())

    # sample polygons are copies of GBA footprints: match on an interior point
    pts = sample.geometry.representative_point()
    hit = gba.sindex.query(pts.values, predicate="within")
    match = pd.Series(hit[1], index=hit[0]).groupby(level=0).first()
    assert len(match) == len(sample), f"{len(sample) - len(match)} sample buildings not matched to GBA"
    assert np.allclose(gba.height.values[match.values], sample.height.values, atol=1e-3), "matched heights differ"

    for fid, gi in match.items():
        gba.loc[gi, "fid"] = fid
        hl = height_from(labels.at[fid, "storeys"], labels.at[fid, "use"]) if fid in labels.index else None
        if hl is not None:
            gba.loc[gi, "hl"] = hl
            gba.loc[gi, "dh"] = round(hl - float(gba.at[gi, "h"]), 1)
    merc = gba[["h", "fid", "hl", "dh", "geometry"]].to_crs(3857)
    if not a.skip_tiles:
        build_tiles(merc, out / "buildings.pmtiles", tuple(gba.total_bounds))

    mv = pd.concat([pd.read_csv(p) for p in a.multiview])
    mv = mv[mv.img.notna() & mv.fid.isin(labels.index)]
    second = pd.read_csv(a.second_pass).set_index("fid") if a.second_pass else pd.DataFrame()
    feats = []
    for fid, g in mv.groupby("fid"):
        r = labels.loc[fid]
        imgs = []
        tops = []
        for v in g.sort_values("view").itertuples():
            name = f"{fid}_{v.view}.jpg"
            if not (out / "img" / name).exists():
                Image.open(v.img).convert("RGB").resize((512, 512), Image.LANCZOS).save(out / "img" / name, quality=72, optimize=True)
            fov, top = view_geometry(sample.geometry[fid], v.dist_m, sample.geometry[fid].centroid.y)
            tops.append(top)
            imgs.append({"f": name, "date": v.date, "dist": round(v.dist_m), "pano": v.pano_id, "hd": round(v.heading), "fov": fov})
        gi = match[fid]
        p = {"fid": int(fid), "lcz": int(r.lcz), "h": round(float(gba.at[gi, "h"]), 1), "storeys": None if pd.isna(r.storeys) else int(r.storeys),
             "use": r.use, "conf": r.confidence, "hl": height_from(r.storeys, r.use),
             "note": r.note, "nvis": int(r.n_visible), "imgs": imgs, "vt": round(max(tops), 1)}
        p["sliver"] = bool(is_sliver(sample_m.geometry[fid]))
        p["cut"] = bool(p["hl"] is not None and p["hl"] > p["vt"])  # LLM height above the visible top in every view
        if fid in second.index and not pd.isna(second.at[fid, "storeys"]):
            s = second.loc[fid]
            p["alt"] = {"storeys": int(s.storeys), "use": s.use, "conf": s.confidence, "hl": height_from(s.storeys, s.use), "note": s.note}
        pt = pts.iloc[fid]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(pt.x, 6), round(pt.y, 6)]}, "properties": p})
    (out / "samples.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    print(f"{len(feats)} samples, {sum(len(f['properties']['imgs']) for f in feats)} images")


if __name__ == "__main__":
    main()
