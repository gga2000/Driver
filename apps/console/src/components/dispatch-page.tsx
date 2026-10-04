'use client';

import dynamic from 'next/dynamic';
import type { BoardCard, Order, Trip } from '@driver/contracts';
import { t } from '@driver/i18n';
import { MARKER_STATES } from '@driver/map';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rightNow, type BoardColumn } from '@/lib/board';
import {
  buildQueue,
  DESK_START,
  deskKey,
  merchantOfTrip,
  pickupOf,
  queueOrder,
  rankCandidates,
  triage,
  type Candidate,
  type DeskKey,
  type DeskState,
} from '@/lib/dispatch';
import { eventKey, isTypingTarget } from '@/lib/hotkeys';
import { buildLiveGeoJSON, orderTags } from '@/lib/live-map';
import { LIVE_POLL_MS, useActiveOrders, useActiveTrips, useDispatchBoard, useDriverPins, useRightNow } from '@/lib/live';
import { orderLabel, personText, useNames } from '@/lib/names';
import { useConsoleNetwork } from '@/lib/network';
import { readJson, useTheme, writeJson } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { shortId } from '@/lib/format';
import { cardTitle, ForceDialog, OtherDriverDialog, useOverride } from './dispatch/assign';
import { DispatchQueue } from './dispatch/queue';
import { setMuted, useMuted, useNeedsAlert } from './dispatch/sound';
import { TriageBar } from './dispatch/triage-bar';
import type { MapHoverTarget, MapSelection } from './live-map-canvas';
import { DriverHoverCard, OrderHoverCard, StateGlyph, TierLegend } from './map-cards';
import { EmptyState, Kbd, LiveBadge, NeedLogin, NetworkBanner, QueryError, SkeletonBlock, useSecondsSince, useToast } from './ui';

const LiveMapCanvas = dynamic(() => import('./live-map-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted" role="status">
      {t('console.map_loading')}
    </div>
  ),
});

const COLLAPSED_KEY = 'driver.console.dispatch.collapsed';
const DIGIT_CODES: Record<string, DeskKey> = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4', Numpad5: '5' };

/**
 * /dispatch (K-03, K-04, K-05, K-07): the live map on the start side, the queue on the end side,
 * the triage bar on top. Select a card (click, J/K, or A for the oldest one waiting) and its five
 * best drivers open under it and light up on the map with their numbers; 1–5 picks one, Enter sends
 * the offer. A card can also be dragged onto a driver on the map. Dispatch modes live on /controls.
 */
export function DispatchPage() {
  const signedIn = useSignedIn();
  const board = useDispatchBoard();
  const trips = useActiveTrips();
  const server = useRightNow();
  const positions = useDriverPins();
  const activeOrders = useActiveOrders();
  const net = useConsoleNetwork();
  const theme = useTheme();
  const toast = useToast();
  const override = useOverride();
  const cut = net.state !== 'online';
  const tick = useSecondsSince(board.dataUpdatedAt);

  const [desk, setDesk] = useState<DeskState>(DESK_START);
  const [dropped, setDropped] = useState<string | null>(null);
  const [force, setForce] = useState<Candidate | null>(null);
  const [other, setOther] = useState<BoardCard | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<BoardColumn>>(() => new Set<BoardColumn>(['assigned']));
  useEffect(() => setCollapsed(new Set(readJson<BoardColumn[]>(COLLAPSED_KEY, ['assigned']))), []);
  const toggle = useCallback((col: BoardColumn) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      writeJson(COLLAPSED_KEY, [...next]);
      return next;
    });
  }, []);

  const cards = useMemo(() => board.data?.cards ?? [], [board.data]);
  const queue = useMemo(() => buildQueue(cards), [cards]);
  const local = useMemo(() => rightNow(cards), [cards]);
  const tri = useMemo(() => triage(queue), [queue]);
  const order = useMemo(() => queueOrder(queue, collapsed), [queue, collapsed]);
  const tripList = useMemo(() => trips.data ?? [], [trips.data]);
  const tripsById = useMemo(() => new Map<string, Trip>(tripList.map((x) => [x.id, x])), [tripList]);
  const pins = useMemo(() => (positions.isSuccess ? positions.data.drivers : null), [positions.isSuccess, positions.data]);
  const pinsById = useMemo(() => new Map((pins ?? []).map((p) => [p.driverId, p])), [pins]);
  const vehicles = useMemo(() => new Map((pins ?? []).map((p) => [p.driverId, p.vehicleClass])), [pins]);
  const ordersByTrip = useMemo(() => new Map(tripList.map((tr) => [tr.id, tr.orders.filter((l) => l.detachedAt === null).map((l) => l.orderId)])), [tripList]);
  const ordersById = useMemo(() => new Map<string, Order>((activeOrders.data ?? []).map((o) => [o.id, o])), [activeOrders.data]);
  const ordersOf = useCallback((tripId: string) => ordersByTrip.get(tripId) ?? [], [ordersByTrip]);
  const merchantOf = useCallback((tripId: string) => merchantOfTrip(ordersOf(tripId), ordersById), [ordersOf, ordersById]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.tripId, c])), [cards]);

  const known = board.isSuccess && !board.isError && !cut;
  const { blocked } = useNeedsAlert(tri.needs, known);
  const muted = useMuted();

  // The selected card and its candidates (+ a driver dropped on it from beyond the top five).
  const selectedCard = desk.selected ? cardById.get(desk.selected) : undefined;
  useEffect(() => {
    if (desk.selected && board.isSuccess && !cardById.has(desk.selected)) setDesk(DESK_START);
  }, [desk.selected, cardById, board.isSuccess]);
  const candidates = useMemo(() => {
    if (!selectedCard) return [];
    const all = rankCandidates(selectedCard, pickupOf(tripsById.get(selectedCard.tripId)), pins ?? [], { limit: 500 });
    const top = all.slice(0, 5);
    if (dropped && !top.some((c) => c.driverId === dropped)) {
      const extra = all.find((c) => c.driverId === dropped);
      if (extra) top.push(extra);
    }
    return top;
  }, [selectedCard, tripsById, pins, dropped]);
  const assignable = Boolean(selectedCard && selectedCard.status !== 'cancelled');
  const picked = desk.pick >= 0 ? candidates[desk.pick] : undefined;

  const names = useNames({ people: candidates.map((c) => c.driverId) });
  const nameOf = useCallback((id: string) => personText(id, names.person(id)) ?? shortId(id), [names]);

  const select = useCallback((tripId: string | null) => {
    setDropped(null);
    setDesk(tripId ? { selected: tripId, pick: -1 } : DESK_START);
  }, []);

  const send = useCallback(
    (c: Candidate | undefined, reason?: string) => {
      if (!selectedCard || !c) return;
      if (c.blockers.length > 0 && !reason) {
        setForce(c);
        return;
      }
      const name = nameOf(c.driverId);
      override.mutate(
        { tripId: selectedCard.tripId, driverId: c.driverId, ...(reason ? { reason, force: true } : {}) },
        {
          onSuccess: (out) => {
            setForce(null);
            setDesk((d) => ({ ...d, pick: -1 }));
            setDropped(null);
            toast({ title: t('console.q_sent_toast', { name }), ...(out.warnings.length ? { body: t('console.override_warnings', { list: out.warnings.join('، ') }) } : {}), tone: 'ok' });
          },
          onError: (err) => {
            if (!reason) toast({ title: t('console.q_send_failed', { name }), body: err.message, tone: 'bad' });
          },
        },
      );
    },
    [selectedCard, nameOf, override, toast],
  );

  // Keys: J/K, A, 1–5, Enter, Esc, M. Physical keys, so an Arabic layout works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement | null;
      const k = DIGIT_CODES[e.code] ?? eventKey(e);
      if (k === 'm') {
        e.preventDefault();
        setMuted(!muted);
        return;
      }
      // Enter on a focused control presses that control (a picked candidate's row sends on its own).
      if (k === 'enter' && target?.closest('button, a, input, select, textarea, summary')) return;
      if (!['j', 'k', 'a', 'enter', 'escape', '1', '2', '3', '4', '5'].includes(k)) return;
      const r = deskKey(desk, k as DeskKey, { order, oldest: tri.oldest?.tripId ?? null, candidates: candidates.length, assignable });
      if (r.state === desk && !r.effect) return;
      e.preventDefault();
      if (r.state.selected !== desk.selected) setDropped(null);
      setDesk(r.state);
      if (r.effect === 'send') send(candidates[r.state.pick]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desk, order, tri.oldest, candidates, assignable, send, muted]);

  // Map data.
  const live = useMemo(() => buildLiveGeoJSON(tripList, cards, pins), [tripList, cards, pins]);
  const tags = useMemo(() => orderTags(cards, tripsById), [cards, tripsById]);
  const rankMap = useMemo(() => new Map(candidates.map((c, i) => [c.driverId, i + 1])), [candidates]);
  const allNames = useNames({ people: (pins ?? []).map((p) => p.driverId) });
  const driverLabel = useCallback((id: string) => personText(id, allNames.person(id)), [allNames]);
  const orderText = useCallback((tripId: string) => {
    const ids = ordersByTrip.get(tripId) ?? [];
    return ids[0] ? orderLabel(ids[0]) : (cardById.get(tripId) ? t('console.q_trip') : '');
  }, [ordersByTrip, cardById]);
  const onMapSelect = useCallback(
    (s: MapSelection | null) => {
      if (!s) return;
      if (s.kind === 'trip' && cardById.has(s.id)) select(s.id);
      if (s.kind === 'driver') {
        const i = candidates.findIndex((c) => c.driverId === s.id);
        if (selectedCard && i >= 0) setDesk((d) => ({ ...d, pick: i }));
        else if (selectedCard) setDropped(s.id);
        else if (s.tripId && cardById.has(s.tripId)) select(s.tripId);
      }
    },
    [cardById, candidates, selectedCard, select],
  );
  const onDropTrip = useCallback(
    (tripId: string, driverId: string) => {
      if (!cardById.has(tripId)) return;
      setDesk({ selected: tripId, pick: -1 });
      setDropped(driverId);
    },
    [cardById],
  );
  // After a drop, pick the dropped driver once the list includes him.
  useEffect(() => {
    if (!dropped) return;
    const i = candidates.findIndex((c) => c.driverId === dropped);
    if (i >= 0 && desk.pick !== i) setDesk((d) => ({ ...d, pick: i }));
  }, [dropped, candidates, desk.pick]);

  const renderHover = useCallback(
    (h: MapHoverTarget) => {
      if (h.kind === 'driver') {
        const pin = pinsById.get(h.id);
        if (!pin) return null;
        return <DriverHoverCard pin={pin} trip={pin.tripId ? tripsById.get(pin.tripId) : undefined} card={pin.tripId ? cardById.get(pin.tripId) : undefined} />;
      }
      const card = cardById.get(h.id);
      return card ? <OrderHoverCard card={card} orderIds={ordersOf(h.id)} merchantId={merchantOf(h.id)} tick={tick} /> : null;
    },
    [pinsById, tripsById, cardById, ordersOf, merchantOf, tick],
  );

  if (!signedIn) {
    return (
      <div className="p-8">
        <h1 className="mb-4 text-2xl font-bold">{t('console.dispatch_title')}</h1>
        <NeedLogin />
      </div>
    );
  }

  const oldestSec = tri.oldest ? tri.oldest.elapsedSec + tick : null;
  const selectedTitle = selectedCard ? cardTitle(selectedCard, ordersOf(selectedCard.tripId)) : '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 lg:px-5">
        <div className="min-w-0 pe-1">
          <h1 className="text-lg font-bold leading-7">{t('console.dispatch_title')}</h1>
          <LiveBadge compact seconds={LIVE_POLL_MS / 1000} updatedAt={board.dataUpdatedAt} fetching={board.isFetching} error={board.isError} />
        </div>
        <TriageBar
          tri={tri}
          oldestSec={oldestSec}
          local={local}
          known={known}
          server={server.isError || cut ? undefined : server.data}
          serverError={server.error !== null}
          onTake={() => tri.oldest && select(tri.oldest.tripId)}
          blocked={blocked}
        />
      </header>

      <div className="px-4 empty:hidden lg:px-5 [&>*]:mb-0 [&>*]:mt-3">
        <NetworkBanner />
        {board.error ? <QueryError error={board.error} onRetry={() => void board.refetch()} /> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Map: the start side (right in RTL), two-thirds. */}
        <div className="relative h-[46vh] min-h-[320px] lg:h-auto lg:min-w-0 lg:flex-[2]">
          <LiveMapCanvas
            live={live}
            theme={theme}
            selected={selectedCard ? { kind: 'trip', id: selectedCard.tripId } : null}
            onSelect={onMapSelect}
            fitKey={0}
            focus={null}
            orders={tags}
            orderText={orderText}
            routes="focus"
            focusTripId={selectedCard?.tripId ?? null}
            candidates={selectedCard ? rankMap : undefined}
            picked={picked?.driverId ?? null}
            driverLabel={driverLabel}
            renderHover={renderHover}
            onDropTrip={onDropTrip}
          />
          <MapLegend theme={theme} />
        </div>

        {/* Queue: the end side, one-third. */}
        <aside aria-label={t('console.dispatch_queue')} className="flex min-h-0 flex-col border-line bg-surface lg:w-[400px] lg:flex-none lg:border-s xl:w-[min(440px,36%)]">
          {board.isPending ? (
            <div className="space-y-2 p-4" aria-busy="true" aria-label={t('console.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <SkeletonBlock key={i} className="h-16" />
              ))}
            </div>
          ) : board.isSuccess && cards.length === 0 ? (
            <div className="p-4">
              <EmptyState title={t('console.board_empty')} hint={t('console.map_empty_hint')} />
            </div>
          ) : (
            <DispatchQueue
              queue={queue}
              collapsed={collapsed}
              onToggle={toggle}
              selected={desk.selected}
              onSelect={select}
              ordersOf={ordersOf}
              merchantOf={merchantOf}
              vehicles={vehicles}
              tick={tick}
              candidates={candidates}
              pick={desk.pick}
              onPick={(i) => setDesk((d) => ({ ...d, pick: i }))}
              onSend={() => send(picked)}
              sending={override.isPending && !force}
              onOther={() => selectedCard && setOther(selectedCard)}
              dim={cut}
            />
          )}
          <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted lg:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> {t('console.q_k_move')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>A</Kbd> {t('console.q_k_take')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>1–5</Kbd> {t('console.q_k_pick')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> {t('console.q_k_send')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>?</Kbd> {t('console.q_k_all')}
            </span>
          </p>
        </aside>
      </div>

      <ForceDialog
        target={force}
        name={force ? nameOf(force.driverId) : ''}
        title={selectedTitle}
        busy={override.isPending}
        error={force ? override.error : null}
        onSend={(reason) => send(force ?? undefined, reason)}
        onClose={() => setForce(null)}
      />
      <OtherDriverDialog
        card={other}
        title={other ? cardTitle(other, ordersOf(other.tripId)) : ''}
        drivers={(pins ?? []).map((p) => p.driverId)}
        onClose={() => setOther(null)}
        onSent={(id) => {
          setOther(null);
          toast({ title: t('console.q_sent_toast', { name: personText(id, allNames.person(id)) ?? shortId(id) }), tone: 'ok' });
        }}
      />
    </div>
  );
}

/** The map key: driver state by shape, the tier ramp. Bottom start corner, out of the way. */
function MapLegend({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="pointer-events-none absolute bottom-3 end-3 z-10 w-[min(300px,calc(100%-1.5rem))] rounded-lg border border-line bg-raised/95 px-3 py-2.5 shadow-pop">
      <ul className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-text">
        {MARKER_STATES.map((s) => (
          <li key={s} className="flex items-center gap-1.5 whitespace-nowrap">
            <StateGlyph state={s} size={14} />
            {t(`console.marker_${s}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className="inline-flex h-[18px] items-center rounded-pill border-[1.5px] border-bad-solid bg-bad-tint px-1 text-[10px] font-semibold leading-none text-bad">
            #
          </span>
          {t('console.legend_waiting')}
        </li>
      </ul>
      <TierLegend theme={theme} className="mt-2" />
    </div>
  );
}
