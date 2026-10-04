'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AZIZIYAH_ZONES, type BoardCard, type DriverPin, type Trip } from '@driver/contracts';
import { t } from '@driver/i18n';
import { GARAGES, MARKER_COLORS, MARKER_STATES, TIER_COLORS, TIERS_IN_ORDER } from '@driver/map';
import { useCallback, useMemo, useState } from 'react';
import { formatClock, formatIqd, shortId } from '@/lib/format';
import { capTierLabel, pinStateLabel, tierLabel, tripStateLabel, vehicleLabel, verticalLabel, zoneName } from '@/lib/labels';
import { buildLiveGeoJSON, capUsePct, driverPosition } from '@/lib/live-map';
import { LIVE_POLL_MS, useActiveTrips, useDispatchBoard, useDriverPins } from '@/lib/live';
import { orderLabel } from '@/lib/names';
import { PIN_STATE_TONE } from '@/lib/roster';
import { useSignedIn } from '@/lib/session';
import type { MapSelection } from './live-map-canvas';
import { CopyId, PersonName } from './named';
import { TripDetails } from './trip-details';
import { Card, Chip, Drawer, ghostBtn, LiveBadge, Mono, PageHeader, QueryError, Row } from './ui';

const LiveMapCanvas = dynamic(() => import('./live-map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted" role="status">
      {t('console.map_loading')}
    </div>
  ),
});

export function MapPage() {
  const signedIn = useSignedIn();
  const board = useDispatchBoard();
  const trips = useActiveTrips();
  const positions = useDriverPins();
  const [selected, setSelected] = useState<MapSelection | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [focus, setFocus] = useState<{ lng: number; lat: number } | null>(null);

  const tripList = useMemo(() => trips.data ?? [], [trips.data]);
  const cards = useMemo(() => board.data?.cards ?? [], [board.data]);
  // Presence feed when it answered; null falls back to approximate markers from trips.
  const pins = useMemo(() => (positions.isSuccess ? positions.data.drivers : null), [positions.isSuccess, positions.data]);
  const live = useMemo(() => buildLiveGeoJSON(tripList, cards, pins), [tripList, cards, pins]);
  const close = useCallback(() => setSelected(null), []);

  const driverCount = live.drivers.features.length;
  const empty = signedIn && trips.isSuccess && tripList.length === 0 && cards.length === 0 && driverCount === 0;
  const error = trips.error ?? board.error;

  const selectTrip = (tripId: string) => {
    const trip = tripList.find((x) => x.id === tripId);
    const pin = trip?.courierId ? pins?.find((p) => p.driverId === trip.courierId) : undefined;
    const pos = pin ?? (trip ? driverPosition(trip) : null);
    setSelected(trip?.courierId ? { kind: 'driver', id: trip.courierId, tripId } : { kind: 'trip', id: tripId });
    if (pos) setFocus({ lat: pos.lat, lng: pos.lng });
  };

  const selectDriver = (pin: DriverPin) => {
    setSelected({ kind: 'driver', id: pin.driverId, tripId: pin.tripId ?? '' });
    setFocus({ lat: pin.lat, lng: pin.lng });
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title={t('console.map_title')} subtitle={t('console.map_subtitle')}>
        {signedIn && <LiveBadge seconds={LIVE_POLL_MS / 1000} updatedAt={trips.dataUpdatedAt} fetching={trips.isFetching} />}
        <button type="button" className={ghostBtn} onClick={() => setFitKey((n) => n + 1)}>
          {t('console.map_fit')}
        </button>
      </PageHeader>

      {error && (
        <div className="mb-4">
          <QueryError error={error} onRetry={() => void Promise.all([trips.refetch(), board.refetch(), positions.refetch()])} />
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="relative h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-line bg-bg lg:h-[calc(100vh-11rem)] lg:flex-1">
          <LiveMapCanvas live={live} selected={selected} onSelect={setSelected} fitKey={fitKey} focus={focus} />

          {(!signedIn || empty) && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
              <p role="status" className="pointer-events-auto rounded-lg border border-line bg-surface/95 px-4 py-2 text-center text-sm shadow-card">
                {!signedIn ? (
                  <>
                    {t('console.map_signed_out')}{' '}
                    <Link href="/login" className="text-accent-text underline">
                      {t('console.login')}
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">{t('console.map_empty')}</span>
                    <span className="block text-xs text-muted">{t('console.map_empty_hint')}</span>
                  </>
                )}
              </p>
            </div>
          )}

          <Drawer open={selected !== null} title={selectionTitle(selected)} onClose={close}>
            {selected && <SelectionBody selected={selected} tripList={tripList} cards={cards} pins={pins} />}
          </Drawer>
        </div>

        <aside className="space-y-4 lg:w-80 lg:shrink-0">
          <Card title={t('console.legend')}>
            <h3 className="mb-1 text-xs text-muted">{t('console.legend_tiers')}</h3>
            <ul className="mb-3 grid grid-cols-2 gap-1 text-sm">
              {TIERS_IN_ORDER.map((tier) => (
                <li key={tier} className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-3 w-3 rounded-sm border" style={{ background: `${TIER_COLORS[tier]}55`, borderColor: TIER_COLORS[tier] }} />
                  {tierLabel(tier)}
                </li>
              ))}
            </ul>
            <h3 className="mb-1 text-xs text-muted">{t('console.legend_markers')}</h3>
            <ul className="grid grid-cols-2 gap-1 text-sm">
              {MARKER_STATES.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-3 w-3 rounded-pill" style={{ background: MARKER_COLORS[s] }} />
                  {t(`console.marker_${s}`)}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-3 w-3 rounded-pill border-2 border-accent bg-bg" />
                {t('console.legend_garage')}
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed border-info/40" />
                {t('console.legend_trip')}
              </li>
            </ul>
            {!pins && <p className="mt-3 text-xs text-faint">{t('console.map_position_note')}</p>}
          </Card>

          {signedIn && pins && pins.length > 0 && (
            <Card title={t('console.map_drivers_online', { n: pins.length })}>
              <ul className="max-h-[30vh] space-y-1 overflow-y-auto">
                {pins.map((p) => (
                  <li key={p.driverId}>
                    <button
                      type="button"
                      onClick={() => selectDriver(p)}
                      aria-pressed={selected?.kind === 'driver' && selected.id === p.driverId}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-2 aria-pressed:bg-surface-2"
                    >
                      <span className="min-w-0 truncate">
                        <PersonName id={p.driverId} vehicle vehicleClass={p.vehicleClass} copy={false} />
                      </span>
                      <Chip tone={PIN_STATE_TONE[p.state]}>{pinStateLabel(p.state)}</Chip>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {signedIn && (
            <Card title={t('console.map_counts', { drivers: driverCount, trips: tripList.length })}>
              {tripList.length === 0 ? (
                <p className="text-sm text-muted">{t('console.map_empty')}</p>
              ) : (
                <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                  {tripList.map((trip) => (
                    <li key={trip.id}>
                      <button
                        type="button"
                        onClick={() => selectTrip(trip.id)}
                        aria-pressed={selected?.kind === 'driver' ? selected.tripId === trip.id : selected?.id === trip.id}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-2 aria-pressed:bg-surface-2"
                      >
                        <span className="min-w-0 truncate">
                          {verticalLabel(trip.vertical)} ·{' '}
                          {trip.courierId ? (
                            <PersonName id={trip.courierId} copy={false} />
                          ) : trip.orders[0] ? (
                            <span className="tabular-nums" title={trip.id}>
                              {orderLabel(trip.orders[0].orderId)}
                            </span>
                          ) : (
                            <Mono>{shortId(trip.id)}</Mono>
                          )}
                        </span>
                        <Chip tone={trip.courierId ? 'live' : 'ready'}>{tripStateLabel(trip.state)}</Chip>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function selectionTitle(s: MapSelection | null): string {
  if (!s) return '';
  switch (s.kind) {
    case 'driver':
      return t('console.drawer_driver');
    case 'trip':
      return t('console.drawer_trip');
    case 'zone':
      return AZIZIYAH_ZONES.find((z) => z.id === s.id)?.name_ar ?? t('console.drawer_zone');
    case 'garage':
      return GARAGES.find((g) => g.key === s.id)?.name_ar ?? t('console.drawer_garage');
  }
}

function SelectionBody({
  selected,
  tripList,
  cards,
  pins,
}: {
  selected: MapSelection;
  tripList: readonly Trip[];
  cards: readonly BoardCard[];
  pins: readonly DriverPin[] | null;
}) {
  if (selected.kind === 'driver' || selected.kind === 'trip') {
    const tripId = selected.kind === 'driver' ? selected.tripId : selected.id;
    const trip = tripId ? tripList.find((x) => x.id === tripId) : undefined;
    const card = tripId ? cards.find((c) => c.tripId === tripId) : undefined;
    const pin = selected.kind === 'driver' ? pins?.find((p) => p.driverId === selected.id) : undefined;
    return (
      <div className="space-y-4">
        {selected.kind === 'driver' && (
          <dl>
            <Row k={t('console.name')} v={<PersonName id={selected.id} vehicle vehicleClass={pin?.vehicleClass} copy={false} strong />} />
            <Row
              k={t('console.id')}
              v={
                <span className="inline-flex items-center gap-1">
                  <Mono title={selected.id}>{shortId(selected.id)}</Mono>
                  <CopyId id={selected.id} />
                </span>
              }
            />
            {pin ? (
              <>
                <Row k={t('console.col_state')} v={<Chip tone={PIN_STATE_TONE[pin.state]}>{pinStateLabel(pin.state)}</Chip>} />
                <Row k={t('console.driver_vehicle')} v={vehicleLabel(pin.vehicleClass)} />
                <Row k={t('console.driver_tier')} v={capTierLabel(pin.tier)} />
                {pin.zoneId && <Row k={t('console.drawer_zone')} v={zoneName(pin.zoneId)} />}
                <Row
                  k={t('console.driver_cash_vs_cap')}
                  v={
                    <span className={`tabular-nums ${pin.overCap ? 'text-bad' : ''}`}>
                      {t('console.driver_cash_of_cap', { held: formatIqd(pin.cashHeldIqd), owed: formatIqd(pin.owedIqd), cap: formatIqd(pin.capIqd), pct: capUsePct(pin) })}
                    </span>
                  }
                />
                <Row k={t('console.driver_last_seen')} v={formatClock(pin.lastSeenAt)} />
              </>
            ) : (
              <Row k={t('console.drawer_driver')} v={<Chip>{pins ? t('console.driver_not_online') : t('console.approx')}</Chip>} />
            )}
          </dl>
        )}
        {(trip || card || selected.kind === 'trip') && <TripDetails trip={trip} card={card} />}
        <div className="flex flex-wrap gap-2">
          {selected.kind === 'driver' && (
            <Link href={`/drivers/${encodeURIComponent(selected.id)}/ledger`} className={ghostBtn}>
              {t('console.open_ledger')}
            </Link>
          )}
          <Link href="/dispatch" className={ghostBtn}>
            {t('console.open_dispatch')}
          </Link>
        </div>
      </div>
    );
  }
  if (selected.kind === 'zone') {
    const z = AZIZIYAH_ZONES.find((x) => x.id === selected.id);
    if (!z) return null;
    const live = cards.filter((c) => c.zoneId === z.id && c.status !== 'assigned' && c.status !== 'cancelled').length;
    return (
      <div className="space-y-3">
        <dl>
          <Row k={t('console.zone_tier')} v={<Chip>{tierLabel(z.tier)}</Chip>} />
          <Row k={t('console.zone_group')} v={z.group} />
          <Row k={t('console.id')} v={<Mono>{`${z.id} · ${z.extId}`}</Mono>} />
          <Row k={t('console.zone_live_cards')} v={<span className="tabular-nums">{live}</span>} />
        </dl>
        <p className="text-xs text-faint">{t('console.zone_draft_note')}</p>
      </div>
    );
  }
  const g = GARAGES.find((x) => x.key === selected.id);
  if (!g) return null;
  return (
    <dl>
      <Row k={t('console.drawer_garage')} v={g.name_ar} />
      <Row k={t('console.id')} v={<Mono>{g.key}</Mono>} />
      {!g.inCity && <Row k={t('console.garage_outside')} v="✓" />}
    </dl>
  );
}
