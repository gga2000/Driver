import { t } from '@driver/i18n';
import type { ReactNode } from 'react';
import { barHeights, heatStep, hourWords } from '@/lib/people';
import { cx } from '../ui';

/**
 * The profile charts («الناس»): one series each, saffron on the card, numbers in text ink, a hover
 * title on every mark and an aria label that says the shape in words (dataviz: single hue for
 * magnitude, thin marks with 4 px data ends on the baseline, no second axis). Time runs left→right
 * even in RTL, like the kit's sparklines and the numbers themselves, so every chart on a page agrees.
 */

const HEAT = ['bg-surface-3', 'bg-accent-tint', 'bg-accent/55', 'bg-accent', 'bg-accent-text'] as const;

/** Vertical bars on one baseline; the last bar lighter when it is a period still running. */
export function Bars({
  values,
  tips,
  label,
  height = 120,
  partialLast = false,
  showValues = true,
  axis,
}: {
  values: readonly number[];
  tips: readonly string[];
  label: string;
  height?: number;
  partialLast?: boolean;
  showValues?: boolean;
  axis?: ReactNode;
}) {
  const hs = barHeights(values, height);
  if (!values.some((v) => v > 0)) return <p className="py-6 text-center text-dense text-muted">{t('console.ppl_chart_empty')}</p>;
  return (
    <figure className="m-0" dir="ltr">
      <div role="img" aria-label={label} className="flex items-end gap-1.5 border-b border-line px-1" style={{ height: height + 20 }}>
        {values.map((v, i) => (
          <div key={i} title={tips[i]} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            {showValues && v > 0 ? <span className="num text-xs leading-4 text-muted">{v}</span> : null}
            <span
              className={cx('block w-full max-w-[30px] rounded-t-[4px]', partialLast && i === values.length - 1 ? 'bg-accent/45' : 'bg-accent')}
              style={{ height: hs[i] }}
            />
          </div>
        ))}
      </div>
      {axis ? <figcaption className="mt-1.5 flex justify-between text-xs text-faint">{axis}</figcaption> : null}
    </figure>
  );
}

/** The 24 hours of the day in one row, darker for more. */
export function HourStrip({ hours, label }: { hours: readonly number[]; label: string }) {
  const top = Math.max(...hours, 0);
  if (!hours.some((v) => v > 0)) return <p className="py-6 text-center text-dense text-muted">{t('console.ppl_chart_empty')}</p>;
  return (
    <figure className="m-0" dir="ltr">
      <div role="img" aria-label={label} className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {hours.map((v, h) => (
          <span key={h} title={t('console.ppl_hour_tip', { hour: hourWords(h), n: v })} className={cx('h-8 rounded-[3px]', HEAT[heatStep(v, top)])} />
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-xs text-faint">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h} dir="rtl">
            {hourWords(h)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Weekday rows × 24 hours (a driver's working pattern). `rows[0]` is Sunday. */
export function WeekHeat({ rows, label }: { rows: readonly (readonly number[])[]; label: string }) {
  const top = Math.max(...rows.flat(), 0);
  if (!rows.flat().some((v) => v > 0)) return <p className="py-6 text-center text-dense text-muted">{t('console.ppl_chart_empty')}</p>;
  // Saturday first: the Iraqi week.
  const order = [6, 0, 1, 2, 3, 4, 5];
  return (
    <figure className="m-0" dir="ltr">
      <div role="img" aria-label={label} className="grid items-center gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr)) 4.5rem' }}>
        {order.map((d) => (
          <Row key={d} day={d} cells={rows[d] ?? []} top={top} />
        ))}
      </div>
      <figcaption className="mt-1.5 grid text-xs text-faint" style={{ gridTemplateColumns: '1fr 4.5rem' }}>
        <span className="flex justify-between">
          {[0, 6, 12, 18, 23].map((h) => (
            <span key={h} dir="rtl">
              {hourWords(h)}
            </span>
          ))}
        </span>
        <span />
      </figcaption>
    </figure>
  );
}

function Row({ day, cells, top }: { day: number; cells: readonly number[]; top: number }) {
  const name = t(`console.ppl_dow_${day}` as 'console.ppl_dow_0');
  return (
    <>
      {Array.from({ length: 24 }, (_, h) => h).map((h) => (
        <span key={h} title={t('console.ppl_heat_tip', { day: name, hour: hourWords(h), n: cells[h] ?? 0 })} className={cx('h-5 rounded-[3px]', HEAT[heatStep(cells[h] ?? 0, top)])} />
      ))}
      <span dir="rtl" className="truncate ps-2 text-xs text-muted">
        {name}
      </span>
    </>
  );
}

/** Horizontal bars for a few named parts of a whole (services, offers), longest first. */
export function ShareBars({ items, label }: { items: ReadonlyArray<{ key: string; label: ReactNode; value: number; text?: string }>; label: string }) {
  const top = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul aria-label={label} className="m-0 list-none space-y-1.5 p-0">
      {items.map((i) => (
        <li key={i.key} className="grid items-center gap-2.5" style={{ gridTemplateColumns: '5.5rem 1fr 3rem' }}>
          <span className="truncate text-dense">{i.label}</span>
          <span className="h-2.5 rounded-e-[4px] bg-accent" style={{ width: top > 0 && i.value > 0 ? `${Math.max(2, Math.round((i.value / top) * 100))}%` : 0 }} />
          <span className="num text-end text-dense text-muted">{i.text ?? i.value}</span>
        </li>
      ))}
    </ul>
  );
}
