import { jobOrder, tenderOptions, type BoardCard, type LatLng, type Trip } from '@driver/contracts';
import { haversineMeters } from '../../trips/index.js';
import type { ActionKind, DriverAction, DriverRun, DriverTrip, ReplayRecord, SimContext } from '../context.js';
import { CITY } from '../context.js';
import { servedVerticals } from '../../dispatch/index.js';
import { VEHICLE_SPEED_KMH, simDriverRoles } from '../world.js';

/**
 * Courier / driver behaviour (plan Step 7): online with a heartbeat every tick (5 s sim time),
 * moves toward the next stop at 25 / 30 / 35 km/h (bike / tuktuk / car), accepts ~85 % of offers
 * and declines or ignores the rest, sometimes drops offline mid-shift and replays the taps he queued
 * with their idempotency keys when he is back (sometimes after the dispatcher reassigned his job,
 * which exercises the late-replay quarantine), and settles his cash before the cap stops his offers.
 */
export const DRIVER_BEHAVIOUR = {
  acceptRate: 0.85,
  declineRate: 0.1,
  reactionSec: [2, 12] as const,
  /** Offline episodes per online hour, and how long they last. */
  offlinePerHour: 0.2,
  offlineMin: [2, 12] as const,
  /** The app re-sends a tap it already sent (lost ack). */
  duplicateTapRate: 0.03,
  /** On reconnect the app re-sends the last acknowledged tap. */
  resendOnReconnect: 0.5,
  /** Settles (merchant hand-overs + agent) once owed reaches this share of the cap. */
  settleAtShareOfCap: 0.5,
  settleCheckEverySec: 60,
  /** Close enough to the stop to tap "وصلت" (inside the 60 m geofence). */
  arriveWithinM: 25,
  unreachableStartAfterSec: 20,
  /** Haversine × 1.4 is the road distance dispatch assumes: move along the line at speed / 1.4. */
  roadFactor: 1.4,
  /**
   * "الخردة علينا": about one cash drop-off in this many, the customer hands over the next note up and
   * the courier has no change — he takes the whole note and the rest goes to the customer's wallet
   * (picked by order id, not the driver's random stream, so the rest of the run is unchanged).
   */
  noChangeEvery: 8,
  /**
   * s1 «رمز المشوار»: at a night ride's pickup the rider reads out the code from his app; about one
   * in this many times the driver mistypes it once first (picked by order id, like `noChangeEvery`).
   */
  startCodeTypoEvery: 4,
};

const TERMINAL_TRIP = new Set(['completed', 'customer_cancelled', 'driver_cancelled', 'platform_cancelled', 'failed']);

export function actorOf(d: DriverRun) {
  return { personId: d.personId, sessionId: `sim-${d.def.key}` };
}

// ───────────────────────── shift, presence, offline episodes ─────────────────────────

export async function driverShift(ctx: SimContext, d: DriverRun, dtSec: number, dayStartT: number): Promise<void> {
  const shiftStart = dayStartT + d.def.shiftStartMin * 60_000;
  const shiftEnd = dayStartT + d.def.shiftEndMin * 60_000;
  if (!d.started) {
    if (ctx.t < shiftStart) return;
    d.started = true;
    d.bootT = ctx.t - d.rand.int(600, 7200) * 1000;
    await goOnline(ctx, d);
    return;
  }
  if (d.loggedOff) return;

  if (!d.online) {
    if (d.offlineUntilT !== null && ctx.t >= d.offlineUntilT) await reconnect(ctx, d);
    return;
  }
  if (ctx.t >= shiftEnd && d.trips.size === 0) {
    d.loggedOff = true;
    d.online = false;
    await ctx.call('driver.offline', () => ctx.s.dispatch.presence.offline(d.personId));
    return;
  }
  // An offline episode (dead battery, no signal) — not in the last hour, so the day can close.
  if (ctx.t < shiftEnd - 60 * 60_000 && d.rand.chance((DRIVER_BEHAVIOUR.offlinePerHour * dtSec) / 3600)) {
    d.online = false;
    d.offlineSinceT = ctx.t;
    d.offlineUntilT = ctx.t + d.rand.int(...DRIVER_BEHAVIOUR.offlineMin) * 60_000;
    for (const b of d.bag.values()) b.offline = true;
    await ctx.call('driver.offline', () => ctx.s.dispatch.presence.offline(d.personId));
    return;
  }
  const p = await ctx.call('driver.heartbeat', () => ctx.s.dispatch.presence.heartbeat(d.personId, d.pos));
  if (p === null) await goOnline(ctx, d);
}

async function goOnline(ctx: SimContext, d: DriverRun): Promise<void> {
  d.online = true;
  d.offlineSinceT = null;
  d.offlineUntilT = null;
  await ctx.call('driver.online', () =>
    // What partner.goOnline would set: his roles on his registered vehicle (review 2026-10-04 #20).
    ctx.s.dispatch.presence.online(d.personId, { cityId: CITY, at: d.pos, vehicle: d.def.vehicle, tier: d.def.tier, edgeOptIn: d.def.edgeOptIn, verticals: servedVerticals(simDriverRoles(d.def.vehicle), d.def.vehicle) }),
  );
}

/** Back online: the app re-sends what it queued (and sometimes the last tap it already sent). */
async function reconnect(ctx: SimContext, d: DriverRun): Promise<void> {
  await goOnline(ctx, d);
  if (d.lastAcked && d.rand.chance(DRIVER_BEHAVIOUR.resendOnReconnect)) await replay(ctx, d, d.lastAcked, 'duplicate');
  const queued = d.queue.splice(0, d.queue.length);
  for (const a of queued) {
    await replay(ctx, d, a, 'fresh');
    d.lastAcked = a;
  }
  for (const tripId of [...d.trips.keys()]) await refreshTrip(ctx, d, tripId);
}

// ───────────────────────── offers ─────────────────────────

/** New offers for this driver on the board (Partner's offer card), answered after a reaction time. */
export async function driverOffers(ctx: SimContext, d: DriverRun, offers: ReadonlyArray<{ card: BoardCard; offerId: string }>): Promise<void> {
  if (!d.online) return;
  for (const { card, offerId } of offers) {
    if (d.handledOffers.has(offerId)) continue;
    d.handledOffers.add(offerId);
    const x = d.rand.next();
    const decision = x < DRIVER_BEHAVIOUR.acceptRate ? 'accept' : x < DRIVER_BEHAVIOUR.acceptRate + DRIVER_BEHAVIOUR.declineRate ? 'decline' : 'ignore';
    d.pending.push({ offerId, tripId: card.tripId, at: ctx.t + d.rand.int(...DRIVER_BEHAVIOUR.reactionSec) * 1000, decision });
  }
  const due = d.pending.filter((p) => ctx.t >= p.at);
  d.pending = d.pending.filter((p) => ctx.t < p.at);
  for (const p of due) {
    if (p.decision === 'ignore') {
      // Seen in the foreground for 4 s, then left to time out: "ignored" (edge-case §6).
      await ctx.call('driver.offer_seen', () => ctx.s.dispatch.offerSeen(actorOf(d), { offerId: p.offerId, foregroundMs: 4000 }));
      continue;
    }
    // The desk picked him because he was free; if he has taken another job since, he tells it no
    // (a manual offer skips dispatch's batching rules, so accepting would be an unplanned batch).
    const accept = p.decision === 'accept' && !(ctx.deskOffers.has(p.offerId) && d.trips.size > 0);
    const res = await ctx.call('driver.respond', () => ctx.s.dispatch.respond(actorOf(d), { offerId: p.offerId, accept }));
    if (res?.outcome === 'assigned') await takeTrip(ctx, d, res.tripId);
  }
}

async function takeTrip(ctx: SimContext, d: DriverRun, tripId: string): Promise<void> {
  const view = await ctx.call('driver.trip', () => ctx.s.trips.get(tripId));
  if (!view) return;
  const t: DriverTrip = { tripId, vertical: view.vertical, view, local: new Map(), arrivedT: new Map(), unreachableStarted: new Set(), batched: d.trips.size > 0, acceptedT: ctx.t };
  d.trips.set(tripId, t);
  for (const o of view.orders) {
    const run = ctx.ordersById.get(o.orderId);
    if (!run || o.detachedAt) continue;
    run.lastCourierId = d.personId;
    run.stageT.driver_en_route ??= ctx.t;
  }
}

async function refreshTrip(ctx: SimContext, d: DriverRun, tripId: string): Promise<void> {
  const view = await ctx.call('driver.trip', () => ctx.s.trips.get(tripId));
  if (!view || TERMINAL_TRIP.has(view.state) || view.courierId !== d.personId) {
    d.trips.delete(tripId);
    return;
  }
  const trip = d.trips.get(tripId);
  if (trip) trip.view = view;
}

// ───────────────────────── moving and stops ─────────────────────────

interface Target {
  trip: DriverTrip;
  stop: Trip['stops'][number];
  at: LatLng;
}

function openStops(d: DriverRun): Target[] {
  const out: Target[] = [];
  for (const trip of d.trips.values()) {
    const view = trip.view;
    for (const stop of view.stops) {
      if (stop.state === 'completed' || stop.state === 'skipped' || trip.local.get(stop.id) === 'completed') continue;
      // A drop-off waits for its own pickup.
      if (stop.type === 'dropoff') {
        const pickup = view.stops.find((s) => s.orderId === stop.orderId && (s.type === 'pickup' || s.type === 'shop'));
        if (pickup && pickup.state !== 'completed' && trip.local.get(pickup.id) !== 'completed' && pickup.state !== 'skipped') continue;
      }
      out.push({ trip, stop, at: stop.target ?? d.pos });
    }
  }
  return out;
}

function nextTarget(ctx: SimContext, d: DriverRun): Target | null {
  const open = openStops(d);
  if (open.length === 0) return null;
  // Work an arrived stop first; then the pickups in the order the jobs were taken (the route the
  // batching rules planned: the batch leaves the last kitchen together); then drop-offs, nearest first.
  const arrived = open.find((o) => o.trip.local.get(o.stop.id) === 'arrived' || o.stop.state === 'arrived');
  if (arrived) return arrived;
  const pickups = open.filter((o) => o.stop.type !== 'dropoff');
  // Standing at a kitchen where another of his bags is already ready: he takes it now rather than
  // driving off and coming back for it.
  const readyHere = (o: Target) => {
    const readyT = o.stop.orderId ? ctx.ordersById.get(o.stop.orderId)?.readyT : null;
    return readyT !== null && readyT !== undefined && ctx.t >= readyT && haversineMeters(d.pos, o.at) <= DRIVER_BEHAVIOUR.arriveWithinM;
  };
  const here = pickups.find(readyHere);
  if (here) return here;
  if (pickups.length > 0) {
    // The jobs in the order the server says he works them (`jobOrder`, the route batching checked).
    const order = jobOrder([...d.trips.values()].map((t) => t.view)).map((t) => t.id);
    return pickups.reduce((first, o) => {
      const a = order.indexOf(o.trip.tripId);
      const b = order.indexOf(first.trip.tripId);
      return a < b || (a === b && o.stop.seq < first.stop.seq) ? o : first;
    });
  }
  return open.reduce((best, o) => (haversineMeters(d.pos, o.at) < haversineMeters(d.pos, best.at) ? o : best));
}

function moveToward(d: DriverRun, to: LatLng, dtSec: number): number {
  const dist = haversineMeters(d.pos, to);
  const step = ((VEHICLE_SPEED_KMH[d.def.vehicle] * 1000) / 3600 / DRIVER_BEHAVIOUR.roadFactor) * dtSec;
  if (dist <= step || dist < 1) {
    d.pos = { lat: to.lat, lng: to.lng };
    return 0;
  }
  const f = step / dist;
  d.pos = { lat: d.pos.lat + (to.lat - d.pos.lat) * f, lng: d.pos.lng + (to.lng - d.pos.lng) * f };
  return dist - step;
}

export async function driverWork(ctx: SimContext, d: DriverRun, dtSec: number): Promise<void> {
  if (d.trips.size === 0) return;
  if (d.online) for (const tripId of [...d.trips.keys()]) await refreshTrip(ctx, d, tripId);
  const target = nextTarget(ctx, d);
  if (!target) return;
  if (target.stop.type === 'dropoff') recordDepartures(ctx, d);
  const left = moveToward(d, target.at, dtSec);
  if (d.online) await ctx.call('driver.position', () => ctx.s.trips.reportPosition(d.personId, { pin: d.pos, at: ctx.appNow() }));
  if (left > DRIVER_BEHAVIOUR.arriveWithinM) return;

  const { trip, stop } = target;
  const local = trip.local.get(stop.id);
  if (local === undefined && stop.state === 'pending') {
    trip.arrivedT.set(stop.id, ctx.t);
    await act(ctx, d, trip, 'arrive', stop);
    return;
  }
  const arrivedT = trip.arrivedT.get(stop.id) ?? ctx.t;
  if (!trip.arrivedT.has(stop.id)) trip.arrivedT.set(stop.id, ctx.t);
  const run = stop.orderId ? ctx.ordersById.get(stop.orderId) : undefined;

  if (stop.type === 'pickup' || stop.type === 'shop') {
    if (trip.vertical === 'taxi' || trip.vertical === 'tuktuk') {
      if (ctx.t >= arrivedT + (run?.plan.boardingSec ?? 0) * 1000) await act(ctx, d, trip, 'complete', stop);
      return;
    }
    // Food: the bag is handed over when the kitchen is really done; never picked up while the phone is offline.
    if (!d.online || !run || run.readyT === null || ctx.t < run.readyT) return;
    const ok = await act(ctx, d, trip, 'complete', stop);
    if (ok && stop.orderId) {
      const order = await ctx.call('driver.order', () => ctx.s.orders.get(stop.orderId!));
      const promised = order?.promisedReadyAt?.getTime() ?? ctx.t;
      const actual = order?.readyAt?.getTime() ?? ctx.t;
      d.bag.set(stop.orderId, { readyAtMs: Math.max(promised, actual), lateMs: Math.max(0, actual - promised), batched: trip.batched || d.trips.size > 1, pickedUpT: ctx.t, offline: false, departed: false });
    }
    return;
  }

  // Drop-off.
  if (run && run.plan.unreachableSec > 0) {
    run.answersAt ??= arrivedT + run.plan.unreachableSec * 1000;
    if (ctx.t < run.answersAt) {
      if (d.online && !trip.unreachableStarted.has(stop.id) && ctx.t >= arrivedT + DRIVER_BEHAVIOUR.unreachableStartAfterSec * 1000) {
        trip.unreachableStarted.add(stop.id);
        await act(ctx, d, trip, 'unreachable', stop);
      }
      return;
    }
  }
  const cash = run && run.plan.payment === 'cash' ? await cashToCollect(ctx, stop.orderId!) : undefined;
  const ok = await act(ctx, d, trip, 'complete', stop, cash?.cashIqd, cash?.changeToWalletIqd);
  if (ok && stop.orderId) d.bag.delete(stop.orderId);
}

/**
 * What he takes at the door: the cash total, or — for some orders ("الخردة علينا") — the customer's
 * note (the one he said at checkout, else the next note up) with the rest to the customer's wallet,
 * when it fits the cap and the 250 step.
 */
async function cashToCollect(ctx: SimContext, orderId: string): Promise<{ cashIqd: number; changeToWalletIqd?: number } | undefined> {
  const order = await ctx.call('driver.order', () => ctx.s.orders.get(orderId));
  if (!order) return undefined;
  if (stableBucket(orderId, DRIVER_BEHAVIOUR.noChangeEvery) === 0) {
    const note = order.statedTenderIqd ?? tenderOptions(order.totalIqd)[1];
    const extra = note !== undefined ? note - order.totalIqd : 0;
    if (extra > 0 && extra <= 25_000 && extra % 250 === 0) return { cashIqd: note!, changeToWalletIqd: extra };
  }
  return { cashIqd: order.totalIqd };
}

/** A fixed bucket 0…n−1 for an id (FNV-1a), independent of every random stream. */
/** The code with its last digit off by one: the slip of a thumb, never the right code. */
function mistyped(code: string): string {
  const last = Number(code.at(-1));
  return `${code.slice(0, -1)}${(last + 1) % 10}`;
}

function stableBucket(id: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h % n;
}

/**
 * The batch leaves the last kitchen: how long each hot item waited since it was ready (the later of
 * promised and actual). Lateness of a kitchen picked up after it is the kitchen's, not the batching
 * plan's, and is taken off (and reported).
 */
function recordDepartures(ctx: SimContext, d: DriverRun): void {
  const bag = [...d.bag.entries()].filter(([, b]) => !b.departed);
  for (const [orderId, b] of bag) {
    b.departed = true;
    if (!b.batched) continue;
    const lateMs = Math.max(0, ...bag.filter(([, x]) => x.pickedUpT > b.pickedUpT).map(([, x]) => x.lateMs));
    const round = (ms: number) => Math.round(ms / 6000) / 10;
    ctx.hotWaits.push({
      orderId,
      courierId: d.personId,
      readyAtMs: b.readyAtMs,
      departAtMs: ctx.t,
      waitMin: round(ctx.t - b.readyAtMs - lateMs),
      rawWaitMin: round(ctx.t - b.readyAtMs),
      kitchenLateMin: round(lateMs),
      courierOffline: b.offline,
    });
  }
}

// ───────────────────────── taps: send now, or queue while offline ─────────────────────────

async function act(ctx: SimContext, d: DriverRun, trip: DriverTrip, kind: ActionKind, stop: Trip['stops'][number], cashIqd?: number, changeToWalletIqd?: number): Promise<boolean> {
  d.seq += 1;
  // What the rider's screen shows him (`OrderTracking.trip.startCode`): the order's code, if any.
  const startCode = kind === 'complete' && stop.type === 'pickup' && stop.orderId ? ((await ctx.call('rider.start_code', () => ctx.s.orders.startCodeOf(stop.orderId!))) ?? undefined) : undefined;
  const a: DriverAction = {
    kind,
    tripId: trip.tripId,
    stopId: stop.id,
    orderId: stop.orderId,
    key: `${d.def.key}.${d.seq}`,
    occurredAt: ctx.appNow(),
    uptimeMs: ctx.t - d.bootT,
    pin: { ...d.pos },
    ...(cashIqd !== undefined ? { cashIqd } : {}),
    ...(changeToWalletIqd !== undefined ? { changeToWalletIqd } : {}),
    ...(startCode !== undefined ? { startCode } : {}),
  };
  if (kind !== 'unreachable') trip.local.set(stop.id, kind === 'arrive' ? 'arrived' : 'completed');
  if (!d.online) {
    d.queue.push(a);
    return true;
  }
  // A mistyped code is refused (`start_code_wrong`) and counted; he asks again and types it right.
  if (startCode !== undefined && stableBucket(`${a.orderId}:start_code`, DRIVER_BEHAVIOUR.startCodeTypoEvery) === 0) {
    await send(ctx, d, { ...a, key: `${a.key}.typo`, startCode: mistyped(startCode) });
  }
  const ok = await send(ctx, d, a);
  if (!ok) {
    trip.local.delete(stop.id);
    return false;
  }
  d.lastAcked = a;
  if (d.rand.chance(DRIVER_BEHAVIOUR.duplicateTapRate)) await replay(ctx, d, a, 'duplicate');
  return true;
}

async function send(ctx: SimContext, d: DriverRun, a: DriverAction): Promise<boolean> {
  const stamp = { occurredAt: a.occurredAt, deviceUptimeMs: a.uptimeMs, idempotencyKey: a.key };
  const res =
    a.kind === 'arrive'
      ? await ctx.call('driver.arrive', () => ctx.s.trips.arrive(a.tripId, a.stopId, d.personId, { pin: a.pin, ...stamp }))
      : a.kind === 'complete'
        ? await ctx.call('driver.complete', () =>
            ctx.s.trips.completeStop(a.tripId, a.stopId, d.personId, {
              ...(a.cashIqd !== undefined ? { handover: { cashCollectedIqd: a.cashIqd, ...(a.changeToWalletIqd !== undefined ? { changeToWalletIqd: a.changeToWalletIqd } : {}) } } : {}),
              ...(a.startCode !== undefined ? { startCode: a.startCode } : {}),
              ...stamp,
            }),
          )
        : await ctx.call('driver.unreachable', () => ctx.s.trips.startUnreachable(a.tripId, a.stopId, d.personId, stamp));
  const trip = d.trips.get(a.tripId);
  if (res && trip) trip.view = res;
  if (res && a.kind === 'complete' && a.orderId && a.cashIqd !== undefined && res.stops.find((x) => x.id === a.stopId)?.state === 'completed') {
    ctx.doorCash.set(a.orderId, { orderId: a.orderId, courierId: d.personId, collectedIqd: a.cashIqd, changeToWalletIqd: a.changeToWalletIqd ?? 0 });
  }
  return res !== null;
}

/** Re-sends a tap and measures what it added: events, quarantined events, ledger rows. */
async function replay(ctx: SimContext, d: DriverRun, a: DriverAction, kind: ReplayRecord['kind']): Promise<void> {
  const view = await ctx.call('driver.trip', () => ctx.s.trips.get(a.tripId));
  const detached = Boolean(view?.orders.some((o) => o.orderId === a.orderId && o.detachedAt !== null && !view.orders.some((x) => x.orderId === a.orderId && x.detachedAt === null)));
  const before = await counts(ctx, a.tripId);
  const ok = await send(ctx, d, a);
  const after = await counts(ctx, a.tripId);
  ctx.replays.push({
    driverId: d.personId,
    key: a.key,
    action: a.kind,
    tripId: a.tripId,
    orderId: a.orderId,
    kind,
    detached,
    eventsAdded: after.events - before.events,
    quarantinedAdded: after.quarantined - before.quarantined,
    ledgerAdded: after.ledger - before.ledger,
    outcome: ok ? 'accepted' : 'refused',
  });
  const trip = d.trips.get(a.tripId);
  if (trip && !ok) trip.local.delete(a.stopId);
}

async function counts(ctx: SimContext, tripId: string): Promise<{ events: number; quarantined: number; ledger: number }> {
  const stats = await ctx.s.events.outboxStats();
  const quarantined = (await ctx.s.events.forTrip(tripId)).filter((e) => e.quarantined).length;
  const ledger = (await ctx.s.ledger.checkInvariant()).events;
  return { events: stats.pending + stats.published + stats.failed, quarantined, ledger };
}

// ───────────────────────── cash ─────────────────────────

/** Before the cap bites: hand merchants their cash (PIN/tablet confirmed), then pay the rest at an agent. */
export async function driverSettle(ctx: SimContext, d: DriverRun, opts: { force?: boolean; merchantsOnly?: boolean } = {}): Promise<void> {
  if (!opts.force && (!d.online || d.trips.size > 0 || ctx.t < d.nextSettleCheckT)) return;
  d.nextSettleCheckT = ctx.t + DRIVER_BEHAVIOUR.settleCheckEverySec * 1000;
  const status = await ctx.call('driver.cap', () => ctx.s.caps.status(d.personId));
  if (!status) return;
  if (!opts.force && status.owedIqd < status.capIqd * DRIVER_BEHAVIOUR.settleAtShareOfCap) return;
  const route = (await ctx.call('driver.return_route', () => ctx.s.merchantCash.returnRoute(d.personId))) ?? [];
  for (const stop of route) {
    d.seq += 1;
    const done = await ctx.call('driver.handover', () =>
      ctx.s.merchantCash.confirmHandover({ handoverId: `${d.def.key}.h${d.seq}`, courierId: d.personId, merchantId: stop.merchantId, amountIqd: stop.amountIqd, merchantConfirmedIqd: stop.amountIqd, tabletTap: true }),
    );
    if (done) ctx.handovers.push({ merchantId: stop.merchantId, courierId: d.personId, amountIqd: stop.amountIqd });
  }
  if (opts.merchantsOnly) return;
  const after = await ctx.call('driver.cap', () => ctx.s.caps.status(d.personId));
  if (after && after.owedIqd > 0) {
    d.seq += 1;
    await ctx.call('driver.agent', () => ctx.s.merchantCash.recordDriverSettlement({ driverId: d.personId, amountIqd: after.owedIqd, channel: 'agent', reference: `AG-${d.def.key}-${d.seq}` }));
  }
}
