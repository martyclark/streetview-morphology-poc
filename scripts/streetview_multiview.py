"""Multi-view Street View candidate selection and (optionally) image download.

Per building, free metadata lookups are made at the centroid plus a ring of offset points, panos are de-duplicated,
scored on distance / line-of-sight, and up to --views are kept with headings at least --min-heading-sep apart.

Usage: python scripts/streetview_multiview.py sample.gpkg gba_buildings.gpkg outdir [--views 3] [--per-class N] [--fetch-images --max-image-requests 300]
Metadata is free; images are billed, so --max-image-requests is a hard stop.
"""
import argparse
import math
import os
import sys
import tomllib
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from common import fov_deg

META = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG = "https://maps.googleapis.com/maps/api/streetview"
RING_M = 25
MIN_D, MAX_D = 6, 35


def api_key():
    k = os.environ.get("GOOGLE_MAPS_API_KEY")
    if k:
        return k
    p = Path(__file__).resolve().parent.parent / ".env.toml"
    if p.exists():
        return tomllib.loads(p.read_text()).get("GOOGLE_MAPS_API_KEY")
    sys.exit("Set GOOGLE_MAPS_API_KEY")


def bearing(p, q):
    return math.degrees(math.atan2(q.x - p.x, q.y - p.y)) % 360


def hdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sample")
    ap.add_argument("buildings")
    ap.add_argument("outdir")
    ap.add_argument("--views", type=int, default=3)
    ap.add_argument("--min-heading-sep", type=float, default=30)
    ap.add_argument("--fetch-images", action="store_true")
    ap.add_argument("--max-image-requests", type=int, default=200)
    ap.add_argument("--per-class", type=int, default=None, help="process only the first N sampled buildings of each LCZ")
    ap.add_argument("--skip-done", default=None, help="multiview.csv from an earlier run; its buildings are skipped")
    a = ap.parse_args()
    key = api_key()
    out = Path(a.outdir)
    (out / "img").mkdir(parents=True, exist_ok=True)

    s = gpd.read_file(a.sample)
    if a.per_class:
        s = s.groupby("lcz", group_keys=False).head(a.per_class)
    if a.skip_done:
        s = s[~s.index.isin(pd.read_csv(a.skip_done).fid)]
    allb = gpd.read_file(a.buildings)
    utm = allb.estimate_utm_crs()
    geoms = allb.to_crs(utm).geometry.values
    tree = STRtree(geoms)
    s_u = s.to_crs(utm)
    offsets = [(0, 0)] + [
        (RING_M * math.sin(math.radians(t)), RING_M * math.cos(math.radians(t))) for t in range(0, 360, 45)
    ]

    rows, n_img = [], 0
    for n, ((idx, b), (_, bu)) in enumerate(zip(s.iterrows(), s_u.iterrows())):
        cu = bu.geometry.centroid
        panos = {}
        for dx, dy in offsets:
            q = gpd.GeoSeries([Point(cu.x + dx, cu.y + dy)], crs=utm).to_crs(4326).iloc[0]
            r = requests.get(META, params={"location": f"{q.y},{q.x}", "radius": 20, "source": "outdoor", "key": key}, timeout=30).json()
            if r.get("status") == "OK":
                panos[r["pano_id"]] = r
        cands = []
        for pid, r in panos.items():
            p = gpd.GeoSeries([Point(r["location"]["lng"], r["location"]["lat"])], crs=4326).to_crs(utm).iloc[0]
            d = p.distance(cu)
            sight = LineString([p, cu])
            blockers = sum(
                1 for i in tree.query(sight)
                if geoms[i].intersects(sight) and geoms[i].area > 20 and not geoms[i].equals(bu.geometry)
            )
            cands.append({"pano_id": pid, "date": r.get("date"), "dist_m": d, "heading": bearing(p, cu), "blockers": blockers})
        # Clear line of sight first, then prefer a mid-range distance.
        cands = [c for c in cands if c["blockers"] == 0 and MIN_D <= c["dist_m"] <= MAX_D]
        cands.sort(key=lambda c: abs(c["dist_m"] - 15))
        keep = []
        for c in cands:
            if all(hdiff(c["heading"], k["heading"]) >= a.min_heading_sep for k in keep):
                keep.append(c)
            if len(keep) >= a.views:
                break

        for j, c in enumerate(keep):
            row = {"fid": idx, "lcz": b.lcz, "view": j, "n_candidates": len(cands), **c}
            if a.fetch_images:
                if n_img >= a.max_image_requests:
                    print(f"image budget {a.max_image_requests} reached after {n} buildings; stopping")
                    pd.DataFrame(rows).to_csv(out / "multiview.csv", index=False)
                    return
                width = max(bu.geometry.bounds[2] - bu.geometry.bounds[0], bu.geometry.bounds[3] - bu.geometry.bounds[1], 8)
                fov = fov_deg(width, c["dist_m"])
                img = requests.get(
                    IMG,
                    params={"size": "640x640", "pano": c["pano_id"], "heading": c["heading"], "fov": fov, "pitch": 10, "key": key},
                    timeout=60,
                )
                n_img += 1
                if img.status_code == 200:
                    f = out / "img" / f"lcz{b.lcz}_{idx}_v{j}.jpg"
                    f.write_bytes(img.content)
                    row["img"] = str(f)
            rows.append(row)
        if not keep:
            rows.append({"fid": idx, "lcz": b.lcz, "view": -1, "n_candidates": len(cands)})
        print(f"{n + 1}/{len(s)} fid {idx} lcz {b.lcz}: {len(keep)} views, images so far {n_img}", flush=True)

    df = pd.DataFrame(rows)
    df.to_csv(out / "multiview.csv", index=False)
    per_b = df.groupby("fid").agg(lcz=("lcz", "first"), views=("view", lambda v: (v >= 0).sum()))
    print(per_b.groupby("lcz").views.agg(n="size", any_view=lambda v: (v > 0).mean(), mean_views="mean").round(2))
    print(f"\noverall: {(per_b.views > 0).mean():.0%} of buildings have at least one clear view; images requested: {n_img}")


if __name__ == "__main__":
    main()
