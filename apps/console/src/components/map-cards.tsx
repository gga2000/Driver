'use client';

import type { BoardCard, DriverPin, Trip } from '@driver/contracts';
import { t } from '@driver/i18n';
import { TIER_RAMP, TIERS_IN_ORDER, type MarkerState } from '@driver/map';
import { formatCountdown, formatIqd } from '@/lib/format';
import { capShare, waveHistory, waitTone } from '@/lib/dispatch';
import { pinStateLabel, tierLabel, tripStateLabel, verticalLabel, zoneName, capTierLabel } from '@/lib/labels';
import { markerStateForPin } from '@/lib/live-map';
import { MARKER_SHAPES } from '@/lib/marker-shapes';
import { orderLabel } from '@/lib/names';
import { OrgName, PersonName } from './named';
import { cx, Meter } from './ui';

/**
 * Small pieces shared by /map and /dispatch: the state glyph (the marker's shape), the cash-vs-cap
 * line, wave pips, the hover cards for drivers and orders, and the tier legend strip.
 */

/** The marker's shape at text size, for legends, chips and list rows. Decorative: words sit beside it. */
export function StateGlyph({ state, size = 16, className }: { state: MarkerState; size?: number; className?: string }) {
  return (
    <span aria-hidden className={cx('ops-glyph inline-flex shrink-0', className)}>
      <svg viewBox="0 0 24 24" width={size} height={size} style={{ overflow: 'visible' }} dangerouslySetInnerHTML={{ __html: MARKER_SHAPES[state] }} />
    </span>
  );
}

/** "كاش 34,900 / 75,000" with a meter; over the cap says so in words. */
export function CashLine({ pin, compact = false }: { pin: Pick<DriverPin, 'owedIqd' | 'capIqd' | 'overCap'>; compact?: boolean }) {
  const share = capShare(pin);
  const over = pin.overCap || share >= 100;
  return (
    <div className={cx('min-w-0', compact ? 'w-[118px]' : '')} title={compact ? t('console.cash_of_cap', { owed: formatIqd(pin.owedIqd), cap: formatIqd(pin.capIqd) }) : undefined}>
      <div className={cx('num flex items-baseline justify-between gap-2 text-xs', over ? 'font-semibold text-bad' : 'text-muted')}>
        <span className="whitespace-nowrap">
          {compact ? (
            `${formatIqd(pin.owedIqd)} / ${formatIqd(pin.capIqd)}`
          ) : (
            t('console.cash_of_cap', { owed: formatIqd(pin.owedIqd), cap: formatIqd(pin.capIqd) })
          )}
        </span>
        {over && !compact ? <span className="shrink-0">{t('console.cash_over')}</span> : null}
      </div>
      <div className="mt-1">
        <Meter value={pin.owedIqd} max={pin.capIqd} label={t('console.driver_cash_vs_cap')} />
      </div>
    </div>
  );
}

/** Wave pips: one per wave the policy runs, filled up to the current one. Words beside them carry it. */
export function WavePips({ card }: { card: BoardCard }) {
  const h = waveHistory(card);
  if (h.current === 0) return null;
  const word = card.policy === 'smart_broadcast' ? t('console.card_wave_of', { n: h.current, total: h.total }) : t('console.card_pass', { n: h.current });
  return (
    <span className="inline-flex items-center gap-1.5" title={word}>
      <span aria-hidden className="inline-flex gap-0.5" dir="ltr">
        {Array.from({ length: Math.min(h.total, 6) }, (_, i) => (
          <span key={i} className={cx('h-1.5 w-1.5 rounded-pill', i < h.current ? 'bg-text' : 'bg-surface-3 ring-1 ring-inset ring-line-strong')} />
        ))}
      </span>
      <span>{word}</span>
      {h.declined + h.timedOut > 0 ? <span className="text-faint">· {t('console.card_declined_n', { n: h.declined + h.timedOut })}</span> : null}
    </span>
  );
}

export function DriverHoverCard({ pin, trip, card }: { pin: DriverPin; trip: Trip | undefined; card: BoardCard | undefined }) {
  const state = markerStateForPin(pin.state);
  const orders = trip?.orders.filter((l) => l.detachedAt === null).map((l) => orderLabel(l.orderId)) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-semibold leading-6">
          <PersonName id={pin.driverId} vehicle vehicleClass={pin.vehicleClass} copy={false} />
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
          <StateGlyph state={state} size={14} />
          {pinStateLabel(pin.state)}
        </span>
      </div>
      <p className="text-dense text-muted">
        {trip ? (
          <>
            <span className="num font-medium text-text">{orders.join(' ') || verticalLabel(trip.vertical)}</span> · {tripStateLabel(trip.state)}
          </>
        ) : card ? (
          t('console.hover_offered', { what: verticalLabel(card.vertical) })
        ) : (
          t('console.hover_no_job')
        )}
        {pin.zoneId ? <> · {zoneName(pin.zoneId)}</> : null}
      </p>
      <CashLine pin={pin} />
      <p className="text-xs text-faint">{capTierLabel(pin.tier)}</p>
    </div>
  );
}

export function OrderHoverCard({ card, orderIds, merchantId, tick }: { card: BoardCard; orderIds: readonly string[]; merchantId: string | null; tick: number }) {
  const elapsed = card.elapsedSec + tick;
  const tone = waitTone(card, elapsed);
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-semibold leading-6">
          <span className="num">{orderIds.map(orderLabel).join(' ') || verticalLabel(card.vertical)}</span>
          {merchantId ? (
            <>
              {' '}· <OrgName id={merchantId} copy={false} />
            </>
          ) : null}
        </span>
        <span className={cx('num shrink-0 font-semibold', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-muted')}>{formatCountdown(elapsed)}</span>
      </div>
      <p className="text-dense text-muted">
        {card.status_ar} · {zoneName(card.zoneId)}
      </p>
      <p className="text-xs text-muted">
        <WavePips card={card} />
      </p>
    </div>
  );
}

/** The tier bands as one ramp, centre → edge, with the band names under the ends. */
export function TierLegend({ theme, className }: { theme: 'light' | 'dark'; className?: string }) {
  const ramp = TIER_RAMP[theme];
  return (
    <div className={className}>
      <div className="flex overflow-hidden rounded-[4px] ring-1 ring-inset ring-line" aria-hidden>
        {TIERS_IN_ORDER.map((tier) => (
          <span key={tier} className="h-2.5 flex-1" style={{ background: ramp[tier] }} />
        ))}
      </div>
      <ul className="mt-1 flex justify-between gap-1 text-[11px] leading-4 text-muted">
        {TIERS_IN_ORDER.map((tier) => (
          <li key={tier} className="min-w-0 truncate">
            {tierLabel(tier)}
          </li>
        ))}
      </ul>
    </div>
  );
}
