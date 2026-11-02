"""Tile each building's views into one labelled row; two buildings per sheet for faster manual labelling.

Usage: python scripts/contact_sheets.py multiview.csv outdir
"""
import sys
from pathlib import Path

import pandas as pd
from PIL import Image, ImageDraw

TILE = 420
d = pd.read_csv(sys.argv[1])
d = d[d.img.notna()]
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

rows = []
for fid, g in d.groupby("fid", sort=False):
    row = Image.new("RGB", (TILE * 3, TILE), "white")
    for j, r in enumerate(g.itertuples()):
        im = Image.open(r.img).convert("RGB").resize((TILE, TILE))
        ImageDraw.Draw(im).text((8, 8), f"fid {fid}  v{r.view}  {r.dist_m:.0f} m", fill="yellow")
        row.paste(im, (j * TILE, 0))
    rows.append((fid, row))

for i in range(0, len(rows), 2):
    pair = rows[i:i + 2]
    sheet = Image.new("RGB", (TILE * 3, TILE * len(pair)), "white")
    for k, (_, row) in enumerate(pair):
        sheet.paste(row, (0, k * TILE))
    sheet.save(out / f"sheet_{i // 2:02d}_fids_{'_'.join(str(f) for f, _ in pair)}.jpg", quality=85)
