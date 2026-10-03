import { describe, expect, it } from 'vitest';
import { DriversListInput, OrderSearchInput } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { dispatchHarness, north } from '../dispatch/test-harness.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { ordersHarness } from '../orders/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { ScoringService } from '../scoring/index.js';
import { ConsoleReadService } from './console.reads.js';
import { cashHeld, pinState } from './driver-state.js';

const START = '2026-10-03T09:00:00Z';
const SYSTEM = { personId: 'system' };

/** Every module the Console reads from, on in-memory twins, composed as ConsoleModule does. */
async function world() {
  const d = dispatchHarness(START);
  const id = identityHarness(START);
  const l = ledgerHarness({ start: START });
  const o = ordersHarness(START);
  const ev = createInMemoryEvents({ clock: d.clock, contradictions: false });
  const orgs = new OrgsService(ev.events, d.clock);
  const scoring = new ScoringService(ev.events);
  const reads = new ConsoleReadService(d.service, id.service, o.orders, l.caps, l.ledger, l.merchantCash, ev.events, orgs, scoring, d.clock);

  // Three couriers and a khat driver; a customer who never drives.
  const people: Record<string, string> = {};
  for (const [name, phone, kind] of [
    ['busy', '07712340001', 'courier'],
    ['broke', '07712340002', 'courier'],
    ['idle', '07712340003', 'courier'],
    ['khat', '07712340004', 'khat_driver'],
    ['cust', '07712340005', null],
  ] as const) {
    const { personId } = await id.login(phone);
    if (kind) await id.service.grantRole(SYSTEM, { personId, kind });
    people[name] = personId;
  }
  return { d, id, l, o, ev, orgs, reads, people };
}

type W = Awaited<ReturnType<typeof world>>;

async function onlineFleet(w: W) {
  await w.d.online(w.people['busy']!, 0.2, { vehicle: 'car', tier: 'silver' });
  await w.d.online(w.people['broke']!, 0.4, { vehicle: 'tuktuk' });
  await w.d.online(w.people['khat']!, 9, { vehicle: 'van' });
  // "broke" holds a big cash order: over the bronze courier cap (75,000).
  await w.l.posting.orderMoney(workedExample({ orderId: 'o_big', courierId: w.people['broke']!, itemsSubtotalIqd: 80_000 }));
  // "busy" accepts a taxi trip.
  await w.d.service.request({ tripId: 'trp_1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
  const offer = await w.d.openOffer('trp_1', w.people['busy']!);
  await w.d.service.respond(w.d.actor(w.people['busy']!), { offerId: offer!.id, accept: true });
}

describe('pinState / cashHeld', () => {
  it('over cap shows only when he would otherwise get offers', () => {
    expect(pinState('free', true)).toBe('over_cap');
    expect(pinState('offered', true)).toBe('over_cap');
    expect(pinState('on_job', true)).toBe('on_job');
    expect(pinState('offline_recent', true)).toBe('offline_recent');
    expect(pinState('free', false)).toBe('free');
    expect(cashHeld(-12_000)).toBe(12_000);
    expect(cashHeld(3_000)).toBe(0);
  });
});

describe('ConsoleReadService', () => {
  it('driverPositions: presence + board state + cash vs cap from the ledger', async () => {
    const w = await world();
    await onlineFleet(w);
    const res = await w.reads.driverPositions('aziziyah');
    const by = new Map(res.drivers.map((p) => [p.driverId, p]));
    expect(by.get(w.people['busy']!)).toMatchObject({ state: 'on_job', tripId: 'trp_1', vehicleClass: 'car', tier: 'silver', heading: null, overCap: false, cashHeldIqd: 0 });
    const broke = by.get(w.people['broke']!)!;
    expect(broke).toMatchObject({ state: 'over_cap', overCap: true, capIqd: 75_000, tripId: null });
    expect(broke.cashHeldIqd).toBeGreaterThan(80_000);
    expect(broke.owedIqd).toBeGreaterThanOrEqual(75_000);
    expect(by.get(w.people['khat']!)).toMatchObject({ state: 'free', vehicleClass: 'van' });
    expect(res.drivers).toHaveLength(3);
    expect(res.at).toEqual(w.d.clock.now());

    w.d.clock.advanceSeconds(61);
    const later = new Map((await w.reads.driverPositions('aziziyah')).drivers.map((p) => [p.driverId, p.state]));
    expect(later.get(w.people['khat']!)).toBe('offline_recent');
    expect(later.get(w.people['busy']!)).toBe('on_job');
  });

  it('driversList: roster joined with presence and scorecard tier; filters and pages', async () => {
    const w = await world();
    await onlineFleet(w);
    const list = (input: Parameters<typeof DriversListInput.parse>[0]) => w.reads.driversList(DriversListInput.parse(input));

    const all = await list({ cityId: 'aziziyah' });
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => r.personId).sort()).toEqual([w.people['busy'], w.people['broke'], w.people['idle'], w.people['khat']].sort());
    const idle = all.rows.find((r) => r.personId === w.people['idle'])!;
    expect(idle).toMatchObject({ online: false, state: null, vehicleClass: null, roles: ['courier'], tier: 'gold', scoreIndex: 100, observation: true });
    expect(all.rows.find((r) => r.personId === w.people['broke'])).toMatchObject({ online: true, state: 'over_cap', vehicleClass: 'tuktuk' });

    const online = await list({ cityId: 'aziziyah', filter: { presence: 'online' }, limit: 2 });
    expect(online.total).toBe(3);
    expect(online.rows).toHaveLength(2);
    const rest = await list({ cityId: 'aziziyah', filter: { presence: 'online' }, limit: 2, cursor: online.nextCursor! });
    expect([...online.rows, ...rest.rows].every((r) => r.online)).toBe(true);
    expect(rest.nextCursor).toBeNull();

    expect((await list({ cityId: 'aziziyah', filter: { presence: 'offline' } })).rows.map((r) => r.personId)).toEqual([w.people['idle']]);
    expect((await list({ cityId: 'aziziyah', filter: { role: 'khat_driver' } })).rows.map((r) => r.personId)).toEqual([w.people['khat']]);
  });

  it('searchOrders and the event logs come from orders and events; quarantined replays stay marked', async () => {
    const w = await world();
    const placed = await w.o.orders.place('c1', w.o.foodInput());
    const page = await w.reads.searchOrders(OrderSearchInput.parse({ cityId: 'aziziyah' }));
    expect(page.rows.map((r) => r.id)).toEqual([placed.id]);

    w.ev.events.useTripOrderLookup({ detachedAt: async () => new Date('2026-10-03T08:59:00Z') });
    await w.ev.events.emit(undefined, { type: 'stop.completed', actorId: 'd1', occurredAt: new Date('2026-10-03T08:59:30Z'), tripId: 'trp_9', orderId: 'ord_9', deviceUptimeMs: 1_000 }, { name: 'trip', id: 'trp_9' });
    const [e] = await w.reads.orderEvents('ord_9');
    expect(e).toMatchObject({ type: 'stop.completed', aggregate: 'trip', aggregateId: 'trp_9', quarantined: true, quarantineReason: 'late_replay', flagged: false });
    expect((await w.reads.tripEvents('trp_9')).map((x) => x.id)).toEqual([e!.id]);
    expect(await w.reads.orderEvents('unknown')).toEqual([]);
  });

  it('rightNow: orders, drivers, time-to-accept, cash in the field and outbox health', async () => {
    const w = await world();
    await w.o.orders.place('c1', w.o.foodInput());
    await w.o.orders.place('c2', w.o.foodInput());
    await onlineFleet(w);
    const now = await w.reads.rightNow('aziziyah');
    expect(now).toMatchObject({ cityId: 'aziziyah', ordersLastHour: 2, activeOrders: 2, lateOrders: 0, activeDrivers: 3, avgTimeToAcceptSec: 0 });
    expect(now.cashInFieldIqd).toBe((await w.l.ledger.cashInField()).totalIqd);
    expect(now.cashInFieldIqd).toBeGreaterThan(80_000);
    expect(now.outbox).toEqual({ pending: 0, failed: 0 });
  });

  it('outbox: stats plus the recent failed rows', async () => {
    const w = await world();
    await w.ev.events.emit(undefined, { type: 'x.happened', actorId: 'a', occurredAt: w.d.clock.now() }, { name: 'x', id: 'x1' });
    const [row] = await w.ev.repo.outbox();
    await w.ev.repo.updateOutbox(row!.id, { status: 'failed', attempts: 10, lastError: 'boom' });
    const view = await w.reads.outbox();
    expect(view).toMatchObject({ failed: 1, recentFailed: [{ id: row!.id, type: 'x.happened', lastError: 'boom', attempts: 10 }] });
  });

  it('merchants: the city’s merchant orgs with their live cash balance and settlement mode', async () => {
    const w = await world();
    const kebab = w.orgs.create({ type: 'restaurant', name: 'كباب', cityId: 'aziziyah', ownerId: 'p1' });
    await w.l.merchantCash.configure(kebab.id, { mode: 'daily_zaincash' });
    await w.l.posting.orderMoney(workedExample({ orderId: 'o1', merchantId: kebab.id }));
    const [m] = await w.reads.merchants('aziziyah');
    expect(m).toMatchObject({ merchantId: kebab.id, name: 'كباب', type: 'restaurant', mode: 'daily_zaincash', overExposure: false });
    expect(m!.balanceIqd).toBe((await w.l.merchantCash.balance(kebab.id)).balanceIqd);
    expect(m!.balanceIqd).toBeGreaterThan(0);
  });

  it('simulator controls answer {available:false} until the simulator is rebuilt', async () => {
    const w = await world();
    expect(await w.reads.simulatorStatus()).toEqual({ available: false });
    expect(await w.reads.simulatorStart({ cityId: 'aziziyah', drivers: 5, ordersPerHour: 10 })).toEqual({ available: false });
    expect(await w.reads.simulatorStop()).toEqual({ available: false });
  });
});
