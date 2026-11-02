"""Street View coverage/attrition pilot over an LCZ-stratified building sample.

Usage: python scripts/streetview_pilot.py sample.gpkg gba_buildings.gpkg outdir [--per-class 15] [--fetch-images]

Metadata calls are free; --fetch-images spends Static API quota (one request per usable building).
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
from shapely.geometry import LineString
from shapely.strtree import STRtree

from common import fov_deg

META = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG = "https://maps.googleapis.com/maps/api/streetview"
MAX_DIST = 50


def api_key():
    k = os.environ.get("GOOGLE_MAPS_API_KEY")
    if k:
        return k
    p = Path(__file__).resolve().parent.parent / ".env.toml"
    if p.exists():
        return tomllib.loads(p.read_text()).get("GOOGLE_MAPS_API_KEY")
    sys.exit("Set GOOGLE_MAPS_API_KEY")


def bearing(x0, y0, x1, y1):
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sample")
    ap.add_argument("buildings")
    ap.add_argument("outdir")
    ap.add_argument("--per-class", type=int, default=15)
    ap.add_argument("--fetch-images", action="store_true")
    a = ap.parse_args()
    key = api_key()
    out = Path(a.outdir)
    (out / "img").mkdir(parents=True, exist_ok=True)

    s = gpd.read_file(a.sample)
    s = s.groupby("lcz", group_keys=False).head(a.per_class)
    allb = gpd.read_file(a.buildings)
    utm = allb.estimate_utm_crs()
    allb_u = allb.to_crs(utm)
    tree = STRtree(allb_u.geometry.values)
    s_u = s.to_crs(utm)

    rows = []
    for (idx, b), (_, bu) in zip(s.iterrows(), s_u.iterrows()):
        c = b.geometry.centroid
        r = requests.get(
            META,
            params={"location": f"{c.y},{c.x}", "radius": MAX_DIST, "source": "outdoor", "key": key},
            timeout=30,
        ).json()
        row = {"fid": idx, "lcz": b.lcz, "status": r.get("status"), "area_m2": b.area_m2, "gba_height": b.height}
        if r.get("status") == "OK":
            p = gpd.GeoSeries(gpd.points_from_xy([r["location"]["lng"]], [r["location"]["lat"]]), crs=4326).to_crs(utm).iloc[0]
            cu = bu.geometry.centroid
            d = p.distance(cu)
            sight = LineString([p, cu])
            hits = [
                i for i in tree.query(sight)
                if allb_u.geometry.iloc[i].intersects(sight)
                and allb_u.geometry.iloc[i].area > 20
                and not allb_u.geometry.iloc[i].equals(bu.geometry)
            ]
            row.update(
                pano_id=r["pano_id"], date=r.get("date"), dist_m=d,
                heading=bearing(p.x, p.y, cu.x, cu.y), occluded=len(hits) > 0, n_blockers=len(hits),
            )
            row["usable"] = (not row["occluded"]) and 5 <= d <= MAX_DIST
            if a.fetch_images and row["usable"]:
                width = max(bu.geometry.bounds[2] - bu.geometry.bounds[0], bu.geometry.bounds[3] - bu.geometry.bounds[1], 8)
                fov = fov_deg(width, d)
                img = requests.get(
                    IMG,
                    params={"size": "640x640", "pano": r["pano_id"], "heading": row["heading"], "fov": fov, "pitch": 10, "key": key},
                    timeout=60,
                )
                if img.status_code == 200:
                    f = out / "img" / f"lcz{b.lcz}_{idx}.jpg"
                    f.write_bytes(img.content)
                    row["img"] = str(f)
        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_csv(out / "pilot.csv", index=False)
    df["usable"] = df.get("usable", False)
    df["usable"] = df["usable"].fillna(False).astype(bool)
    df["has_pano"] = df.status == "OK"
    print(df.groupby("lcz").agg(n=("fid", "size"), pano=("has_pano", "mean"), usable=("usable", "mean"), median_dist=("dist_m", "median")).round(2))
    if "date" in df:
        print("\ncapture year:\n", df["date"].dropna().str[:4].value_counts().sort_index().to_string())
    print(f"\noverall: pano {df.has_pano.mean():.0%}, usable {df.usable.mean():.0%}")


if __name__ == "__main__":
    main()
