import { LCZ_NAMES, type City } from "../lib";

const FLOOR_ROWS: [string, string][] = [
  ["residential", "3.0 m"], ["institutional", "3.2 m"], ["commercial", "3.5 m"], ["mixed", "3.5 m"],
  ["industrial", "4.5 m"], ["ancillary", "3.0 m"], ["vacant", "0 m"],
];

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">{children}</a>
);

export default function About({ city }: { city?: City }) {
  return (
    <div className="about">
      <h3>What this shows</h3>
      <p>
        A proof of concept for estimating building height from street-level photos. For a sample of buildings, an image model counts
        the storeys and guesses the use from Street View crops. The result is converted to a height and compared with the height in the
        Global Building Atlas (GBA). The map colours every GBA footprint by height. The sampled buildings can be recoloured by the
        LLM-derived height or by the difference between the two (LLM − GBA).
      </p>
      <p>
        Neither source is ground truth. A large difference means the sources disagree. It does not say which one is right, so use the
        photos in the Inspect tab to judge.
      </p>

      <h3>How the estimate is made</h3>
      <ol>
        <li>
          <b>Sampling.</b> Buildings are drawn in strata of Local Climate Zone (LCZ). Allocation is Neyman, so more draws go to zones where
          GBA height varies most. The Chiang Mai frame has 1,072 draws, aiming for about 300 usable after attrition.
        </li>
        <li>
          <b>Finding imagery.</b> Free Street View metadata look-ups are made at the building centroid and a ring of points 25 m around it.
          Panoramas are de-duplicated and scored on distance (6–35 m) and line of sight. Up to three are kept, with different viewing directions.
        </li>
        <li>
          <b>Photos.</b> Each kept panorama gives one 640 × 640 crop aimed at the building, with the field of view set from the footprint width.
        </li>
        <li>
          <b>Labelling.</b> All crops of a building go to the image model together, at temperature 0, with a structured answer: whether the
          target is visible in each photo, the number of above-ground storeys, the use, a confidence, and a note. If the views disagree or the
          building is hidden, storeys is left empty and the building gets no LLM height.
        </li>
        <li>
          <b>Second pass.</b> The 180 low-confidence or empty cases were re-run with a larger model, with extra hints (camera distance,
          footprint area and a red tick marking the target). That answer is shown as a second opinion and is not used in the map colours.
        </li>
        <li>
          <b>Height.</b> LLM height = storeys × a floor height that depends on the use + 1.5 m for a pitched roof. Vacant plots get 0 m.
        </li>
      </ol>
      <table className="floor-table">
        <thead><tr><th>Use</th><th>Floor height</th></tr></thead>
        <tbody>{FLOOR_ROWS.map(([u, h]) => <tr key={u}><td>{u}</td><td>{h}</td></tr>)}</tbody>
      </table>
      <p className="hint">Floor heights and the roof allowance are assumptions, not measurements. Storey counts are integers, so LLM heights are steps.</p>

      <h3>Datasets and software</h3>
      <ul className="sources">
        <li>
          <b>Building footprints and heights:</b> <A href="https://www.gba.ovgu.de/">Global Building Atlas</A> (GBA), Zhu et al. 2025,
          <i> Earth System Science Data</i>. Footprints for the whole city and the "GBA height". Heights are modelled from satellite data, not surveyed.
        </li>
        <li>
          <b>Sampling strata:</b> <A href="https://zenodo.org/records/8419340">Global 100 m Local Climate Zone map, v3 (filtered)</A>,
          Demuzere et al. 2022, <i>Earth System Science Data</i>. Used only to stratify the sample ({Object.entries(LCZ_NAMES).slice(0, 3).map(([k, v]) => `LCZ ${k} ${v}`).join(", ")}…).
        </li>
        <li>
          <b>Street-level imagery:</b> <A href="https://developers.google.com/maps/documentation/streetview/overview">Google Street View Static API</A>.
          Photos © Google, shown here for research and inspection only. Capture dates are given under each photo.
        </li>
        <li>
          <b>Image model:</b> Google Gemini through the Gemini API. First pass: Gemini 3.1 Flash-Lite on every sampled building. Second pass: Gemini 3 Flash on the hard cases.
        </li>
        <li>
          <b>Satellite imagery:</b> Esri World Imagery (© Esri, Maxar, Earthstar Geographics), shown with the Satellite toggle.
        </li>
        <li>
          <b>360° view:</b> the free <A href="https://developers.google.com/maps/documentation/embed/get-started">Google Maps Embed API</A>, which opens the same panorama the photo came from.
        </li>
        <li>
          <b>Basemap:</b> © <A href="https://carto.com/attributions">CARTO</A>, data © <A href="https://www.openstreetmap.org/copyright">OpenStreetMap</A> contributors.
        </li>
        <li>
          <b>Rendering:</b> <A href="https://maplibre.org/">MapLibre GL JS</A> with a single-file <A href="https://protomaps.com/docs/pmtiles">PMTiles</A> archive of GBA footprints.
        </li>
        {city?.labelled === false && (
          <li><b>{city.name}:</b> GBA footprints only. No Street View sample has been run there yet, so there are no LLM heights.</li>
        )}
      </ul>

      <h3>Known limits</h3>
      <ul>
        <li>The sample is not representative of the whole city. It is stratified by LCZ and limited to places with usable Street View coverage.</li>
        <li>
          Each photo is a fixed crop. In 35 sampled buildings the LLM height is above what stays in frame in every photo, so the roof is
          probably cut off (▲ in the list, and the "roof probably out of frame" filter). The flag is an estimate from camera distance,
          field of view and footprint width, assuming a 2.5 m camera and a roughly square footprint. Treat those heights as lower bounds.
        </li>
        <li>
          Slivers (◆): footprints under 4 m wide, or more than 5:1 long, are often not a whole building, so the photo may show a neighbour.
          This is a geometry flag only. The "Is this the building on the map?" buttons in Inspect let you record your own verdict, saved in your browser and exportable as CSV.
        </li>
        <li>The model can label the wrong building or a taller neighbour. Check the photo.</li>
        <li>Some GBA heights are implausibly low (below 1 m), which creates large differences that are not labelling errors.</li>
        <li>Street View photos and GBA were captured at different times, so a real change in the building can show up as a difference.</li>
      </ul>
    </div>
  );
}
