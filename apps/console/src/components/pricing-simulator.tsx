'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AZIZIYAH_ZONES, INTERCITY_DESTINATIONS, type PriceRequestInput, type QuoteComponent, type Vertical, type ZoneTier } from '@driver/contracts';
import { formatRange, t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useMemo, useState } from 'react';
import { formatClock, formatIqd, formatMoney, formatSigned, fromLocalInputValue, toLocalInputValue } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { errorText } from '@/lib/network';
import { Checkbox, Chip, cx, Field, Input, PageHeader, Segmented, Select, Skeleton, tdCls, thCls } from './ui';

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
const ZONE_NAMES = new Map<string, string>([...AZIZIYAH_ZONES.map((z) => [z.id, z.name_ar] as const), ...INTERCITY_DESTINATIONS.map((d) => [d.id, d.name_ar] as const)]);
const zoneName = (id: string) => ZONE_NAMES.get(id) ?? id;

type Pickup = 'door' | 'street';
type When = 'now' | 'night' | 'custom';

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
  when: When;
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
  when: 'now',
};

/** "السبت 4 تشرين الأول · 10:53 م" in the city's zone (Arabic month names, Western digits; K-15). */
function formatWhen(d: Date): string {
  const day = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CITY_TZ }).format(d);
  return `${day} · ${formatClock(d, CITY_TZ)}`;
}

export function PricingSimulator() {
  const trpc = useTRPC();
  const [s, setS] = useState<SimState>(INITIAL);
  const patch = (p: Partial<SimState>) => setS((prev) => ({ ...prev, ...p }));
  const ids = { from: useId(), to: useId(), at: useId() };

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

  const setWhen = (when: When) => {
    if (when === 'now') {
      setNowDate(new Date());
      patch({ at: '', when });
    } else if (when === 'night') {
      const d = new Date();
      d.setHours(23, 30, 0, 0);
      patch({ at: toLocalInputValue(d), when });
    } else patch({ at: s.at || toLocalInputValue(at), when });
  };

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader title={t('console.pricing_title')} subtitle={t('console.pricing_subtitle')} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <form className="rounded-lg border border-line bg-surface shadow-card" onSubmit={(e) => e.preventDefault()} aria-label={t('console.pricing_title')}>
          <section className="space-y-4 p-5">
            <div className="space-y-1.5">
              <p className="text-dense font-medium">{t('console.pricing_vertical')}</p>
              <Segmented<SimVertical> label={t('console.pricing_vertical')} value={s.vertical} onChange={changeVertical} options={VERTICALS.map((v) => ({ value: v, label: t(verticalKey(v)) }))} className="flex-wrap" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('console.pricing_from')} htmlFor={ids.from}>
                <ZoneSelect id={ids.from} value={s.from} onChange={(from) => patch({ from })} intercity={isIntercity} />
              </Field>
              <Field label={t('console.pricing_to')} htmlFor={ids.to}>
                <ZoneSelect id={ids.to} value={s.to} onChange={(to) => patch({ to })} intercity={isIntercity} destinationsOnly={isIntercity} />
              </Field>
            </div>
          </section>

          <section className="space-y-4 border-t border-line p-5">
            <h2 className="text-[15px] font-semibold">{t('console.pricing_options')}</h2>
            <div className="space-y-1.5">
              <p className="text-dense font-medium">{isRide ? t('console.pricing_pickup') : t('quote.delivery')}</p>
              <Segmented<Pickup>
                label={isRide ? t('console.pricing_pickup') : t('quote.delivery')}
                value={s.pickup}
                onChange={(pickup) => patch({ pickup })}
                options={[
                  { value: 'door', label: isRide ? t('console.option_door_pickup') : t('quote.door_pickup') },
                  { value: 'street', label: isRide ? t('console.option_street_pickup') : t('console.option_street_handover') },
                ]}
              />
            </div>
            {isIntercity && <Checkbox label={t('console.option_front_seat')} checked={s.frontSeat} onChange={(frontSeat) => patch({ frontSeat })} />}
            <div className="grid gap-4 sm:grid-cols-3">
              {isRide && <NumberField label={t('console.option_passengers')} value={s.passengers} min={1} max={4} onChange={(passengers) => patch({ passengers })} />}
              <NumberField label={t('console.option_wait')} value={s.waitMinutes} min={0} max={120} onChange={(waitMinutes) => patch({ waitMinutes })} />
              <NumberField label={t('console.option_promo')} value={s.promoIqd} min={0} max={50_000} step={250} onChange={(promoIqd) => patch({ promoIqd })} />
              <NumberField label={t('console.distance_km')} value={s.distanceKm} min={0} max={200} step={0.5} onChange={(distanceKm) => patch({ distanceKm })} />
              <NumberField label={t('console.duration_min')} value={s.durationMin} min={0} max={600} onChange={(durationMin) => patch({ durationMin })} />
            </div>
            <p className="text-xs text-muted">{t('console.pricing_zero_hint')}</p>
          </section>

          <section className="space-y-3 border-t border-line p-5">
            <h2 className="text-[15px] font-semibold">{t('console.pricing_time')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<When>
                label={t('console.pricing_time')}
                value={s.when}
                onChange={setWhen}
                options={[
                  { value: 'now', label: t('console.pricing_now') },
                  { value: 'night', label: t('console.pricing_try_night') },
                  { value: 'custom', label: t('console.pricing_pick_time') },
                ]}
              />
              {s.when === 'custom' && (
                <span className="block w-56">
                  <label htmlFor={ids.at} className="sr-only">
                    {t('console.pricing_time')}
                  </label>
                  <Input id={ids.at} type="datetime-local" dir="ltr" value={s.at} onChange={(e) => patch({ at: e.target.value })} />
                </span>
              )}
            </div>
            <p className="text-dense text-muted">
              {t('console.pricing_priced_at', { when: ready ? formatWhen(at) : '—' })}
              <span className="text-faint"> · {t('console.pricing_night_rule')}</span>
            </p>
          </section>
        </form>

        <section aria-labelledby="quote-title" className="rounded-lg border border-line bg-surface shadow-card lg:sticky lg:top-6">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id="quote-title" className="text-[15px] font-semibold">
              {t('console.pricing_result')}
            </h2>
            <span className="text-dense text-muted">{t('console.pricing_route', { from: zoneName(s.from), to: zoneName(s.to), vertical: t(verticalKey(s.vertical)) })}</span>
          </header>
          <div className="p-5">
            {!ready && <p className="text-sm text-muted">{t('console.pricing_pick_zones')}</p>}
            {ready && quote.isPending && (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-16 rounded-md" />
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-5" />
                ))}
              </div>
            )}
            {ready && quote.isError && (
              <p className="text-sm text-bad" role="alert">
                {errorText(quote.error)}
              </p>
            )}
            {quote.data && (
              <div className={cx('transition-opacity', quote.isFetching && 'opacity-70')} aria-busy={quote.isFetching}>
                <div className="flex items-end justify-between gap-4 rounded-md bg-accent-wash px-4 py-4">
                  <span className="text-sm text-muted">
                    {t('console.quote_total')}
                    {isRide && s.passengers > 1 && <span className="block text-xs">{t('console.quote_per_seat')}</span>}
                  </span>
                  <output className="text-[34px] font-bold leading-[42px] tracking-[-0.01em] text-accent-text" aria-live="polite">
                    {formatIqd(quote.data.total)} <span className="text-base font-medium text-muted">{t('quote.currency')}</span>
                  </output>
                </div>
                {isRide && s.passengers > 1 && <p className="mt-2 text-sm text-muted">{t('console.quote_seats_total', { n: s.passengers, amount: formatIqd(quote.data.total * s.passengers) })}</p>}

                <QuoteTable shown={quote.data.components} shadow={quote.data.shadowComponents} />

                <dl className="mt-3 space-y-1.5 text-sm">
                  <SummaryRow k={t('console.quote_subtotal')} v={formatIqd(quote.data.subtotal)} />
                  <SummaryRow k={t('console.quote_rounding', { step: formatIqd(quote.data.rounding.step) })} v={formatSigned(quote.data.rounding.applied)} />
                  {(quote.data.bounds.floor !== undefined || quote.data.bounds.ceiling !== undefined) && (
                    <SummaryRow
                      k={t(quote.data.bounds.clamped ? 'console.quote_clamped' : 'console.quote_bounds', {
                        floor: formatIqd(quote.data.bounds.floor ?? 0),
                        ceiling: formatIqd(quote.data.bounds.ceiling ?? 0),
                        range: formatRange(formatIqd(quote.data.bounds.floor ?? 0), formatIqd(quote.data.bounds.ceiling ?? 0), undefined, { spaced: true }),
                      })}
                      v={quote.data.bounds.clamped ? t('console.quote_clamped_short') : ''}
                      muted
                    />
                  )}
                </dl>

                <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
                  <p>
                    {t('console.quote_shadow_total')}: <span className="num font-medium text-text">{formatMoney(quote.data.shadowTotal)}</span>
                  </p>
                  {freeCancelSec !== undefined && <p>{t('console.free_cancel', { seconds: freeCancelSec })}</p>}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ───────────────────────── pieces ─────────────────────────

function ZoneSelect({ id, value, onChange, intercity, destinationsOnly = false }: { id: string; value: string; onChange: (v: string) => void; intercity: boolean; destinationsOnly?: boolean }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
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
    </Select>
  );
}

function QuoteTable({ shown, shadow }: { shown: QuoteComponent[]; shadow: QuoteComponent[] }) {
  return (
    <table className="mt-4 w-full border-separate border-spacing-0 text-sm">
      <caption className="sr-only">{t('console.pricing_result')}</caption>
      <thead>
        <tr>
          <th scope="col" className={thCls}>
            {t('console.col_component')}
          </th>
          <th scope="col" className={thCls}>
            {t('console.col_share')}
          </th>
          <th scope="col" className={cx(thCls, 'text-end')}>
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
    <tr className={shadow ? 'text-muted' : ''}>
      <td className={tdCls}>
        <span className="flex flex-wrap items-center gap-2">
          {c.label_ar}
          {c.leg !== undefined && <span className="text-xs text-muted">{t('console.leg', { n: c.leg + 1 })}</span>}
          {shadow && (
            <Chip size="sm" title={t('console.badge_shadow_hint')}>
              {t('console.badge_shadow')}
            </Chip>
          )}
        </span>
      </td>
      <td className={cx(tdCls, 'text-xs text-muted')}>{t(shareKey(c.driverShareRule))}</td>
      <td className={cx(tdCls, 'num text-end font-medium')}>
        <bdi dir="ltr">{formatSigned(c.amount)}</bdi>
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
    <div className={cx('flex justify-between gap-4', muted && 'text-muted')}>
      <dt>{k}</dt>
      <dd className="num">
        <bdi dir="ltr">{v}</bdi>
      </dd>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        dir="ltr"
        className="num"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </Field>
  );
}
