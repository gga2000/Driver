'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useMemo } from 'react';
import { formatClock, formatDayClock, formatIqd, formatSigned, shortId } from '@/lib/format';
import { orderStateLabel, orderTypeLabel, participantRoleLabel, paymentLabel, priceLabel, timelineStepLabel } from '@/lib/labels';
import { queryRetry, useActiveTrips } from '@/lib/live';
import { orderLabel } from '@/lib/names';
import { eventTimeline, groupLinesByParticipant, lineTotal, ORDER_STATE_TONE, orderTimeline, priceCheck, priceRows } from '@/lib/orders';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { EventTimeline, TripEventLog } from './event-timeline';
import { MerchantBalanceCard } from './merchant-balance-card';
import { CopyId, ItemName, OrgName, PersonName } from './named';
import { Card, Chip, EmptyState, httpStatusOf, Mono, NeedLogin, QueryError, Row } from './ui';

export function OrderDetail({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const order = useQuery(trpc.orders.get.queryOptions({ orderId }, { enabled: signedIn, retry: queryRetry, refetchInterval: 5_000 }));
  const log = useQuery(trpc.orders.events.queryOptions({ orderId }, { enabled: signedIn, retry: queryRetry, refetchInterval: 5_000 }));
  const trips = useActiveTrips();
  const o = order.data;
  const timeline = useMemo(() => (o ? orderTimeline(o) : []), [o]);
  const events = useMemo(() => eventTimeline(log.data ?? []), [log.data]);
  // Trips this order rode on, from its own log (history), plus the live one.
  const groups = useMemo(() => (o ? groupLinesByParticipant(o) : []), [o]);
  const trip = useMemo(() => trips.data?.find((tr) => tr.orders.some((l) => l.orderId === orderId && l.detachedAt === null)), [trips.data, orderId]);
  const tripIds = useMemo(() => {
    const ids = new Set<string>();
    if (trip) ids.add(trip.id);
    for (const e of events) if (e.tripId) ids.add(e.tripId);
    return [...ids];
  }, [trip, events]);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/orders" className="rounded-md text-sm text-muted hover:text-accent-text">
        ← {t('console.order_back')}
      </Link>

      {!signedIn && (
        <div className="mt-4">
          <NeedLogin />
        </div>
      )}
      {order.error &&
        (httpStatusOf(order.error) === 404 ? (
          <div className="mt-4">
            <EmptyState title={t('console.order_not_found')} />
          </div>
        ) : (
          <div className="mt-4">
            <QueryError error={order.error} onRetry={() => void order.refetch()} />
          </div>
        ))}
      {signedIn && order.isPending && <p className="mt-4 text-sm text-muted">{t('status.loading')}</p>}

      {o && (
        <>
          <header className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold tabular-nums md:text-3xl">
                <span title={o.id}>{t('console.order_title', { id: orderLabel(o.id) })}</span>
                <CopyId id={o.id} />
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Chip tone={ORDER_STATE_TONE[o.state]}>{orderStateLabel(o.state)}</Chip>
                <span>{orderTypeLabel(o.type)}</span>
                <span>· {paymentLabel(o.paymentMethod)}</span>
                <span>· {formatDayClock(o.placedAt)}</span>
              </p>
            </div>
            <p className="font-display text-3xl font-bold tabular-nums text-accent-text">
              {formatIqd(o.totalIqd)} <span className="text-base font-normal text-muted">{t('quote.currency')}</span>
            </p>
          </header>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-4">
              <Card title={t('console.order_event_log')}>
                {log.error && <QueryError error={log.error} onRetry={() => void log.refetch()} />}
                {events.length > 0 ? (
                  <EventTimeline entries={events} />
                ) : (
                  <>
                    <ol className="relative space-y-3 border-s border-line ps-5">
                      {timeline.map((e) => (
                        <li key={e.step} className="relative">
                          <span
                            aria-hidden
                            className={`absolute -start-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-pill ${e.step === 'cancelled' ? 'bg-bad' : 'bg-accent'}`}
                          />
                          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                            <span className="font-semibold">{timelineStepLabel(e.step)}</span>
                            <span className="text-xs text-muted tabular-nums">
                              {formatClock(e.at)}
                              {e.step !== 'placed' && e.offsetMin >= 0 && <> · {t('console.step_offset', { minutes: e.offsetMin })}</>}
                            </span>
                          </p>
                        </li>
                      ))}
                    </ol>
                    {log.isSuccess && <p className="mt-3 text-xs text-faint">{t('console.order_log_empty')}</p>}
                  </>
                )}
              </Card>

              {tripIds.map((id) => (
                <Card
                  key={id}
                  title={
                    <span className="flex items-center gap-2">
                      {t('console.trip_event_log')} <CopyId id={id} />
                    </span>
                  }
                >
                  <TripEventLog tripId={id} />
                </Card>
              ))}

              <Card title={t('console.order_details')}>
                <dl>
                  <Row k={t('console.order_orderer')} v={<PersonName id={o.ordererId} />} />
                  {o.merchantOrgId && <Row k={t('console.col_merchant')} v={<OrgName id={o.merchantOrgId} />} />}
                  {trip?.courierId && (
                    <Row k={t('console.drawer_driver')} v={<PersonName id={trip.courierId} vehicle href={`/drivers/${encodeURIComponent(trip.courierId)}/ledger`} />} />
                  )}
                  {trip && (
                    <Row
                      k={t('console.drawer_trip')}
                      v={
                        <span className="inline-flex items-center gap-1">
                          <Link href="/map" className="text-accent-text underline">
                            <Mono title={trip.id}>{shortId(trip.id)}</Mono>
                          </Link>
                          <CopyId id={trip.id} />
                        </span>
                      }
                    />
                  )}
                  {o.minVehicleClass && <Row k={t('console.order_vehicle')} v={o.minVehicleClass} />}
                  {o.cateringRequest && <Row k={t('console.order_catering')} v={<Chip tone="warn">✓</Chip>} />}
                  {o.refundState !== 'none' && <Row k={t('console.order_refund')} v={o.refundState} />}
                  {o.cancellationReason && <Row k={t('console.order_cancel_reason')} v={o.cancellationReason} />}
                  {o.note && <Row k={t('console.order_note')} v={o.note} />}
                </dl>
                {o.scheduledFor && <p className="mt-2 text-xs text-muted">{t('console.order_scheduled_for', { time: formatDayClock(o.scheduledFor) })}</p>}
                {o.promisedReadyAt && <p className="mt-1 text-xs text-muted">{t('console.order_promised_ready', { time: formatClock(o.promisedReadyAt) })}</p>}
                {o.partial && (
                  <p role="status" className="mt-2 rounded-md border border-accent bg-accent-tint px-3 py-2 text-sm">
                    {t('console.order_partial', { amount: formatIqd(o.partial.reducedTotalIqd), time: formatClock(o.partial.deadline) })}
                  </p>
                )}
              </Card>

              {o.merchantOrgId && <MerchantBalanceCard merchantId={o.merchantOrgId} />}
            </div>

            <div className="space-y-4">
              <Card title={t('console.order_people')}>
                <div className="space-y-4">
                  {groups.map((g) => {
                    const name = g.participant ? g.participant.label ?? participantRoleLabel(g.participant.role) : t('console.order_own_lines');
                    return (
                      <section key={g.participant?.id ?? 'orderer'} className="rounded-lg border border-line bg-surface-2 p-3">
                        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold">{name}</h3>
                          <span className="flex gap-1">
                            {g.participant && <Chip>{participantRoleLabel(g.participant.role)}</Chip>}
                            {g.participant?.phoneOnly && <Chip tone="warn">{t('console.order_phone_only')}</Chip>}
                          </span>
                        </header>
                        {g.lines.length === 0 ? (
                          <p className="text-sm text-faint">{t('console.order_no_lines')}</p>
                        ) : (
                          <ul className="space-y-1 text-sm">
                            {g.lines.map((l) => (
                              <li key={l.id} className={`flex justify-between gap-3 ${l.availability === 'removed' ? 'text-faint line-through' : ''}`}>
                                <span className="min-w-0">
                                  <span className="tabular-nums">{l.qty}×</span> {l.freeText ?? (l.catalogItemId ? <ItemName orgId={o.merchantOrgId} itemId={l.catalogItemId} /> : <Mono>{l.id}</Mono>)}
                                  {l.note && <span className="block text-xs text-muted">{l.note}</span>}
                                  {l.availability !== 'available' && (
                                    <span className="ms-2">
                                      <Chip tone="bad">{l.availability === 'removed' ? t('console.order_line_removed') : t('console.order_line_unavailable')}</Chip>
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 tabular-nums">{formatIqd(lineTotal(l))}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {g.lines.length > 0 && (
                          <p className="mt-2 flex justify-between border-t border-line pt-2 text-xs text-muted">
                            <span>{t('console.order_subtotal', { name })}</span>
                            <span className="tabular-nums">{formatIqd(g.subtotalIqd)}</span>
                          </p>
                        )}
                      </section>
                    );
                  })}
                </div>
              </Card>

              <Card title={t('console.order_price')}>
                <table className="w-full text-sm">
                  <tbody>
                    {priceRows(o).map((r) => (
                      <tr key={r.key} className="border-b border-line/60">
                        <th scope="row" className="py-1.5 text-start font-normal text-muted">
                          {priceLabel(r.key)}
                        </th>
                        <td className="py-1.5 text-end tabular-nums">{r.key === 'items' ? formatIqd(r.amountIqd) : formatSigned(r.amountIqd)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row" className="pt-2 text-start font-semibold">
                        {t('console.col_total')}
                      </th>
                      <td className="pt-2 text-end font-display text-lg font-bold tabular-nums">{formatIqd(o.totalIqd)}</td>
                    </tr>
                  </tbody>
                </table>
                {!priceCheck(o).matches && (
                  <p className="mt-2 text-xs text-faint">
                    {t('console.order_sum_mismatch', { sum: formatIqd(priceCheck(o).sumIqd), total: formatIqd(o.totalIqd) })}
                  </p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
