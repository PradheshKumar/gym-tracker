import { fmtDate, fromKey } from '../lib/dates';
import type { DateKey } from '../lib/types';

export interface Series {
  name: string;
  points: { x: DateKey; y: number }[];
  color: string;
  dots?: boolean;
  line?: boolean;
  dashed?: boolean;
}

export interface ChartProps {
  series: Series[];
  band?: { x: DateKey; lo: number; hi: number }[];
  goals?: { y: number; label: string }[];
  markers?: { x: DateKey; y: number; label: string }[];
  height?: number;
  unit?: string;
  empty?: string;
}

const W = 340;

/** Small dependency-free SVG line chart sized for phones. */
export function LineChart({ series, band, goals = [], markers = [], height = 170, unit = '', empty = 'No data yet' }: ChartProps) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div className="chart-empty">{empty}</div>;
  const xs = [...all.map((p) => p.x), ...markers.map((m) => m.x), ...(band ?? []).map((b) => b.x)].map((x) => fromKey(x).getTime());
  const ys = [
    ...all.map((p) => p.y),
    ...goals.map((g) => g.y),
    ...markers.map((m) => m.y),
    ...(band ?? []).flatMap((b) => [b.lo, b.hi]),
  ];
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x0 === x1) {
    x0 -= 86400000 * 3;
    x1 += 86400000 * 3;
  }
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.1 || 1;
  y0 -= pad;
  y1 += pad;
  const L = 34;
  const R = 8;
  const T = 8;
  const B = 20;
  const sx = (x: DateKey) => L + ((fromKey(x).getTime() - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (height - T - B);
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const path = (pts: { x: DateKey; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const toKey = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={L - 4} y={sy(t) + 3} textAnchor="end" className="axis">
              {t.toFixed(Math.abs(y1 - y0) < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        <text x={L} y={height - 5} className="axis">
          {fmtDate(toKey(x0))}
        </text>
        <text x={W - R} y={height - 5} textAnchor="end" className="axis">
          {fmtDate(toKey(x1))}
        </text>
        {band && band.length > 1 && (
          <path
            d={
              band.map((b, i) => `${i ? 'L' : 'M'}${sx(b.x)},${sy(b.hi)}`).join('') +
              [...band].reverse().map((b) => `L${sx(b.x)},${sy(b.lo)}`).join('') +
              'Z'
            }
            fill="var(--band)"
          />
        )}
        {goals.map((g, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(g.y)} y2={sy(g.y)} stroke="var(--goal)" strokeDasharray="4 3" strokeWidth={1} />
            <text x={W - R} y={sy(g.y) - 3} textAnchor="end" className="axis goal-label">
              {g.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            {s.line !== false && s.points.length > 1 && (
              <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} />
            )}
            {(s.dots || s.points.length === 1) &&
              s.points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill={s.color} opacity={0.75} />)}
          </g>
        ))}
        {markers.map((m, i) => (
          <g key={i}>
            <rect x={sx(m.x) - 3} y={sy(m.y) - 3} width={6} height={6} fill="var(--goal)" transform={`rotate(45 ${sx(m.x)} ${sy(m.y)})`} />
          </g>
        ))}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        {unit && <span className="muted">{unit}</span>}
      </div>
    </div>
  );
}
