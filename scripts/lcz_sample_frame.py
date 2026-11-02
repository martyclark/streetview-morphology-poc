"""Stratified building sample frame from the global 100 m LCZ map (Demuzere et al. 2022, v3 filtered).

Usage: python scripts/lcz_sample_frame.py data/chiang_mai/gba_buildings.gpkg out.gpkg [--allocation neyman] [--usable-target 300] [--floor 25] [--yield-rate 0.27]
"""
import argparse

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import minimum_filter, maximum_filter

LCZ_URL = "/vsicurl/https://zenodo.org/api/records/8419340/files/lcz_filter_v3.tif/content"
LCZ_NAMES = {
    1: "1 Compact high-rise", 2: "2 Compact mid-rise", 3: "3 Compact low-rise",
    4: "4 Open high-rise", 5: "5 Open mid-rise", 6: "6 Open low-rise",
    7: "7 Lightweight low-rise", 8: "8 Large low-rise", 9: "9 Sparsely built",
    10: "10 Heavy industry",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gpkg")
    ap.add_argument("out")
    ap.add_argument("--allocation", choices=["equal", "proportional", "neyman"], default="neyman")
    ap.add_argument("--usable-target", type=int, default=300, help="usable labelled buildings wanted across all classes")
    ap.add_argument("--floor", type=int, default=25, help="minimum usable labels per class")
    ap.add_argument("--yield-rate", type=float, default=0.27, help="share of drawn buildings that end up with a usable label (pilot: ~0.24-0.48)")
    ap.add_argument("--min-area", type=float, default=30)
    ap.add_argument("--min-spacing", type=float, default=150)
    a = ap.parse_args()

    b = gpd.read_file(a.gpkg)
    utm = b.estimate_utm_crs()
    b["area_m2"] = b.to_crs(utm).area
    b = b[b.area_m2 >= a.min_area].copy()
    cent = b.geometry.centroid

    with rasterio.open(LCZ_URL) as s:
        pad = 0.002
        minx, miny, maxx, maxy = b.total_bounds
        w = from_bounds(minx - pad, miny - pad, maxx + pad, maxy + pad, s.transform)
        w = w.round_offsets().round_lengths()
        lcz = s.read(1, window=w)
        t = s.window_transform(w)

    # A building counts as representative only if its whole 3x3 LCZ neighbourhood agrees.
    pure = (minimum_filter(lcz, size=3) == maximum_filter(lcz, size=3))
    rows, cols = rasterio.transform.rowcol(t, cent.x.values, cent.y.values)
    rows, cols = np.clip(rows, 0, lcz.shape[0] - 1), np.clip(cols, 0, lcz.shape[1] - 1)
    b["lcz"] = lcz[rows, cols]
    b["lcz_pure"] = pure[rows, cols]
    b["x"] = cent.to_crs(utm).x.values
    b["y"] = cent.to_crs(utm).y.values

    print(f"{len(b):,} buildings (>= {a.min_area:.0f} m2)")
    print(f"{'LCZ':<24}{'bldgs':>9}{'pure':>9}{'median m2':>11}{'median H':>10}")
    for k, name in LCZ_NAMES.items():
        g = b[b.lcz == k]
        if len(g):
            print(f"{name:<24}{len(g):>9,}{g.lcz_pure.sum():>9,}{g.area_m2.median():>11.0f}{g.height.median():>10.1f}")

    pure = b[b.lcz_pure & b.lcz.isin(LCZ_NAMES)]
    N = pure.groupby("lcz").size()
    # GBA height spread is a weak proxy for storey spread; replace with pilot storey SD once available.
    S = pure.groupby("lcz").height.std().fillna(0)
    w = {"equal": pd.Series(1.0, index=N.index), "proportional": N.astype(float), "neyman": N * S}[a.allocation]
    usable = w / w.sum() * a.usable_target
    # Floor first, then share what is left among the unfloored mass so the total stays on target.
    for _ in range(10):
        low = usable < a.floor
        if not low.any():
            break
        usable[low] = a.floor
        rest = a.usable_target - usable[low].sum()
        free = ~low
        usable[free] = w[free] / w[free].sum() * max(rest, 0)
    draws = np.ceil(usable / a.yield_rate).astype(int).clip(upper=N)
    print(f"\n{a.allocation} allocation, target {a.usable_target} usable, floor {a.floor}, yield {a.yield_rate}")
    print(pd.DataFrame({"pure_bldgs": N, "gba_h_sd": S.round(2), "usable_target": usable.round(0).astype(int), "draw": draws}).to_string())

    rng = np.random.default_rng(0)
    picks = []
    for k in draws.index:
        g = pure[pure.lcz == k]
        g = g.iloc[rng.permutation(len(g))]
        chosen = []
        for i, r in zip(g.index, g[["x", "y"]].itertuples(index=False)):
            if all((r.x - cx) ** 2 + (r.y - cy) ** 2 >= a.min_spacing ** 2 for cx, cy in chosen):
                chosen.append((r.x, r.y))
                picks.append(i)
            if len(chosen) >= draws[k]:
                break
        print(f"LCZ {k}: sampled {len(chosen)} of {draws[k]} requested")

    s = b.loc[picks].drop(columns=["x", "y"])
    s["lcz_name"] = s.lcz.map(LCZ_NAMES)
    s.to_file(a.out, driver="GPKG")
    print(f"wrote {len(s)} -> {a.out}")


if __name__ == "__main__":
    main()
