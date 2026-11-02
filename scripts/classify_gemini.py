"""Classify Street View crops of a building (all views together) with Gemini.

Usage: python scripts/classify_gemini.py multiview.csv out.csv [--model gemini-3.1-flash-lite] [--sleep 4]
"""
import argparse
import base64
import io
import json
import os
import sys
import time
import tomllib
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from PIL import Image, ImageDraw

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = """You are labelling buildings from street-level photos for an urban heat model in Chiang Mai, Thailand.
Each photo is a view aimed at the SAME target building, which should be near the image centre. Neighbouring, taller or
more prominent buildings may also be in frame; ignore them unless they are the target.
Photos are numbered in the order given (view 0, 1, ...).

For each photo say whether the target building is actually visible (not hidden by walls, hedges, trees, vehicles or
cables to the point that its height cannot be judged). Then give one consensus answer for the target building:
- storeys: number of above-ground floors (count ground floor as 1; a pitched roof or attic alone does not add a storey).
  null if it cannot be judged.
- use: residential, commercial (shops, offices), mixed (shop below living space), institutional (school, temple,
  government), industrial, ancillary (shed, carport, outbuilding), vacant (cleared plot or construction site), or unknown.
- confidence: high, medium or low.
Be conservative: if views disagree about which building is the target or its height, set storeys to null."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "views": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "view": {"type": "INTEGER"}, "target_visible": {"type": "BOOLEAN"}},
            "required": ["view", "target_visible"]}},
        "storeys": {"type": "INTEGER", "nullable": True},
        "use": {"type": "STRING", "enum": ["residential", "commercial", "mixed", "institutional", "industrial", "ancillary", "vacant", "unknown"]},
        "confidence": {"type": "STRING", "enum": ["high", "medium", "low"]},
        "note": {"type": "STRING"},
    },
    "required": ["views", "storeys", "use", "confidence", "note"],
}


def api_key():
    k = os.environ.get("GEMINI_API_KEY")
    if k:
        return k
    p = Path(__file__).resolve().parent.parent / ".env.toml"
    if p.exists():
        return tomllib.loads(p.read_text()).get("GEMINI_API_KEY")
    sys.exit("Set GEMINI_API_KEY")


HINT_PROMPT = """
Extra information per view: the camera's distance from the target's centre and the target's mapped footprint area.
Red tick marks at the top and bottom edge of each photo mark the vertical line through the target's centre, so the
target is the building that line passes through. A footprint of about 40-150 m2 is a typical small house or shophouse;
a much larger footprint suggests a bigger building. The footprint area is a hint, not a height."""


def marked_jpeg(path):
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im)
    x, w, h = im.width // 2, 5, 40
    for y0 in (0, im.height - h):
        d.rectangle([x - w, y0, x + w, y0 + h], fill=(255, 0, 0))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def classify(key, model, imgs, hints=None):
    parts = [{"text": PROMPT + (HINT_PROMPT if hints else "")}]
    for i, f in enumerate(imgs):
        parts.append({"text": f"View {i}:" + (f" camera {hints[i][0]:.0f} m from target centre; footprint about {hints[i][1]:.0f} m2." if hints else "")})
        data = marked_jpeg(f) if hints else Path(f).read_bytes()
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(data).decode()}})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    for attempt in range(6):
        r = requests.post(URL.format(model=model), headers={"x-goog-api-key": key}, json=body, timeout=120)
        if r.status_code == 200:
            return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
        if r.status_code in (429, 500, 503):
            time.sleep(10 * 2 ** attempt)
            continue
        raise RuntimeError(f"Gemini {r.status_code}: {r.text[:400]}")
    raise RuntimeError("retries exhausted")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("multiview")
    ap.add_argument("out")
    ap.add_argument("--model", default="gemini-3.1-flash-lite")
    ap.add_argument("--sleep", type=float, default=4)
    ap.add_argument("--hints-sample", help="sample gpkg; enables marker + distance/footprint-area hints")
    a = ap.parse_args()
    key = api_key()

    d = pd.read_csv(a.multiview)
    d = d[d.img.notna()]
    area = gpd.read_file(a.hints_sample).area_m2 if a.hints_sample else None
    rows = []
    for n, (fid, g) in enumerate(d.groupby("fid", sort=False)):
        try:
            g = g.sort_values("view")
            hints = [(r.dist_m, area[fid]) for r in g.itertuples()] if area is not None else None
            r = classify(key, a.model, g.img.tolist(), hints)
            rows.append({"fid": fid, "lcz": g.lcz.iloc[0], "n_views": len(g), "storeys": r["storeys"], "use": r["use"],
                         "confidence": r["confidence"], "n_visible": sum(v["target_visible"] for v in r["views"]), "note": r["note"]})
        except Exception as e:
            print(f"fid {fid}: {e}", file=sys.stderr)
            rows.append({"fid": fid, "lcz": g.lcz.iloc[0], "n_views": len(g), "note": f"ERROR {e}"[:200]})
        print(f"{n + 1} fid {fid}: {rows[-1].get('storeys')} {rows[-1].get('use')} {rows[-1].get('confidence')}", flush=True)
        time.sleep(a.sleep)
    pd.DataFrame(rows).to_csv(a.out, index=False)


if __name__ == "__main__":
    main()
