import type { ReactNode } from 'react';
import { cx } from './button';

/**
 * Numbers people act on. A tile is a label, a big tabular number and at most one line of context;
 * `delta` compares with a reference ("+3 من أمس") and colours by whether up is good, with an arrow
 * so direction never rides on colour alone. `spark` draws the last few values as a 2-px line.
 */

export type StatTone = 'default' | 'bad' | 'ok' | 'accent' | 'warn';

const VALUE: Record<StatTone, string> = {
  default: 'text-text',
  bad: 'text-bad',
  ok: 'text-ok',
  accent: 'text-accent-text',
  warn: 'text-warn',
};

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  delta,
  spark,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  delta?: { value: number; text: string; goodWhen: 'up' | 'down' };
  spark?: number[];
  className?: string;
}) {
  return (
    <div
      className={cx(
        'min-w-0 rounded-lg border border-line bg-surface px-4 py-3 shadow-card',
        className,
      )}
    >
      <dt className="truncate text-dense text-muted">{label}</dt>
      <dd className="mt-1 flex items-end justify-between gap-3">
        <span
          className={cx('num text-[26px] font-semibold leading-9 tracking-[-0.01em]', VALUE[tone])}
        >
          {value}
        </span>
        {spark && spark.length > 1 ? <Sparkline values={spark} tone={tone} /> : null}
      </dd>
      {delta ? <Delta {...delta} /> : null}
      {hint ? <dd className="mt-0.5 truncate text-xs text-faint">{hint}</dd> : null}
    </div>
  );
}

export function Delta({
  value,
  text,
  goodWhen,
}: {
  value: number;
  text: string;
  goodWhen: 'up' | 'down';
}) {
  const flat = value === 0;
  const good = flat ? null : goodWhen === 'up' ? value > 0 : value < 0;
  return (
    <dd
      className={cx(
        'mt-0.5 inline-flex items-center gap-1 text-xs font-medium',
        good === null ? 'text-muted' : good ? 'text-ok' : 'text-bad',
      )}
    >
      <span aria-hidden>{flat ? '–' : value > 0 ? '▲' : '▼'}</span>
      <span className="num">{text}</span>
    </dd>
  );
}

/** A tiny line of recent values; the last point is marked. Decorative: the number beside it is the data. */
export function Sparkline({
  values,
  tone = 'default',
  width = 72,
  height = 24,
}: {
  values: number[];
  tone?: StatTone;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map(
    (v, i) =>
      [
        (i / (values.length - 1)) * (width - 4) + 2,
        height - 3 - ((v - min) / span) * (height - 6),
      ] as const,
  );
  const [stroke, fill] =
    tone === 'bad'
      ? ['stroke-bad', 'fill-bad']
      : tone === 'ok'
        ? ['stroke-ok', 'fill-ok']
        : tone === 'warn'
          ? ['stroke-warn', 'fill-warn']
          : ['stroke-accent-text', 'fill-accent-text'];
  const last = pts[pts.length - 1]!;
  return (
    // Time runs left→right even in RTL (charts keep the reading convention of numbers).
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      style={{ direction: 'ltr' }}
    >
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={stroke}
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" className={fill} />
    </svg>
  );
}

/** Tiles in one row that share a frame (fewer boxes than a grid of cards). */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cx(
        'grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]',
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** A thin meter: used/cap with the cap's state in words beside it. */
export function Meter({
  value,
  max,
  tone,
  label,
}: {
  value: number;
  max: number;
  tone?: 'ok' | 'warn' | 'bad';
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const t = tone ?? (pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok');
  const fill = t === 'bad' ? 'bg-bad-solid' : t === 'warn' ? 'bg-warn-solid' : 'bg-ok-solid';
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className="h-1.5 overflow-hidden rounded-pill bg-surface-3"
    >
      <div
        className={cx('h-full rounded-pill transition-[width] duration-base', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
