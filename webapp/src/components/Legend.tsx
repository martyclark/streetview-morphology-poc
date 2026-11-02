import { DIFF_STOPS, HEIGHT_STOPS, NO_DATA, type Mode } from "../lib";

export default function Legend({ mode }: { mode: Mode }) {
  const stops = mode === "diff" ? DIFF_STOPS : HEIGHT_STOPS;
  const gradient = `linear-gradient(90deg, ${stops.map(([, c]) => c).join(", ")})`;
  const labels = mode === "diff" ? ["−8 m", "0", "+8 m"] : ["0 m", "12 m", "35 m"];
  const caption =
    mode === "diff"
      ? "LLM height minus GBA height (red: LLM taller, blue: GBA taller)"
      : mode === "llm"
        ? "Height from LLM storey count × assumed floor height (see About)"
        : "Global Building Atlas height";
  return (
    <div className="legend">
      <div className="legend-bar" style={{ background: gradient }} />
      <div className="legend-labels">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <p>{caption}</p>
      {mode !== "gba" && (
        <p className="legend-nodata">
          <i style={{ background: NO_DATA }} /> not sampled, or the model could not judge
        </p>
      )}
    </div>
  );
}
