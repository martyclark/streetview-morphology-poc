"""Merge hand/LLM labels into the pilot table and derive a storey-based height.

Height model: storeys * floor_height(use) + roof allowance, both from common.py. They are assumptions, not measured.
"""
import sys

import pandas as pd

from common import FLOOR_H, ROOF

pilot = pd.read_csv(sys.argv[1])
labels = pd.read_csv(sys.argv[2])
d = pilot.merge(labels, on="fid", how="left")
d["height_new"] = d.storeys * d.use.map(FLOOR_H) + ROOF
d.loc[d.storeys == 0, "height_new"] = 0.0
d["diff_gba_minus_new"] = d.gba_height - d.height_new
d.to_csv(sys.argv[3], index=False)

l = d[d.height_new.notna()]
print(f"labelled {len(l)} of {d.img.notna().sum()} images with a usable view")
print(l.groupby("lcz").agg(n=("fid", "size"), gba=("gba_height", "mean"), new=("height_new", "mean"),
                           mae=("diff_gba_minus_new", lambda s: s.abs().mean())).round(1))
print(f"\noverall MAE {l.diff_gba_minus_new.abs().mean():.1f} m, bias (GBA - new) {l.diff_gba_minus_new.mean():+.1f} m")
print(f"corr(GBA, new) = {l.gba_height.corr(l.height_new):.2f}")

hm = l[l.confidence.isin(["high", "medium"]) & (l.storeys > 0)]
print(f"\nhigh/medium confidence, occupied only: n={len(hm)}  MAE {hm.diff_gba_minus_new.abs().mean():.1f} m  bias {hm.diff_gba_minus_new.mean():+.1f} m  corr {hm.gba_height.corr(hm.height_new):.2f}")
print(f"storeys of those: {hm.storeys.value_counts().sort_index().to_dict()}")
