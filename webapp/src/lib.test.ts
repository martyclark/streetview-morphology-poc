import { describe, expect, it } from "vitest";
import { DIFF_STOPS, colorFor, computeStats, fmt, signed, verdictsCsv, type Sample } from "./lib";

const s = (fid: number, h: number, hl: number | null) =>
  ({ fid, h, hl, storeys: 2, use: "residential", conf: "high", sliver: false, cut: false }) as Sample;

describe("computeStats", () => {
  it("returns MAE, bias and correlation over labelled samples", () => {
    const r = computeStats([s(1, 10, 12), s(2, 20, 18), s(3, 30, null)]);
    expect(r).toEqual({ n: 2, mae: 2, bias: 0, corr: 1 });
  });

  it("needs at least two labelled samples", () => {
    expect(computeStats([s(1, 10, 12)])).toBeNull();
  });
});

describe("colorFor", () => {
  it("clamps below and above the stops and picks the first stop at or above the value", () => {
    expect(colorFor(DIFF_STOPS, -100)).toBe(DIFF_STOPS[0][1]);
    expect(colorFor(DIFF_STOPS, 100)).toBe(DIFF_STOPS[DIFF_STOPS.length - 1][1]);
    expect(colorFor(DIFF_STOPS, 0)).toBe("#f2f2f2");
  });
});

describe("verdictsCsv", () => {
  it("lists only reviewed samples", () => {
    const csv = verdictsCsv([s(1, 10, 12), s(2, 20, null)], { 2: "wrong" });
    expect(csv.split("\n")).toEqual([
      "fid,verdict,gba_height,llm_height,storeys,use,confidence,sliver,roof_cut",
      "2,wrong,20,,2,residential,high,false,false",
    ]);
  });
});

describe("formatting", () => {
  it("shows a dash for missing values and a sign for differences", () => {
    expect(fmt(null)).toBe("–");
    expect(fmt(1.26)).toBe("1.3");
    expect(signed(2)).toBe("+2.0");
    expect(signed(-2)).toBe("-2.0");
  });
});
