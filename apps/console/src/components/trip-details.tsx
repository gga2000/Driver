'use client';

import Link from 'next/link';
import type { BoardCard, Trip } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatClock, formatCountdown, shortId } from '@/lib/format';
import { offerStateLabel, stopStateLabel, stopTypeLabel, tripStateLabel, verticalLabel, zoneName } from '@/lib/labels';
import { markerStateForTrip, nextStop } from '@/lib/live-map';
import { Chip, Mono, Row, type ChipTone } from './ui';

const TONE: Record<string, ChipTone> = { on_job: 'live', offered: 'ready', offline: 'neutral', free: 'done', over_cap: 'bad' };

/** Trip summary used by the map drawer: state, stops, attached orders, dispatch card. */
export function TripDetails({ trip, card }: { trip: Trip | undefined; card: BoardCard | undefined }) {
  if (!trip && !card) return <p className="text-sm text-muted">{t('console.none')}</p>;
  const next = trip ? nextStop(trip) : null;
  const openOrders = trip?.orders.filter((o) => o.detachedAt === null) ?? [];
  return (
    <div className="space-y-4">
      <dl>
        <Row k={t('console.drawer_trip')} v={<Mono title={trip?.id ?? card?.tripId}>{shortId(trip?.id ?? card!.tripId)}</Mono>} />
        <Row k={t('console.trip_vertical')} v={verticalLabel(trip?.vertical ?? card!.vertical)} />
        {trip && <Row k={t('console.trip_state')} v={<Chip tone={TONE[markerStateForTrip(trip.state)]}>{tripStateLabel(trip.state)}</Chip>} />}
        {trip?.courierId && (
          <Row
            k={t('console.drawer_driver')}
            v={
              <Link className="text-accent underline" href={`/drivers/${encodeURIComponent(trip.courierId)}/ledger`}>
                <Mono>{shortId(trip.courierId)}</Mono>
              </Link>
            }
          />
        )}
        {next && <Row k={t('console.trip_next_stop')} v={`${stopTypeLabel(next.type)} · ${zoneName(next.zoneKey)}`} />}
      </dl>
      {trip?.acceptedAt && <p className="text-xs text-muted">{t('console.trip_accepted_at', { time: formatClock(trip.acceptedAt) })}</p>}
      {trip?.unreachable && (
        <p role="status" className="rounded-md border border-danger-500 bg-danger-500/10 px-3 py-2 text-sm">
          {t('console.trip_unreachable', { time: formatClock(trip.unreachable.startedAt) })}
        </p>
      )}

      {card && (
        <div className={`rounded-lg border p-3 ${card.red ? 'border-danger-500 bg-danger-500/10' : 'border-line bg-surface-2'}`}>
          <p className="text-xs text-muted">{t('console.trip_card')}</p>
          <p className="mt-1 font-semibold">{card.status_ar}</p>
          <p className="mt-1 text-xs text-muted">
            {t('console.card_elapsed', { time: formatCountdown(card.elapsedSec) })}
            {card.countdownSec !== null && <> · {t('console.card_countdown', { time: formatCountdown(card.countdownSec) })}</>}
          </p>
          {card.compensationLabel_ar && (
            <p className="mt-1">
              <Chip tone="ready">{card.compensationLabel_ar}</Chip>
            </p>
          )}
          {card.offers.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {card.offers.map((o) => (
                <li key={o.offerId} className="flex justify-between gap-2">
                  <Mono>{shortId(o.driverId)}</Mono>
                  <span className="text-muted">{offerStateLabel(o.state)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {trip && trip.stops.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('console.trip_stops')}</h3>
          <ol className="space-y-1 text-sm">
            {[...trip.stops]
              .sort((a, b) => a.seq - b.seq)
              .map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1">
                  <span>
                    {s.seq + 1}. {stopTypeLabel(s.type)} · {zoneName(s.zoneKey)}
                    {s.childName ? ` · ${s.childName}` : ''}
                  </span>
                  <span className="text-xs text-muted">{stopStateLabel(s.state)}</span>
                </li>
              ))}
          </ol>
        </div>
      )}

      {openOrders.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('console.trip_orders')}</h3>
          <ul className="flex flex-wrap gap-2">
            {openOrders.map((o) => (
              <li key={o.orderId}>
                <Link href={`/orders/${encodeURIComponent(o.orderId)}`} className="rounded-md text-sm text-accent underline">
                  <Mono>{shortId(o.orderId)}</Mono>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
