// Small server-rendered SVG charts for the reports. One series per chart (one hue, no legend
// needed: the card title names the series), recessive grid and axes, 4px rounded data ends on the
// baseline, a 2px gap between bars, and a hover tooltip on every bar (SVG <title> on an oversized
// hit target). Every chart sits next to a table with the same numbers.

const SERIES = "#2a78d6";
const GRID = "#e5e7eb";
const INK_2 = "#52514e";

export type Point = { label: string; value: number; tip?: string };

const fmt = (v: number, money?: boolean) => (money ? `$${Math.round(v).toLocaleString("en-US")}` : Math.round(v).toLocaleString("en-US"));
const niceMax = (m: number) => { if (m <= 0) return 1; const p = 10 ** Math.floor(Math.log10(m)); const n = m / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Vertical bars over time (days, weeks, months). */
export function Bars({ data, height = 180, money = false, ariaLabel }: { data: Point[]; height?: number; money?: boolean; ariaLabel: string }) {
  const W = 760, H = height, padL = 52, padB = 26, padT = 8;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const slot = plotW / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(28, slot - 2));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const every = Math.ceil(data.length / 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
      {ticks.map((t) => { const y = padT + plotH - (t / max) * plotH; return <g key={t}><line x1={padL} x2={W - 8} y1={y} y2={y} stroke={GRID} strokeWidth={1} /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill={INK_2}>{fmt(t, money)}</text></g>; })}
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotH);
        const x = padL + i * slot + (slot - bw) / 2, y = padT + plotH - h;
        const r = Math.min(4, bw / 2, h);
        const path = h > 0 ? `M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${padT + plotH} Z` : "";
        return (
          <g key={i}>
            <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent"><title>{d.tip ?? `${d.label}: ${fmt(d.value, money)}`}</title></rect>
            {path && <path d={path} fill={SERIES} pointerEvents="none" />}
            {i % every === 0 && <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={INK_2}>{d.label}</text>}
          </g>
        );
      })}
      <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} stroke="#9ca3af" strokeWidth={1} />
    </svg>
  );
}

/** Horizontal ranked bars (by producer, carrier, line). Labels and values in ink, the bar carries the magnitude. */
export function HBars({ data, money = false }: { data: Point[]; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-1.5 px-4 py-3">
      {data.map((d) => (
        <li key={d.label} title={d.tip ?? `${d.label}: ${fmt(d.value, money)}`} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem] items-center gap-3 text-xs">
          <span className="truncate text-slate-700">{d.label}</span>
          <span className="h-3 rounded-r bg-slate-100"><span className="block h-3 rounded-r" style={{ width: `${(d.value / max) * 100}%`, background: SERIES, minWidth: d.value > 0 ? 2 : 0 }} /></span>
          <span className="text-right tabular-nums text-slate-700">{fmt(d.value, money)}</span>
        </li>
      ))}
    </ul>
  );
}
