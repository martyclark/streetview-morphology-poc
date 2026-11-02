"""Mapillary coverage check against GBA footprints.

Usage: MAPILLARY_TOKEN=... python scripts/mapillary_coverage.py data/target/QAT_doha/gba_buildings.gpkg [--n 5000] [--radius 40]
"""
import argparse
import os
import sys
import time

import geopandas as gpd
import numpy as np
import requests
from shapely.geometry import box

API = "https://graph.mapillary.com/images"
TILE_DEG = 0.01  # API rejects bboxes much larger than this


def fetch_tile(token, minx, miny, maxx, maxy):
    params = {
        "access_token": token,
        "bbox": f"{minx},{miny},{maxx},{maxy}",
        "fields": "id,captured_at,compass_angle,is_pano,geometry",
        "limit": 2000,
    }
    for attempt in range(4):
        r = requests.get(API, params=params, timeout=60)
        if r.status_code == 200:
            return r.json().get("data", [])
        if r.status_code in (429, 500, 502, 503):
            time.sleep(2 ** attempt)
            continue
        sys.exit(f"Mapillary API {r.status_code}: {r.text[:300]}")
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gpkg")
    ap.add_argument("--n", type=int, default=5000)
    ap.add_argument("--radius", type=float, default=40)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    token = os.environ.get("MAPILLARY_TOKEN")
    if not token:
        sys.exit("Set MAPILLARY_TOKEN")

    b = gpd.read_file(a.gpkg)
    b = b.sample(min(a.n, len(b)), random_state=0)
    utm = b.estimate_utm_crs()
    cent = b.geometry.centroid.to_crs(utm)

    minx, miny, maxx, maxy = b.total_bounds
    tiles = [
        (x, y, min(x + TILE_DEG, maxx), min(y + TILE_DEG, maxy))
        for x in np.arange(minx, maxx, TILE_DEG)
        for y in np.arange(miny, maxy, TILE_DEG)
    ]
    # Skip tiles with no sampled buildings to save requests.
    pts = gpd.GeoSeries(b.geometry.centroid.values, crs=b.crs)
    tiles = [t for t in tiles if pts.intersects(box(*t)).any()]
    print(f"{len(b)} buildings sampled, {len(tiles)} populated tiles")

    rows = []
    capped = 0
    for i, t in enumerate(tiles):
        d = fetch_tile(token, *t)
        if len(d) >= 2000:
            capped += 1
        rows += d
        if i % 25 == 0:
            print(f"  tile {i}/{len(tiles)}  images so far {len(rows)}")
    if not rows:
        sys.exit("No images returned")

    imgs = gpd.GeoDataFrame(
        {
            "id": [r["id"] for r in rows],
            "captured_at": [r.get("captured_at") for r in rows],
            "is_pano": [r.get("is_pano", False) for r in rows],
        },
        geometry=gpd.points_from_xy(
            [r["geometry"]["coordinates"][0] for r in rows],
            [r["geometry"]["coordinates"][1] for r in rows],
        ),
        crs=4326,
    ).drop_duplicates("id").to_crs(utm)

    nearest = gpd.sjoin_nearest(
        gpd.GeoDataFrame(geometry=cent, crs=utm), imgs, distance_col="dist", how="left"
    )
    dist = nearest.groupby(level=0)["dist"].min()

    year = (imgs["captured_at"].astype("float") / 1000).pipe(
        lambda s: (1970 + s / 31556952).round()
    )
    print(f"\nunique images: {len(imgs)}  (tiles hitting 2000 cap: {capped})")
    print(f"panoramic share: {imgs['is_pano'].mean():.1%}")
    print("capture year distribution:")
    print(year.value_counts().sort_index().to_string())
    print("\nshare of sampled buildings with an image within:")
    for r in (15, 25, 40, 60, 100):
        print(f"  {r:>3} m: {(dist <= r).mean():.1%}")
    print(f"median nearest-image distance: {dist.median():.0f} m")

    if a.out:
        imgs.to_crs(4326).to_file(a.out, driver="GPKG")


if __name__ == "__main__":
    main()
