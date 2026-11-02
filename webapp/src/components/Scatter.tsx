import { DIFF_STOPS, NO_DATA, colorFor, type Sample } from "../lib";

const SIZE = 300;
const PAD = 34;
const MAX = 25;

interface Props {
  samples: Sample[];
  selected: number | null;
  onSelect: (fid: number) => void;
}

export default function Scatter({ samples, selected, onSelect }: Props) {
  const sc = (v: number) => PAD + (Math.min(v, MAX) / MAX) * (SIZE - PAD - 10);
  const sy = (v: number) => SIZE - sc(v) + PAD - 10;
  const ticks = [0, 5, 10, 15, 20, 25];
  const pts = samples.filter((d) => d.hl != null);
  const sel = pts.find((d) => d.fid === selected);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="scatter" role="img" aria-label="GBA height against LLM height">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sc(t)} x2={sc(t)} y1={sy(0)} y2={sy(MAX)} className="grid" />
          <line x1={sc(0)} x2={sc(MAX)} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={sc(t)} y={SIZE - 14} textAnchor="middle" className="tick">{t}</text>
          <text x={PAD - 6} y={sy(t) + 3} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      <line x1={sc(0)} y1={sy(0)} x2={sc(MAX)} y2={sy(MAX)} className="one-to-one" />
      {pts.map((d) => (
        <circle
          key={d.fid}
          cx={sc(d.h)}
          cy={sy(d.hl as number)}
          r={3.4}
          fill={colorFor(DIFF_STOPS, d.dh ?? 0) === "#f2f2f2" ? NO_DATA : colorFor(DIFF_STOPS, d.dh ?? 0)}
          className="dot"
          onClick={() => onSelect(d.fid)}
        />
      ))}
      {sel && <circle cx={sc(sel.h)} cy={sy(sel.hl as number)} r={7} className="dot-selected" />}
      <text x={SIZE / 2 + 12} y={SIZE - 1} textAnchor="middle" className="axis">GBA height (m)</text>
      <text transform={`translate(10 ${SIZE / 2 - 10}) rotate(-90)`} textAnchor="middle" className="axis">LLM height (m)</text>
    </svg>
  );
}
