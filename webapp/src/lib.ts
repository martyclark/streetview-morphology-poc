export type Mode = "gba" | "llm" | "diff";

export interface Img {
  f: string;
  date: string;
  dist: number;
  pano: string;
  hd: number; // camera heading used for the crop, degrees
  fov: number; // field of view of the crop, degrees
}

export interface Alt {
  storeys: number;
  use: string;
  conf: string;
  hl: number | null;
  note: string;
}

export interface Sample {
  fid: number;
  lcz: number;
  h: number; // GBA height, m
  hl: number | null; // LLM-derived height, m (null when the model could not judge)
  dh: number | null; // hl - h
  storeys: number | null;
  use: string;
  conf: string;
  note: string;
  nvis: number;
  imgs: Img[];
  alt?: Alt;
  vt: number; // height of the front wall that stays in frame in the best view, m
  sliver: boolean; // very thin footprint: may not be a real building on its own
  cut: boolean; // LLM height is above the visible top in every view: the roof is probably out of frame
  lon: number;
  lat: number;
}

export interface City {
  id: string;
  name: string;
  country: string;
  center: [number, number];
  zoom: number;
  source: string;
  labelled?: boolean; // false: footprints only, no street-view labels
  buildings?: number;
}

export const HEIGHT_STOPS: [number, string][] = [
  [0, "#fff7bc"],
  [3, "#fee391"],
  [5, "#fec44f"],
  [8, "#fe9929"],
  [12, "#ec7014"],
  [20, "#cc4c02"],
  [35, "#8c2d04"],
];

export const DIFF_STOPS: [number, string][] = [
  [-8, "#2166ac"],
  [-4, "#67a9cf"],
  [-1, "#d1e5f0"],
  [0, "#f2f2f2"],
  [1, "#fddbc7"],
  [4, "#ef8a62"],
  [8, "#b2182b"],
];

export const NO_DATA = "#dfe4ea";

function interpolate(stops: [number, string][], value: any) {
  return ["interpolate", ["linear"], value, ...stops.flat()] as any;
}

/** MapLibre colour expression for a mode; `sampled` objects only get colour in llm/diff modes. */
export function colorExpr(mode: Mode): any {
  if (mode === "gba") return interpolate(HEIGHT_STOPS, ["get", "h"]);
  if (mode === "llm") return ["case", ["has", "hl"], interpolate(HEIGHT_STOPS, ["get", "hl"]), NO_DATA];
  return ["case", ["has", "dh"], interpolate(DIFF_STOPS, ["get", "dh"]), NO_DATA];
}

export function heightExpr(mode: Mode): any {
  return mode === "gba" ? ["get", "h"] : ["coalesce", ["get", "hl"], ["get", "h"]];
}

export function colorFor(stops: [number, string][], v: number): string {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

export interface Stats {
  n: number;
  mae: number;
  bias: number;
  corr: number;
}

export function computeStats(samples: Sample[]): Stats | null {
  const s = samples.filter((d) => d.hl != null);
  const n = s.length;
  if (n < 2) return null;
  const x = s.map((d) => d.h);
  const y = s.map((d) => d.hl as number);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0, abs = 0, bias = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
    abs += Math.abs(y[i] - x[i]);
    bias += y[i] - x[i];
  }
  return { n, mae: abs / n, bias: bias / n, corr: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN };
}

export type Verdict = "ok" | "wrong" | "unsure";
export const VERDICTS: { id: Verdict; label: string; mark: string }[] = [
  { id: "ok", label: "Right building", mark: "✓" },
  { id: "wrong", label: "Wrong building", mark: "✗" },
  { id: "unsure", label: "Can't tell", mark: "?" },
];

export function loadVerdicts(city: string): Record<number, Verdict> {
  try {
    return JSON.parse(localStorage.getItem(`verdicts:${city}`) ?? "{}");
  } catch {
    return {};
  }
}

export function saveVerdicts(city: string, v: Record<number, Verdict>) {
  try {
    localStorage.setItem(`verdicts:${city}`, JSON.stringify(v));
  } catch {
    /* storage unavailable: verdicts last for this session only */
  }
}

export function verdictsCsv(samples: Sample[], v: Record<number, Verdict>): string {
  const head = ["fid", "verdict", "gba_height", "llm_height", "storeys", "use", "confidence", "sliver", "roof_cut"];
  const rows = samples.filter((s) => v[s.fid]).map((s) =>
    [s.fid, v[s.fid], s.h, s.hl ?? "", s.storeys ?? "", s.use, s.conf, s.sliver, s.cut].join(","));
  return [head.join(","), ...rows].join("\n");
}

export const USES = ["residential", "commercial", "mixed", "institutional", "industrial", "ancillary", "vacant", "unknown"];
export const CONFS = ["high", "medium", "low"];

export const LCZ_NAMES: Record<number, string> = {
  1: "Compact high-rise", 2: "Compact mid-rise", 3: "Compact low-rise", 4: "Open high-rise", 5: "Open mid-rise",
  6: "Open low-rise", 7: "Lightweight low-rise", 8: "Large low-rise", 9: "Sparsely built", 10: "Heavy industry",
};

export const EMBED_KEY: string | undefined = import.meta.env.VITE_GMAPS_EMBED_KEY || undefined;

/** Interactive Street View via the free Maps Embed API; needs a referrer-restricted key. */
export function embedUrl(im: { pano: string; hd: number }): string | null {
  if (!EMBED_KEY) return null;
  const q = new URLSearchParams({ key: EMBED_KEY, pano: im.pano, heading: String(im.hd), pitch: "25", fov: "90" });
  return `https://www.google.com/maps/embed/v1/streetview?${q}`;
}

export function streetViewUrl(pano: string): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${pano}`;
}

export const fmt = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "–" : v.toFixed(d));
export const signed = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);
