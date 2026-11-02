import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef, useState } from "react";
import About from "./components/About";
import Detail from "./components/Detail";
import Legend from "./components/Legend";
import LczLegend from "./components/LczLegend";
import Scatter from "./components/Scatter";
import {
  CONFS, USES, VERDICTS, colorExpr, computeStats, fmt, heightExpr, lczColorExpr, loadVerdicts, saveVerdicts, signed, verdictsCsv,
  type Assumptions, type City, type Mode, type Sample, type Verdict,
} from "./lib";

const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DATA = `${import.meta.env.BASE_URL}data`;
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "gba", label: "GBA height", hint: "All footprints" },
  { id: "llm", label: "LLM height", hint: "Sampled buildings" },
  { id: "diff", label: "Difference", hint: "LLM − GBA" },
];
const TILT = 58;
const SPIN_DEG_PER_MS = 0.012;

let protocolAdded = false;
const tileUrl = (id: string) => `pmtiles://${new URL(`${DATA}/${id}/buildings.pmtiles`, location.href).href}`;

type Tab = "overview" | "inspect" | "about";

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const mapCity = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState<string>("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [assumptions, setAssumptions] = useState<Assumptions | undefined>();
  const [mode, setMode] = useState<Mode>("gba");
  const [extrude, setExtrude] = useState(false);
  const [spin, setSpin] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const [showLcz, setShowLcz] = useState(false);
  const [lczClasses, setLczClasses] = useState<number[]>([]); // LCZ codes present in the current city; empty if it has no lcz.geojson
  const [onlyCut, setOnlyCut] = useState(false);
  const [onlySliver, setOnlySliver] = useState(false);
  const [hideWrong, setHideWrong] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const hiddenBySat = useRef<string[]>([]);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<number | null>(null);
  const [confs, setConfs] = useState<Set<string>>(new Set(CONFS));
  const [uses, setUses] = useState<Set<string>>(new Set(USES));
  const [sort, setSort] = useState<"absdiff" | "diff" | "gba">("absdiff");

  const city = cities.find((c) => c.id === cityId);
  const labelled = city?.labelled !== false;
  const base = `${DATA}/${cityId}`;

  useEffect(() => {
    fetch(`${DATA}/cities.json`).then((r) => r.json()).then((c: City[]) => {
      setCities(c);
      const want = new URLSearchParams(location.search).get("city");
      setCityId(c.some((x) => x.id === want) ? want! : c[0].id);
    });
  }, []);

  useEffect(() => {
    if (!city) return;
    setSelected(null);
    setSamples([]);
    setAssumptions(undefined);
    if (!labelled) {
      setMode("gba");
      setTab((t) => (t === "inspect" ? "overview" : t));
      return;
    }
    fetch(`${base}/assumptions.json`).then((r) => (r.ok ? r.json() : undefined)).then(setAssumptions).catch(() => undefined);
    fetch(`${base}/samples.geojson`).then((r) => r.json()).then((fc) => {
      setSamples(fc.features.map((f: any) => ({
        ...f.properties,
        dh: f.properties.hl == null ? null : f.properties.hl - f.properties.h,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      })));
    });
  }, [city, labelled, base]);

  const filtered = useMemo(
    () => samples.filter((s) => confs.has(s.conf) && uses.has(s.use) && (!onlyCut || s.cut) && (!onlySliver || s.sliver)
      && !(hideWrong && verdicts[s.fid] === "wrong")),
    [samples, confs, uses, onlyCut, onlySliver, hideWrong, verdicts],
  );
  useEffect(() => {
    if (cityId) setVerdicts(loadVerdicts(cityId));
  }, [cityId]);

  const setVerdict = (fid: number, v: Verdict | null) => {
    const next = { ...verdicts };
    if (v) next[fid] = v;
    else delete next[fid];
    setVerdicts(next);
    saveVerdicts(cityId, next);
  };

  const downloadVerdicts = () => {
    const url = URL.createObjectURL(new Blob([verdictsCsv(samples, verdicts)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cityId}_verdicts.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reviewed = Object.keys(verdicts).length;
  const nWrong = Object.values(verdicts).filter((v) => v === "wrong").length;
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const sorted = useMemo(() => {
    const key = (s: Sample) => (sort === "absdiff" ? -Math.abs(s.dh ?? -1) : sort === "diff" ? -(s.dh ?? -99) : -s.h);
    return [...filtered].sort((a, b) => key(a) - key(b));
  }, [filtered, sort]);
  const selectedSample = samples.find((s) => s.fid === selected) ?? null;

  // map creation
  useEffect(() => {
    if (!city || !mapEl.current || map.current) return;
    if (!protocolAdded) {
      maplibregl.addProtocol("pmtiles", new Protocol().tile);
      protocolAdded = true;
    }
    mapCity.current = city.id;
    const m = new maplibregl.Map({ container: mapEl.current, style: BASEMAP_STYLE, center: city.center, zoom: city.zoom, maxPitch: 75 });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("rotate", () => setBearing(Math.round(((m.getBearing() % 360) + 360) % 360)));
    m.on("pitch", () => setPitch(Math.round(m.getPitch())));
    m.on("load", () => {
      // the basemap draws its own (OSM) buildings above ours and would hide the GBA footprints
      for (const l of m.getStyle().layers) {
        if (/^building/.test(l.id)) m.setLayoutProperty(l.id, "visibility", "none");
      }
      m.addSource("sat", {
        type: "raster", tileSize: 256, maxzoom: 19,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      });
      // just above the background layer, below everything else
      m.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } }, m.getStyle().layers[1]?.id);
      const firstLabel = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
      m.addSource("bld", { type: "vector", url: tileUrl(city.id), attribution: "Buildings: Global Building Atlas" });
      m.addSource("samples", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("lcz", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "LCZ: Demuzere et al. 2022" });
      m.addLayer({ id: "bld-fill", type: "fill", source: "bld", "source-layer": "b", minzoom: 12,
        paint: { "fill-color": colorExpr("gba"), "fill-opacity": 0.9 } }, firstLabel);
      m.addLayer({ id: "bld-ext", type: "fill-extrusion", source: "bld", "source-layer": "b", minzoom: 14,
        layout: { visibility: "none" },
        paint: { "fill-extrusion-color": colorExpr("gba"), "fill-extrusion-height": heightExpr("gba"), "fill-extrusion-opacity": 0.92 } }, firstLabel);
      m.addLayer({ id: "bld-line", type: "line", source: "bld", "source-layer": "b", minzoom: 15.5,
        paint: { "line-color": "#ffffff", "line-width": 0.4, "line-opacity": 0.7 } }, firstLabel);
      // translucent, over the footprints but under their outlines, the selection and the sample dots
      m.addLayer({ id: "lcz-fill", type: "fill", source: "lcz", layout: { visibility: "none" },
        paint: { "fill-color": lczColorExpr, "fill-opacity": 0.5 } }, "bld-line");
      m.addLayer({ id: "bld-sel", type: "line", source: "bld", "source-layer": "b", filter: ["==", ["get", "fid"], -1],
        paint: { "line-color": "#10233d", "line-width": 2.5 } });
      m.addLayer({ id: "samples-halo", type: "circle", source: "samples",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.6, 15, 6, 18, 9], "circle-color": "#10233d", "circle-opacity": 0.85 } });
      m.addLayer({ id: "samples", type: "circle", source: "samples",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 15, 4.2, 18, 6.5], "circle-color": colorExpr("gba") } });
      m.addLayer({ id: "samples-sel", type: "circle", source: "samples", filter: ["==", ["get", "fid"], -1],
        paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#165dff", "circle-stroke-width": 3 } });

      const pick = (e: maplibregl.MapMouseEvent) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ["samples", "bld-fill", "bld-ext"] }).find((x) => x.properties?.fid != null && x.properties.fid >= 0);
        if (f) setSelected(Number(f.properties!.fid));
      };
      m.on("click", pick);
      for (const l of ["samples", "bld-fill"]) {
        m.on("mousemove", l, (e) => {
          m.getCanvas().style.cursor = e.features?.some((x) => x.properties?.fid != null) ? "pointer" : "";
        });
      }
      setReady(true);
    });
    map.current = m;
    if (import.meta.env.DEV) (window as any).__map = m;
  }, [city]);

  // switching city: swap the tile archive and fly there
  useEffect(() => {
    if (!ready || !city || mapCity.current === city.id) return;
    const m = map.current!;
    mapCity.current = city.id;
    (m.getSource("bld") as maplibregl.VectorTileSource).setUrl(tileUrl(city.id));
    setSpin(false);
    setExtrude(false);
    m.flyTo({ center: city.center, zoom: city.zoom, pitch: 0, bearing: 0, duration: 1800 });
  }, [ready, city]);

  // LCZ polygons for the current city
  useEffect(() => {
    if (!ready || !cityId) return;
    const src = map.current!.getSource("lcz") as maplibregl.GeoJSONSource;
    let live = true;
    fetch(`${DATA}/${cityId}/lcz.geojson`).then((r) => (r.ok ? r.json() : Promise.reject())).then((fc) => {
      if (!live) return;
      src.setData(fc);
      setLczClasses([...new Set<number>(fc.features.map((f: any) => f.properties.lcz))].sort((a, b) => a - b));
    }).catch(() => {
      if (!live) return;
      src.setData({ type: "FeatureCollection", features: [] });
      setLczClasses([]);
    });
    return () => { live = false; };
  }, [ready, cityId]);

  useEffect(() => {
    if (ready) map.current!.setLayoutProperty("lcz-fill", "visibility", showLcz ? "visible" : "none");
  }, [ready, showLcz]);

  // satellite: hide the vector basemap's fills and roads (keep labels) and show imagery underneath our footprints
  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    if (satellite) {
      hiddenBySat.current = m.getStyle().layers
        .filter((l) => l.type !== "symbol" && l.type !== "background" && l.type !== "raster" && !["bld", "samples", "lcz"].includes((l as any).source ?? "")
          && m.getLayoutProperty(l.id, "visibility") !== "none")
        .map((l) => l.id);
      hiddenBySat.current.forEach((id) => m.setLayoutProperty(id, "visibility", "none"));
    } else {
      hiddenBySat.current.forEach((id) => m.setLayoutProperty(id, "visibility", "visible"));
      hiddenBySat.current = [];
    }
    m.setLayoutProperty("sat", "visibility", satellite ? "visible" : "none");
    m.setPaintProperty("bld-fill", "fill-opacity", satellite ? 0.62 : 0.9);
    m.setPaintProperty("bld-line", "line-color", satellite ? "#ffffff" : "#ffffff");
    m.setPaintProperty("bld-line", "line-opacity", satellite ? 0.9 : 0.7);
  }, [ready, satellite]);

  // sample points -> map (filtered)
  useEffect(() => {
    if (!ready) return;
    const src = map.current!.getSource("samples") as maplibregl.GeoJSONSource;
    src.setData({
      type: "FeatureCollection",
      features: filtered.map((s) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { fid: s.fid, h: s.h, ...(s.hl != null ? { hl: s.hl, dh: s.dh } : {}) },
      })),
    });
  }, [ready, filtered]);

  // mode and 3D
  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    const color = colorExpr(mode);
    m.setPaintProperty("bld-fill", "fill-color", color);
    m.setPaintProperty("bld-ext", "fill-extrusion-color", color);
    m.setPaintProperty("bld-ext", "fill-extrusion-height", heightExpr(mode));
    m.setPaintProperty("samples", "circle-color", color);
    m.setLayoutProperty("bld-ext", "visibility", extrude ? "visible" : "none");
    m.setLayoutProperty("bld-fill", "visibility", extrude ? "none" : "visible");
  }, [ready, mode, extrude]);

  useEffect(() => {
    if (!ready) return;
    map.current!.easeTo({ pitch: extrude ? TILT : 0, duration: 600 });
    if (!extrude) setSpin(false);
  }, [ready, extrude]);

  // spin: orbit slowly around the map centre (the selected building after a fly-to)
  useEffect(() => {
    if (!ready || !spin) return;
    const m = map.current!;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      m.setBearing(m.getBearing() + (t - (last || t)) * SPIN_DEG_PER_MS);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    // setBearing cancels running camera animations, so let the tilt/fly-to settle first
    const start = setTimeout(() => { raf = requestAnimationFrame(tick); }, m.isMoving() ? 1000 : 700);
    const stop = () => setSpin(false);
    m.on("mousedown", stop);
    m.on("touchstart", stop);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(raf);
      m.off("mousedown", stop);
      m.off("touchstart", stop);
    };
  }, [ready, spin]);

  // selection
  useEffect(() => {
    if (!ready) return;
    const m = map.current!;
    const f = ["==", ["get", "fid"], selected ?? -1] as any;
    m.setFilter("bld-sel", f);
    m.setFilter("samples-sel", f);
    if (selectedSample) {
      setTab("inspect");
      m.flyTo({ center: [selectedSample.lon, selectedSample.lat], zoom: Math.max(m.getZoom(), 17.5), duration: 900 });
    }
  }, [ready, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    setter(n);
  };

  const startSpin = () => {
    if (spin) return setSpin(false);
    setExtrude(true);
    setSpin(true);
  };

  const idx = selected == null ? -1 : sorted.findIndex((s) => s.fid === selected);
  const step = (d: number) => {
    if (!sorted.length) return;
    setSelected(sorted[(Math.max(idx, 0) + d + sorted.length) % sorted.length].fid);
  };

  return (
    <div className="app-shell">
      <div className="viewer-layout">
        <section className="map-stage">
          <header className="map-header">
            <div>
              <p className="eyebrow">Street View morphology pilot</p>
              <h1>Building heights: GBA vs LLM</h1>
            </div>
            <div className="map-meta">
              {cities.length > 1 ? (
                <select value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="City">
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.country}</option>)}
                </select>
              ) : (
                <span>{city ? `${city.name}, ${city.country}` : ""}</span>
              )}
              <span>
                {city?.buildings ? `${city.buildings.toLocaleString()} footprints · ` : ""}
                {labelled ? `${samples.length} with street-view labels · ` : "footprints only · "}
                zoom in past 12
              </span>
            </div>
          </header>
          <div className="map-wrap">
            <div ref={mapEl} className="map-canvas" />
            <div className="map-overlay">
              <div className="segmented" role="tablist" aria-label="Colour by">
                {MODES.map((o) => (
                  <button
                    key={o.id}
                    className={mode === o.id ? "on" : ""}
                    onClick={() => setMode(o.id)}
                    disabled={o.id !== "gba" && !labelled}
                    title={o.id !== "gba" && !labelled ? "No street-view labels for this city yet" : o.hint}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <label className="check"><input type="checkbox" checked={extrude} onChange={(e) => setExtrude(e.target.checked)} /> 3D extrusion</label>
              {extrude && (
                <div className="view-controls">
                  <label>Rotate
                    <input type="range" min={0} max={359} value={bearing} onChange={(e) => map.current?.setBearing(Number(e.target.value))} />
                  </label>
                  <label>Tilt
                    <input type="range" min={0} max={75} value={pitch} onChange={(e) => map.current?.setPitch(Number(e.target.value))} />
                  </label>
                  <button className={`spin-btn ${spin ? "on" : ""}`} onClick={startSpin}>{spin ? "Stop spinning" : "Spin around view centre"}</button>
                  <p className="hint">Or right-drag (Ctrl-drag) to rotate and tilt. Select a building first to spin around it.</p>
                </div>
              )}
              {!extrude && (
                <button className="spin-btn" onClick={startSpin}>Spin in 3D</button>
              )}
              <div className="basemap-toggle" role="group" aria-label="Basemap">
                <button className={!satellite ? "on" : ""} onClick={() => setSatellite(false)}>Map</button>
                <button className={satellite ? "on" : ""} onClick={() => setSatellite(true)}>Satellite</button>
              </div>
              <Legend mode={mode} />
              <label className="check" title={lczClasses.length ? undefined : "No LCZ data exported for this city"}>
                <input type="checkbox" checked={showLcz && lczClasses.length > 0} disabled={!lczClasses.length} onChange={(e) => setShowLcz(e.target.checked)} />
                Local climate zones (LCZ)
              </label>
              {showLcz && lczClasses.length > 0 && <LczLegend classes={lczClasses} />}
            </div>
          </div>
        </section>

        <aside className="control-panel">
          <div className="tabs three">
            <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
            <button className={tab === "inspect" ? "on" : ""} onClick={() => setTab("inspect")} disabled={!labelled}>
              Inspect{selected != null ? ` #${selected}` : ""}
            </button>
            <button className={tab === "about" ? "on" : ""} onClick={() => setTab("about")}>About</button>
          </div>

          <div className="panel-body">
            {tab === "about" && <About city={city} assumptions={assumptions} />}

            {tab !== "about" && !labelled && (
              <div className="empty-note">
                <b>{city?.name}</b> has GBA footprints only. Colours show the GBA height. No Street View sample has been run here yet,
                so there are no LLM heights, differences or photos to inspect. Switch to Chiang Mai in the city menu to see those.
              </div>
            )}

            {tab !== "about" && labelled && (
              <>
                <div className="filters">
                  <div>
                    <span className="k">Confidence</span>
                    {CONFS.map((c) => (
                      <label key={c} className={`chip ${confs.has(c) ? "on" : ""}`}>
                        <input type="checkbox" checked={confs.has(c)} onChange={() => toggle(confs, setConfs, c)} />{c}
                      </label>
                    ))}
                  </div>
                  <div>
                    <span className="k">Use</span>
                    {USES.map((u) => (
                      <label key={u} className={`chip ${uses.has(u) ? "on" : ""}`}>
                        <input type="checkbox" checked={uses.has(u)} onChange={() => toggle(uses, setUses, u)} />{u}
                      </label>
                    ))}
                  </div>
                  <div>
                    <span className="k">Photo quality</span>
                    <label className={`chip ${onlyCut ? "on" : ""}`}>
                      <input type="checkbox" checked={onlyCut} onChange={() => setOnlyCut(!onlyCut)} />
                      roof probably out of frame ({samples.filter((x) => x.cut).length})
                    </label>
                    <label className={`chip ${onlySliver ? "on" : ""}`}>
                      <input type="checkbox" checked={onlySliver} onChange={() => setOnlySliver(!onlySliver)} />
                      possible wrong building ({samples.filter((x) => x.sliver).length})
                    </label>
                    <label className={`chip ${hideWrong ? "on" : ""}`}>
                      <input type="checkbox" checked={hideWrong} onChange={() => setHideWrong(!hideWrong)} />
                      hide those I marked wrong ({nWrong})
                    </label>
                  </div>
                </div>

                {tab === "overview" && (
                  <>
                    <div className="stats">
                      <div><span className="k">Buildings</span><strong>{stats?.n ?? 0}</strong></div>
                      <div><span className="k">MAE</span><strong>{fmt(stats?.mae)} m</strong></div>
                      <div><span className="k">Bias (LLM − GBA)</span><strong>{signed(stats?.bias)} m</strong></div>
                      <div><span className="k">Correlation</span><strong>{fmt(stats?.corr, 2)}</strong></div>
                    </div>
                    <div className="review">
                      <span className="k">Your review</span>
                      <strong>{reviewed}</strong> of {samples.length} checked
                      {reviewed > 0 && <> · <strong>{nWrong}</strong> marked wrong building ({Math.round((100 * nWrong) / reviewed)}%)</>}
                      <button onClick={downloadVerdicts} disabled={!reviewed}>Download CSV</button>
                      <p className="hint">Verdicts are saved in this browser only. Use the Inspect tab to mark each building.</p>
                    </div>
                    <h3>GBA vs LLM height</h3>
                    <Scatter samples={filtered} selected={selected} onSelect={setSelected} />
                    <p className="hint">
                      Dots below the line: the LLM estimate is lower than GBA. {city?.source}. LLM heights are storeys × an assumed floor height by use
                      (plus a roof allowance). The assumptions are listed in the About tab and are not measured. No ground truth is available yet.
                    </p>
                  </>
                )}

                {tab === "inspect" && (selectedSample ? (
                  <Detail
                    sample={selectedSample}
                    base={base}
                    position={idx >= 0 ? `${idx + 1} of ${sorted.length}` : "filtered out"}
                    verdict={verdicts[selectedSample.fid]}
                    onVerdict={(v) => setVerdict(selectedSample.fid, v)}
                    onPrev={() => step(-1)}
                    onNext={() => step(1)}
                    onClose={() => { setSelected(null); setTab("overview"); }}
                  />
                ) : (
                  <p className="hint">Click a dot or footprint on the map, or pick a building from the list below.</p>
                ))}

                <div className="browse">
                  <div className="browse-head">
                    <h3>Browse buildings</h3>
                    <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort">
                      <option value="absdiff">Largest disagreement</option>
                      <option value="diff">LLM taller first</option>
                      <option value="gba">GBA tallest first</option>
                    </select>
                  </div>
                  <ul>
                    {sorted.slice(0, 200).map((s) => (
                      <li key={s.fid} className={s.fid === selected ? "on" : ""} onClick={() => setSelected(s.fid)}>
                        <span>#{s.fid} · {s.use}{s.cut && <span className="cut-mark" title="Roof probably out of frame in every photo">▲</span>}{s.sliver && <span className="cut-mark" title="Very thin footprint: possible wrong building">◆</span>}</span>
                        <span>{fmt(s.h)} → {s.hl == null ? "–" : fmt(s.hl)} m <b>{signed(s.dh)}</b>{verdicts[s.fid] && <i className={`vmark ${verdicts[s.fid]}`}>{VERDICTS.find((v) => v.id === verdicts[s.fid])!.mark}</i>}</span>
                      </li>
                    ))}
                  </ul>
                  {sorted.length > 200 && <p className="hint">Showing the first 200 of {sorted.length}. Use the filters to narrow.</p>}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
