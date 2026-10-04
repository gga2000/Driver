'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AZIZIYAH_ZONES, INTERCITY_DESTINATIONS, type PriceRequestInput, type QuoteComponent, type Vertical, type ZoneTier } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { formatClock, formatIqd, formatMoney, formatSigned, fromLocalInputValue, toLocalInputValue } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';

const CITY_ID = 'aziziyah';
const CITY_TZ = 'Asia/Baghdad';

/** Verticals the simulator offers, in menu order. */
const VERTICALS = ['food', 'taxi', 'tuktuk', 'intercity', 'parcel', 'errand'] as const satisfies readonly Vertical[];
type SimVertical = (typeof VERTICALS)[number];

const RIDES: ReadonlySet<Vertical> = new Set(['taxi', 'tuktuk', 'intercity']);
const TIERS: readonly ZoneTier[] = ['centre', 'near', 'mid', 'far', 'edge'];
const INTERCITY_IDS: ReadonlySet<string> = new Set(INTERCITY_DESTINATIONS.map((d) => d.id));

const tierKey = (tier: ZoneTier): MessageKey => `console.tier_${tier}`;
const verticalKey = (v: SimVertical): MessageKey => `console.vertical_${v}`;

/** The 34 zones grouped by tier, in tier order; Arabic names as the seed spells them. */
const ZONE_GROUPS = TIERS.map((tier) => ({
  tier,
  zones: AZIZIYAH_ZONES.filter((z) => z.tier === tier).map((z) => ({ id: z.id, name: z.name_ar })),
}));

type Pickup = 'door' | 'street';

interface SimState {
  vertical: SimVertical;
  from: string;
  to: string;
  pickup: Pickup;
  frontSeat: boolean;
  passengers: number;
  waitMinutes: number;
  promoIqd: number;
  distanceKm: number;
  durationMin: number;
  /** `datetime-local` string; empty means "now". */
  at: string;
}

const INITIAL: SimState = {
  vertical: 'food',
  from: 'centre',
  to: 'khamas', // plan acceptance: centre → الخماس shows 1,500
  pickup: 'door',
  frontSeat: false,
  passengers: 1,
  waitMinutes: 0,
  promoIqd: 0,
  distanceKm: 0,
  durationMin: 0,
  at: '',
};

export function PricingSimulator() {
  const trpc = useTRPC();
  const [s, setS] = useState<SimState>(INITIAL);
  const patch = (p: Partial<SimState>) => setS((prev) => ({ ...prev, ...p }));

  const isRide = RIDES.has(s.vertical);
  const isIntercity = s.vertical === 'intercity';
  // "Now" is taken on mount, not at prerender, so server and client HTML agree.
  const [now, setNowDate] = useState<Date | null>(null);
  useEffect(() => setNowDate(new Date()), []);
  const at = useMemo(() => fromLocalInputValue(s.at) ?? now ?? new Date(0), [s.at, now]);

  const input: PriceRequestInput = {
    cityId: CITY_ID,
    vertical: s.vertical,
    stops: [
      { zoneId: s.from, type: 'pickup' },
      { zoneId: s.to, type: 'dropoff' },
    ],
    options: {
      frontSeat: isIntercity && s.frontSeat,
      // Rides: door pickup is the paid opt-in. Deliveries: street handover is the discount opt-in.
      doorPickup: isRide && s.pickup === 'door',
      streetHandover: !isRide && s.pickup === 'street',
      waitMinutes: s.waitMinutes,
      promoIqd: s.promoIqd,
    },
    at,
    ...(s.distanceKm > 0 ? { distanceKm: s.distanceKm } : {}),
    ...(s.durationMin > 0 ? { durationMin: s.durationMin } : {}),
  };

  const ready = Boolean(s.from && s.to) && (s.at !== '' || now !== null);
  const quote = useQuery(trpc.pricing.quote.queryOptions(input, { enabled: ready, placeholderData: keepPreviousData }));
  const city = useQuery(trpc.config.city.queryOptions({ cityId: CITY_ID }, { staleTime: 60_000 }));
  const freeCancelSec = city.data?.dispatch[s.vertical]?.customerFreeCancelAfterSec;

  const changeVertical = (vertical: SimVertical) => {
    const intercity = vertical === 'intercity';
    const to = intercity ? (INTERCITY_IDS.has(s.to) ? s.to : 'kut') : INTERCITY_IDS.has(s.to) ? 'khamas' : s.to;
    const from = INTERCITY_IDS.has(s.from) && !intercity ? 'centre' : s.from;
    patch({ vertical, to, from, pickup: RIDES.has(vertical) ? 'street' : 'door' });
  };

  const setNow = () => {
    setNowDate(new Date());
    patch({ at: '' });
  };
  const setNight = () => {
    const d = new Date();
    d.setHours(23, 30, 0, 0);
    patch({ at: toLocalInputValue(d) });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold md:text-3xl">{t('console.pricing_title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('console.pricing_subtitle')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form className="space-y-5" onSubmit={(e) => e.preventDefault()} aria-label={t('console.pricing_title')}>
          <Card>
            <Field label={t('console.pricing_vertical')}>
              {(id) => (
                <div id={id} role="group" aria-label={t('console.pricing_vertical')} className="flex flex-wrap gap-2">
                  {VERTICALS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={s.vertical === v}
                      onClick={() => changeVertical(v)}
                      className={`rounded-pill border px-3 py-1.5 text-sm transition-colors ${
                        s.vertical === v ? 'border-accent/70 bg-accent-tint font-semibold text-text' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text'
                      }`}
                    >
                      {t(verticalKey(v))}
                    </button>
                  ))}
                </div>
              )}
            </Field>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t('console.pricing_from')}>
                {(id) => <ZoneSelect id={id} value={s.from} onChange={(from) => patch({ from })} intercity={isIntercity} />}
              </Field>
              <Field label={t('console.pricing_to')}>
                {(id) => <ZoneSelect id={id} value={s.to} onChange={(to) => patch({ to })} intercity={isIntercity} destinationsOnly={isIntercity} />}
              </Field>
            </div>
          </Card>

          <Card title={t('console.pricing_options')}>
            <fieldset>
              <legend className="mb-2 text-sm text-muted">{isRide ? t('quote.door_pickup') : t('quote.delivery')}</legend>
              <div className="flex gap-2">
                <Radio name="pickup" checked={s.pickup === 'door'} onChange={() => patch({ pickup: 'door' })}>
                  {isRide ? t('console.option_door_pickup') : t('quote.door_pickup')}
                </Radio>
                <Radio name="pickup" checked={s.pickup === 'street'} onChange={() => patch({ pickup: 'street' })}>
                  {isRide ? t('console.option_street_pickup') : t('console.option_street_handover')}
                </Radio>
              </div>
            </fieldset>

            {isIntercity && (
              <label className="mt-4 flex items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={s.frontSeat} onChange={(e) => patch({ frontSeat: e.target.checked })} />
                {t('console.option_front_seat')}
              </label>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {isRide && (
                <NumberField label={t('console.option_passengers')} value={s.passengers} min={1} max={4} onChange={(passengers) => patch({ passengers })} />
              )}
              <NumberField label={t('console.option_wait')} value={s.waitMinutes} min={0} max={120} onChange={(waitMinutes) => patch({ waitMinutes })} />
              <NumberField label={t('console.option_promo')} value={s.promoIqd} min={0} max={50_000} step={250} onChange={(promoIqd) => patch({ promoIqd })} />
              <NumberField label={t('console.distance_km')} value={s.distanceKm} min={0} max={200} step={0.5} onChange={(distanceKm) => patch({ distanceKm })} />
              <NumberField label={t('console.duration_min')} value={s.durationMin} min={0} max={600} onChange={(durationMin) => patch({ durationMin })} />
            </div>
          </Card>

          <Card title={t('console.pricing_time')}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('console.pricing_time')} className="min-w-[14rem] flex-1" srLabel>
                {(id) => (
                  <input
                    id={id}
                    type="datetime-local"
                    dir="ltr"
                    className={inputCls}
                    value={s.at || (now ? toLocalInputValue(now) : '')}
                    onChange={(e) => patch({ at: e.target.value })}
                  />
                )}
              </Field>
              <button type="button" onClick={setNow} className={ghostBtn} aria-pressed={s.at === ''}>
                {t('console.pricing_now')}
              </button>
              <button type="button" onClick={setNight} className={ghostBtn}>
                {t('console.pricing_try_night')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t('quote.reason.night', { time: '11' })} · {ready ? formatClock(at, CITY_TZ) : '—'}
            </p>
          </Card>
        </form>

        <Card title={t('console.pricing_result')} className="self-start lg:sticky lg:top-6">
          {!ready && <p className="text-sm text-muted">{t('console.pricing_pick_zones')}</p>}
          {ready && quote.isPending && <p className="text-sm text-muted">{t('console.pricing_loading')}</p>}
          {ready && quote.isError && (
            <p className="text-sm text-bad" role="alert">
              {errorText(quote.error)}
            </p>
          )}
          {quote.data && (
            <div className={quote.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'} aria-busy={quote.isFetching}>
              <QuoteTable shown={quote.data.components} shadow={quote.data.shadowComponents} />

              <dl className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
                <SummaryRow k={t('console.quote_subtotal')} v={formatIqd(quote.data.subtotal)} />
                <SummaryRow
                  k={t('console.quote_rounding', { step: formatIqd(quote.data.rounding.step) })}
                  v={formatSigned(quote.data.rounding.applied)}
                />
                {(quote.data.bounds.floor !== undefined || quote.data.bounds.ceiling !== undefined) && (
                  <SummaryRow
                    k={t(quote.data.bounds.clamped ? 'console.quote_clamped' : 'console.quote_bounds', {
                      floor: formatIqd(quote.data.bounds.floor ?? 0),
                      ceiling: formatIqd(quote.data.bounds.ceiling ?? 0),
                    })}
                    v={quote.data.bounds.clamped ? '!' : ''}
                    muted
                  />
                )}
              </dl>

              <div className="mt-4 flex items-baseline justify-between gap-4 rounded-lg bg-surface-2 px-4 py-3">
                <span className="text-sm text-muted">
                  {t('console.quote_total')}
                  {isRide && s.passengers > 1 && <span className="ms-2 text-xs">· {t('console.quote_per_seat')}</span>}
                </span>
                <output className="font-display text-3xl font-bold tabular-nums text-accent-text" aria-live="polite">
                  {formatIqd(quote.data.total)} <span className="text-base font-normal text-muted">{t('quote.currency')}</span>
                </output>
              </div>
              {isRide && s.passengers > 1 && (
                <p className="mt-2 text-sm text-muted">
                  {t('console.quote_seats_total', { n: s.passengers, amount: formatIqd(quote.data.total * s.passengers) })}
                </p>
              )}

              <p className="mt-3 text-xs text-faint">
                {t('console.quote_shadow_total')}: {formatMoney(quote.data.shadowTotal)}
              </p>
              {freeCancelSec !== undefined && (
                <p className="mt-1 text-xs text-faint">{t('console.free_cancel', { seconds: freeCancelSec })}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────── pieces ─────────────────────────

const inputCls =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint disabled:opacity-50';
const ghostBtn = 'rounded-md border border-line bg-surface-2 px-3 py-2 text-sm hover:border-line-strong aria-pressed:border-accent aria-pressed:text-accent-text';

function ZoneSelect({
  id,
  value,
  onChange,
  intercity,
  destinationsOnly = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  intercity: boolean;
  destinationsOnly?: boolean;
}) {
  return (
    <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {!destinationsOnly &&
        ZONE_GROUPS.map((g) => (
          <optgroup key={g.tier} label={t(tierKey(g.tier))}>
            {g.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </optgroup>
        ))}
      {intercity && (
        <optgroup label={t('console.tier_intercity')}>
          {INTERCITY_DESTINATIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_ar}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function QuoteTable({ shown, shadow }: { shown: QuoteComponent[]; shadow: QuoteComponent[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr className="border-b border-line">
          <th scope="col" className="py-2 text-start font-medium">
            {t('console.col_component')}
          </th>
          <th scope="col" className="py-2 text-start font-medium">
            {t('console.col_share')}
          </th>
          <th scope="col" className="py-2 text-end font-medium">
            {t('console.col_amount')}
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((c, i) => (
          <ComponentRow key={`s-${c.key}-${i}`} c={c} />
        ))}
        {shadow.map((c, i) => (
          <ComponentRow key={`h-${c.key}-${i}`} c={c} />
        ))}
      </tbody>
    </table>
  );
}

function ComponentRow({ c }: { c: QuoteComponent }) {
  const shadow = c.visibility === 'shadow';
  return (
    <tr className={`border-b border-line/50 ${shadow ? 'text-faint' : ''}`}>
      <td className="py-2">
        <span className="flex flex-wrap items-center gap-2">
          {c.label_ar}
          {c.leg !== undefined && <span className="text-xs text-muted">{t('console.leg', { n: c.leg + 1 })}</span>}
          {shadow && (
            <span className="rounded-pill border border-line px-2 py-0.5 text-[11px] uppercase tracking-wide text-faint">
              {t('console.badge_shadow')}
            </span>
          )}
        </span>
      </td>
      <td className="py-2 text-xs">{t(shareKey(c.driverShareRule))}</td>
      <td className="py-2 text-end tabular-nums" dir="ltr">
        {formatSigned(c.amount)}
      </td>
    </tr>
  );
}

function shareKey(rule: QuoteComponent['driverShareRule']): MessageKey {
  switch (rule) {
    case 'driver_full':
      return 'console.share_driver_full';
    case 'driver_commissioned':
      return 'console.share_driver_commissioned';
    case 'platform_only':
      return 'console.share_platform';
  }
}

function SummaryRow({ k, v, muted = false }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${muted ? 'text-muted' : ''}`}>
      <dt>{k}</dt>
      <dd className="tabular-nums" dir="ltr">
        {v}
      </dd>
    </div>
  );
}

function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 shadow-card ${className}`}>
      {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

/** Label + control wired by id; `srLabel` hides the label visually when the group already names it. */
function Field({
  label,
  children,
  className = '',
  srLabel = false,
}: {
  label: string;
  children: (id: string) => ReactNode;
  className?: string;
  srLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={srLabel ? 'sr-only' : 'mb-1.5 block text-sm text-muted'}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          dir="ltr"
          className={inputCls}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
        />
      )}
    </Field>
  );
}

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        checked ? 'border-accent text-accent-text' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[rgb(var(--c-accent))]" />
      {children}
    </label>
  );
}
