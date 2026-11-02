import { LCZ_COLORS, LCZ_NAMES, lczLabel } from "../lib";

/** Swatches for the LCZ classes present in the current city. */
export default function LczLegend({ classes }: { classes: number[] }) {
  return (
    <ul className="lcz-legend" aria-label="Local climate zones">
      {classes.map((c) => (
        <li key={c}>
          <i style={{ background: LCZ_COLORS[c] }} />
          <b>{lczLabel(c)}</b> {LCZ_NAMES[c]}
        </li>
      ))}
    </ul>
  );
}
