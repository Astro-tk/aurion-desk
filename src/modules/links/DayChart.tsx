import { formatDate } from '@/lib/format';
import type { LinkStats } from './queries';

/** Views (outline) and clicks (lime) per day. Plain SVG: no chart library, no inline styles. */
export function DayChart({ days }: { days: LinkStats['by_day'] }) {
  const w = 600;
  const h = 140;
  const pad = 18;
  const max = Math.max(1, ...days.map((d) => d.views), ...days.map((d) => d.clicks));
  const slot = (w - pad * 2) / Math.max(1, days.length);
  const bar = Math.max(2, slot * 0.7);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const first = days[0]?.day;
  const last = days.at(-1)?.day;
  const total = days.reduce((n, d) => n + d.views, 0);
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`Daily views and clicks, ${total} views in total`}>
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="stroke-line" strokeWidth="1" />
        {days.map((d, i) => {
          const x = pad + i * slot + (slot - bar) / 2;
          return (
            <g key={String(d.day)}>
              <title>{`${formatDate(String(d.day).slice(0, 10))}: ${d.views} views, ${d.clicks} clicks`}</title>
              <rect x={x} y={y(d.views)} width={bar} height={h - pad - y(d.views)} rx="1" className="fill-surface-2 stroke-ink-3" strokeWidth="0.5" />
              <rect x={x + bar * 0.2} y={y(d.clicks)} width={bar * 0.6} height={h - pad - y(d.clicks)} rx="1" className="fill-accent" />
            </g>
          );
        })}
        <text x={w - pad} y={pad - 6} textAnchor="end" className="fill-ink-3 text-[10px]">
          {max} max
        </text>
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-ink-3">
        <span className="num">{first ? formatDate(String(first).slice(0, 10)) : ''}</span>
        <span>
          <span className="mr-3">Outline: views</span>
          <span className="text-accent">Lime: clicks</span>
        </span>
        <span className="num">{last ? formatDate(String(last).slice(0, 10)) : ''}</span>
      </figcaption>
    </figure>
  );
}
