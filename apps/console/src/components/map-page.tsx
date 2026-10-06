'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AZIZIYAH_ZONES, type BoardCard, type DriverPin, type Trip, type Vertical } from '@driver/contracts';
import { t } from '@driver/i18n';
import { GARAGES, labelDigits, MARKER_STATES, type MarkerState } from '@driver/map';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatClock, shortId } from '@/lib/format';
import { eventKey, isTypingTarget } from '@/lib/hotkeys';
import { capTierLabel, pinStateLabel, tierLabel, tripStateLabel, vehicleLabel, verticalLabel, zoneName } from '@/lib/labels';
import { buildLiveGeoJSON, countMarkers, driverPosition, filterLive, markerStateForPin, orderTags, type MapFilter } from '@/lib/live-map';
import { LIVE_POLL_MS, useActiveTrips, useDispatchBoard, useDriverPins } from '@/lib/live';
import { useAtRiskDrivers } from '@/lib/at-risk';
import { useZoneDemand } from '@/lib/zone-demand';
import { orderLabel, personText, useNames } from '@/lib/names';
import { useTheme } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import type { MapHoverTarget, MapSelection } from './live-map-canvas';
import { CashLine, DriverHoverCard, OrderHoverCard, StateGlyph, TierLegend } from './map-cards';
import { CopyId, PersonName } from './named';
import { TripDetails } from './trip-details';
import { ZoneDemandPanel } from './zone-demand-panel';
import { Button, buttonCls, Chip, cx, Drawer, IconCheck, Kbd, LiveBadge, Mono, NetworkBanner, QueryError, Row, Tabs } from './ui';

const LiveMapCanvas = dynamic(() => import('./live-map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted" role="status">
      {t('console.map_loading')}
    </div>
  ),
});

/** Verticals worth a filter chip, in the order dispatchers think of them. */
const VERTICALS: Vertical[] = ['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk', 'intercity', 'khat'];

/**
 * /map (K-09): the whole town at a glance. Cream map in the light theme, dark at night; tier bands as
 * one ink ramp; drivers by shape and colour; waiting orders as tags at the kitchen; labels placed
 * without collisions. Filters by vertical and driver state; hover a marker for name, vehicle and
 * plate, job and cash; click to open, F to follow a driver as he moves.
 */
export function MapPage() {
  const signedIn = useSignedIn();
  const board = useDispatchBoard();
  const trips = useActiveTrips();
  const positions = useDriverPins();
  const theme = useTheme();
  const [selected, setSelected] = useState<MapSelection | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [focus, setFocus] = useState<{ lng: number; lat: number } | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const [routes, setRoutes] = useState<'focus' | 'all'>('focus');
  const [verticals, setVerticals] = useState<ReadonlySet<Vertical>>(new Set());
  const [states, setStates] = useState<ReadonlySet<MarkerState>>(new Set());
  const [tab, setTab] = useState<'drivers' | 'trips'>('drivers');

  const tripList = useMemo(() => trips.data ?? [], [trips.data]);
  // Maps program o4: ring the couriers whose order is predicted to be late.
  const riskDrivers = useAtRiskDrivers(tripList);
  // Maps program o5: busy zones shaded on the map, numbers and "send drivers here" in the zone panel.
  const demand = useZoneDemand();
  const tripsById = useMemo(() => new Map<string, Trip>(tripList.map((x) => [x.id, x])), [tripList]);
  const cards = useMemo(() => board.data?.cards ?? [], [board.data]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.tripId, c])), [cards]);
  // Presence feed when it answered; null falls back to approximate markers from trips.
  const pins = useMemo(() => (positions.isSuccess ? positions.data.drivers : null), [positions.isSuccess, positions.data]);
  const pinsById = useMemo(() => new Map((pins ?? []).map((p) => [p.driverId, p])), [pins]);
  const all = useMemo(() => buildLiveGeoJSON(tripList, cards, pins), [tripList, cards, pins]);
  const byVertical = useMemo(() => filterLive(all, { verticals, states: new Set() }), [all, verticals]);
  const filter: MapFilter = useMemo(() => ({ verticals, states }), [verticals, states]);
  const live = useMemo(() => filterLive(all, filter), [all, filter]);
  const counts = useMemo(() => countMarkers(byVertical), [byVertical]);
  const tags = useMemo(() => {
    const keep = verticals.size === 0 ? cards : cards.filter((c) => verticals.has(c.vertical));
    return orderTags(keep, tripsById);
  }, [cards, tripsById, verticals]);
  const ordersByTrip = useMemo(() => new Map(tripList.map((tr) => [tr.id, tr.orders.filter((l) => l.detachedAt === null).map((l) => l.orderId)])), [tripList]);
  const names = useNames({ people: (pins ?? []).map((p) => p.driverId) });
  const driverLabel = useCallback((id: string) => personText(id, names.person(id)), [names]);
  const orderText = useCallback((tripId: string) => {
    const ids = ordersByTrip.get(tripId) ?? [];
    return ids[0] ? orderLabel(ids[0]) : verticalLabel(cardById.get(tripId)?.vertical ?? 'food');
  }, [ordersByTrip, cardById]);

  const close = useCallback(() => setSelected(null), []);
  const driverCount = live.drivers.features.length;
  const empty = signedIn && trips.isSuccess && tripList.length === 0 && cards.length === 0 && all.drivers.features.length === 0;
  const error = trips.error ?? board.error;
  const selectedDriver = selected?.kind === 'driver' ? selected.id : null;

  const selectDriver = (pin: DriverPin) => {
    setSelected({ kind: 'driver', id: pin.driverId, tripId: pin.tripId ?? '' });
    setFocus({ lat: pin.lat, lng: pin.lng });
  };
  const selectTrip = (tripId: string) => {
    const trip = tripsById.get(tripId);
    const pin = trip?.courierId ? pinsById.get(trip.courierId) : undefined;
    const pos = pin ?? (trip ? driverPosition(trip) : null);
    setSelected(trip?.courierId ? { kind: 'driver', id: trip.courierId, tripId } : { kind: 'trip', id: tripId });
    if (pos) setFocus({ lat: pos.lat, lng: pos.lng });
  };

  // F follows the selected driver; Esc (with nothing open) stops following.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
      const k = eventKey(e);
      if (k === 'f' && selectedDriver) {
        e.preventDefault();
        setFollow((f) => (f === selectedDriver ? null : selectedDriver));
      } else if (k === 'escape' && follow && !selected) {
        setFollow(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDriver, follow, selected]);

  const renderHover = useCallback(
    (h: MapHoverTarget) => {
      if (h.kind === 'driver') {
        const pin = pinsById.get(h.id);
        if (!pin) return null;
        return <DriverHoverCard pin={pin} trip={pin.tripId ? tripsById.get(pin.tripId) : undefined} card={pin.tripId ? cardById.get(pin.tripId) : undefined} />;
      }
      const card = cardById.get(h.id);
      return card ? <OrderHoverCard card={card} orderIds={ordersByTrip.get(h.id) ?? []} merchantId={null} tick={0} /> : null;
    },
    [pinsById, tripsById, cardById, ordersByTrip],
  );

  const toggleSet = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const presentVerticals = useMemo(() => {
    const seen = new Set<string>([...tripList.map((x) => x.vertical), ...cards.map((c) => c.vertical)]);
    return VERTICALS.filter((v) => seen.has(v) || verticals.has(v));
  }, [tripList, cards, verticals]);
  const shownPins = useMemo(() => {
    const ids = new Set(live.drivers.features.map((f) => f.properties.driverId));
    const order: Record<MarkerState, number> = { over_cap: 0, offered: 1, free: 2, on_job: 3, offline: 4 };
    return (pins ?? []).filter((p) => ids.has(p.driverId)).sort((a, b) => order[markerStateForPin(a.state)] - order[markerStateForPin(b.state)]);
  }, [pins, live.drivers]);
  const shownTrips = useMemo(() => (verticals.size === 0 ? tripList : tripList.filter((x) => verticals.has(x.vertical))), [tripList, verticals]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-2.5 lg:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-7">{t('console.map_title')}</h1>
          {signedIn ? <LiveBadge seconds={LIVE_POLL_MS / 1000} updatedAt={trips.dataUpdatedAt} fetching={trips.isFetching} /> : null}
        </div>

        {signedIn ? (
          <>
            <div role="group" aria-label={t('console.map_filter_state')} className="flex flex-wrap items-center gap-1">
              {MARKER_STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={states.has(s)}
                  onClick={() => setStates((cur) => toggleSet(cur, s))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 text-dense text-text hover:border-line-strong aria-pressed:border-accent/70 aria-pressed:bg-accent-tint aria-pressed:font-semibold"
                >
                  <StateGlyph state={s} size={15} />
                  {t(`console.marker_${s}`)}
                  <span className="num text-muted">{counts[s]}</span>
                </button>
              ))}
            </div>
            <span aria-hidden className="hidden h-6 w-px bg-line-strong/60 xl:block" />
            <div role="group" aria-label={t('console.map_filter_vertical')} className="flex flex-wrap items-center gap-1">
              {presentVerticals.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={verticals.has(v)}
                  onClick={() => setVerticals((cur) => toggleSet(cur, v))}
                  className="inline-flex h-9 items-center rounded-pill border border-line bg-surface px-3 text-dense text-text hover:border-line-strong aria-pressed:border-accent/70 aria-pressed:bg-accent-tint aria-pressed:font-semibold"
                >
                  {verticalLabel(v)}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {verticals.size + states.size > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setVerticals(new Set());
              setStates(new Set());
            }}
          >
            {t('console.map_filter_clear')}
          </Button>
        ) : null}
      </header>

      {error ? (
        <div className="px-4 pt-3 lg:px-5">
          <QueryError error={error} onRetry={() => void Promise.all([trips.refetch(), board.refetch(), positions.refetch()])} />
        </div>
      ) : null}
      <div className="px-4 empty:hidden lg:px-5 [&>*]:mb-0 [&>*]:mt-3">
        <NetworkBanner />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[60vh] min-h-[360px] lg:h-auto lg:min-w-0 lg:flex-1">
          <LiveMapCanvas
            atRiskDrivers={riskDrivers}
            heat={demand.data?.zones}
            live={live}
            theme={theme}
            selected={selected}
            onSelect={(s) => {
              setSelected(s);
              if (s?.kind !== 'driver' && follow) setFollow(null);
            }}
            fitKey={fitKey}
            focus={focus}
            orders={states.size === 0 ? tags : []}
            orderText={orderText}
            routes={routes}
            followId={follow}
            onUserMove={() => setFollow(null)}
            driverLabel={driverLabel}
            renderHover={renderHover}
          />

          {/* Map tools sit beside the zoom buttons (top end corner), off the filter row. */}
          <div className="absolute end-14 top-3 z-10 flex items-center gap-1.5">
            <Button size="sm" aria-pressed={routes === 'all'} onClick={() => setRoutes((r) => (r === 'all' ? 'focus' : 'all'))}>
              {t('console.map_routes_all')}
            </Button>
            <Button size="sm" onClick={() => setFitKey((n) => n + 1)}>
              {t('console.map_fit')}
            </Button>
          </div>

          {follow ? (
            <div className="absolute start-3 top-3 z-20 flex">
              <p role="status" className="inline-flex items-center gap-2 rounded-pill bg-inverse py-1 pe-1 ps-3.5 text-sm text-on-inverse shadow-pop">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-pill bg-accent opacity-60" />
                  <span className="relative h-2 w-2 rounded-pill bg-accent" />
                </span>
                {t('console.map_following', { name: driverLabel(follow) ?? shortId(follow) })}
                <button type="button" onClick={() => setFollow(null)} className="inline-flex h-7 items-center gap-1 rounded-pill px-2 text-xs hover:bg-on-inverse/10">
                  {t('console.map_follow_stop')}
                  <Kbd tone="inverse">Esc</Kbd>
                </button>
              </p>
            </div>
          ) : null}

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

          <div className="pointer-events-none absolute bottom-3 end-3 z-10 w-[min(260px,calc(100%-1.5rem))] rounded-lg border border-line bg-raised/95 px-3 py-2.5 shadow-pop">
            <p className="mb-1.5 text-xs font-semibold text-muted">{t('console.legend_tiers')}</p>
            <TierLegend theme={theme} />
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text">
              {/* Maps program o5: the busy-zone fill. */}
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-3 rounded-sm border-2 border-accent bg-accent/40" />
                {t('console.heat_legend')}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-3 rounded-pill border-[2.5px] border-accent-text bg-surface" />
                {t('console.legend_garage')}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-flex h-[16px] items-center rounded-pill border-[1.5px] border-bad-solid bg-bad-tint px-1 text-[10px] font-semibold leading-none text-bad">#</span>
                {t('console.legend_waiting')}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0 w-4 border-t-[3px] border-dashed border-accent-text" />
                {t('console.legend_trip')}
              </li>
            </ul>
            {!pins ? <p className="mt-2 text-xs text-faint">{t('console.map_position_note')}</p> : null}
          </div>

          <Drawer open={selected !== null} title={selectionTitle(selected)} onClose={close}>
            {selected && (
              <SelectionBody
                selected={selected}
                tripsById={tripsById}
                cards={cards}
                pinsById={pinsById}
                presence={pins !== null}
                following={follow}
                onFollow={(id) => setFollow((f) => (f === id ? null : id))}
              />
            )}
          </Drawer>
        </div>

        {signedIn ? (
          <aside className="flex min-h-0 flex-col border-line bg-surface lg:w-[340px] lg:flex-none lg:border-s">
            <Tabs
              label={t('console.map_side')}
              value={tab}
              onChange={setTab}
              className="px-4"
              options={[
                { value: 'drivers', label: t('console.map_tab_drivers'), count: driverCount },
                { value: 'trips', label: t('console.map_tab_trips'), count: shownTrips.length },
              ]}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'drivers' ? (
                shownPins.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">{pins ? t('console.map_no_drivers') : t('console.map_position_note')}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {shownPins.map((p) => {
                      const state = markerStateForPin(p.state);
                      const trip = p.tripId ? tripsById.get(p.tripId) : undefined;
                      const ids = trip?.orders.filter((l) => l.detachedAt === null).map((l) => orderLabel(l.orderId)) ?? [];
                      const on = selectedDriver === p.driverId;
                      return (
                        <li key={p.driverId}>
                          <button
                            type="button"
                            onClick={() => selectDriver(p)}
                            aria-pressed={on}
                            className={cx('flex w-full items-start gap-2.5 px-4 py-2 text-start', on ? 'bg-accent-wash' : 'hover:bg-surface-2')}
                          >
                            <StateGlyph state={state} size={16} className="mt-[3px]" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                <PersonName id={p.driverId} vehicle vehicleClass={p.vehicleClass} copy={false} />
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {pinStateLabel(p.state)}
                                {trip ? (
                                  <>
                                    {' '}· <span className="num">{ids.join(' ') || verticalLabel(trip.vertical)}</span>
                                  </>
                                ) : p.zoneId ? (
                                  <> · {zoneName(p.zoneId)}</>
                                ) : null}
                              </span>
                            </span>
                            {follow === p.driverId ? <Chip size="sm" tone="ready">{t('console.map_follow_on')}</Chip> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : shownTrips.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">{t('console.map_empty')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {shownTrips.map((trip) => {
                    const on = selected?.kind === 'driver' ? selected.tripId === trip.id : selected?.id === trip.id;
                    const first = trip.orders.find((l) => l.detachedAt === null);
                    return (
                      <li key={trip.id}>
                        <button
                          type="button"
                          onClick={() => selectTrip(trip.id)}
                          aria-pressed={on}
                          className={cx('flex w-full items-center justify-between gap-2 px-4 py-2 text-start text-sm', on ? 'bg-accent-wash' : 'hover:bg-surface-2')}
                        >
                          <span className="min-w-0 truncate">
                            <span className="num font-medium">{first ? orderLabel(first.orderId) : verticalLabel(trip.vertical)}</span>
                            <span className="text-muted"> · {verticalLabel(trip.vertical)}</span>
                            {trip.courierId ? (
                              <span className="text-muted">
                                {' '}· <PersonName id={trip.courierId} copy={false} />
                              </span>
                            ) : null}
                          </span>
                          <Chip size="sm" tone={trip.courierId ? 'live' : 'ready'}>
                            {tripStateLabel(trip.state)}
                          </Chip>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="hidden items-center gap-3 border-t border-line px-4 py-2 text-xs text-muted lg:flex">
              <span className="inline-flex items-center gap-1">
                <Kbd>F</Kbd> {t('console.map_k_follow')}
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>Esc</Kbd> {t('console.kb_close')}
              </span>
            </p>
          </aside>
        ) : null}
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
      return labelDigits(AZIZIYAH_ZONES.find((z) => z.id === s.id)?.name_ar ?? t('console.drawer_zone'));
    case 'garage':
      return labelDigits(GARAGES.find((g) => g.key === s.id)?.name_ar ?? t('console.drawer_garage'));
  }
}

function SelectionBody({
  selected,
  tripsById,
  cards,
  pinsById,
  presence,
  following,
  onFollow,
}: {
  selected: MapSelection;
  tripsById: ReadonlyMap<string, Trip>;
  cards: readonly BoardCard[];
  pinsById: ReadonlyMap<string, DriverPin>;
  presence: boolean;
  following: string | null;
  onFollow: (driverId: string) => void;
}) {
  if (selected.kind === 'driver' || selected.kind === 'trip') {
    const tripId = selected.kind === 'driver' ? selected.tripId : selected.id;
    const trip = tripId ? tripsById.get(tripId) : undefined;
    const card = tripId ? cards.find((c) => c.tripId === tripId) : undefined;
    const pin = selected.kind === 'driver' ? pinsById.get(selected.id) : undefined;
    return (
      <div className="space-y-4">
        {selected.kind === 'driver' && (
          <>
            <dl>
              <Row k={t('console.name')} v={<PersonName id={selected.id} vehicle vehicleClass={pin?.vehicleClass} copy={false} strong />} />
              {pin ? (
                <>
                  <Row
                    k={t('console.col_state')}
                    v={
                      <span className="inline-flex items-center gap-1.5">
                        <StateGlyph state={markerStateForPin(pin.state)} size={14} />
                        {pinStateLabel(pin.state)}
                      </span>
                    }
                  />
                  <Row k={t('console.driver_vehicle')} v={vehicleLabel(pin.vehicleClass)} />
                  <Row k={t('console.driver_tier')} v={capTierLabel(pin.tier)} />
                  {pin.zoneId && <Row k={t('console.drawer_zone')} v={zoneName(pin.zoneId)} />}
                  <Row k={t('console.driver_last_seen')} v={<span className="num">{formatClock(pin.lastSeenAt)}</span>} />
                  <Row
                    k={t('console.id')}
                    v={
                      <span className="inline-flex items-center gap-1">
                        <Mono title={selected.id}>{shortId(selected.id)}</Mono>
                        <CopyId id={selected.id} />
                      </span>
                    }
                  />
                </>
              ) : (
                <Row k={t('console.drawer_driver')} v={<Chip>{presence ? t('console.driver_not_online') : t('console.approx')}</Chip>} />
              )}
            </dl>
            {pin ? <CashLine pin={pin} /> : null}
          </>
        )}
        {(trip || card || selected.kind === 'trip') && <TripDetails trip={trip} card={card} />}
        <div className="flex flex-wrap gap-2">
          {selected.kind === 'driver' && pin ? (
            <Button variant={following === selected.id ? 'secondary' : 'primary'} aria-pressed={following === selected.id} onClick={() => onFollow(selected.id)} kbd="F">
              {following === selected.id ? t('console.map_follow_stop') : t('console.map_follow')}
            </Button>
          ) : null}
          {selected.kind === 'driver' && (
            <Link href={`/drivers/${encodeURIComponent(selected.id)}/ledger`} className={buttonCls('secondary')}>
              {t('console.open_ledger')}
            </Link>
          )}
          <Link href="/dispatch" className={buttonCls('ghost')}>
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
          <Row k={t('console.zone_live_cards')} v={<span className="num">{live}</span>} />
        </dl>
        <ZoneDemandPanel zoneId={z.id} />
        <p className="text-xs text-faint">{t('console.zone_draft_note')}</p>
      </div>
    );
  }
  const g = GARAGES.find((x) => x.key === selected.id);
  if (!g) return null;
  return (
    <dl>
      <Row k={t('console.drawer_garage')} v={labelDigits(g.name_ar)} />
      <Row k={t('console.id')} v={<Mono>{g.key}</Mono>} />
      {!g.inCity && <Row k={t('console.garage_outside')} v={<IconCheck size={14} />} />}
    </dl>
  );
}
