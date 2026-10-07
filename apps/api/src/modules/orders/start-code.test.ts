import { describe, expect, it } from 'vitest';
import { DriverError, isGuessableStartCode, START_CODE_RULES } from '@driver/contracts';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';
import { newStartCode, startCodeForNewOrder } from './start-code.js';

const PICKUP = { zoneKey: 'centre', pin: KITCHEN };
const DROPOFF = { zoneKey: 'street_30', pin: HOME };
/** 22:30 and 12:00 in Baghdad (UTC+3). */
const NIGHT = '2026-10-03T19:30:00Z';
const DAY = '2026-10-03T09:00:00Z';

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

describe('newStartCode / startCodeForNewOrder', () => {
  it('pads to 4 digits and never hands out a guessable code', () => {
    const draws = [1111, 1234, 7];
    const got = newStartCode(() => draws.shift()!);
    expect(got).toBe('0007');
    expect(draws).toEqual([]);
  });
  it('a real draw is 4 digits and not guessable', () => {
    for (let i = 0; i < 200; i++) {
      const c = newStartCode();
      expect(c).toMatch(/^\d{4}$/);
      expect(isGuessableStartCode(c)).toBe(false);
    }
  });
  it('only rides picked up at night (21:00–05:59 Baghdad) get one', () => {
    expect(startCodeForNewOrder('ride', new Date(NIGHT), () => 4821)).toBe('4821');
    expect(startCodeForNewOrder('ride', new Date('2026-10-04T02:30:00Z'), () => 4821)).toBe('4821');
    expect(startCodeForNewOrder('ride', new Date(DAY), () => 4821)).toBeNull();
    expect(startCodeForNewOrder('food', new Date(NIGHT), () => 4821)).toBeNull();
  });
});

/** A taxi ride placed at `at`, accepted by d1 and arrived at the pickup. */
async function atPickup(at: string, opts: { scheduledFor?: Date } = {}) {
  const h = ordersHarness(at);
  const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: PICKUP, dropoff: DROPOFF, ...(opts.scheduledFor ? { scheduledFor: opts.scheduledFor } : { fareIqd: 3000 }) });
  const t = await h.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'taxi',
    orders: [{ orderId: o.id, minVehicleClass: null }],
    stops: [
      { orderId: o.id, type: 'pickup', zoneKey: PICKUP.zoneKey, target: KITCHEN },
      { orderId: o.id, type: 'dropoff', zoneKey: DROPOFF.zoneKey, target: HOME },
    ],
  });
  await h.trips.offer(t.id);
  await h.trips.accept(t.id, 'd1', { vehicleClass: 'car' });
  const stop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'pickup')!;
  await h.trips.arrive(t.id, stop.id, 'd1', { pin: KITCHEN });
  return { h, o, t, stop };
}

describe('«رمز المشوار»: a night ride starts only with the rider’s code (s1)', () => {
  it('a night ride stores a code on the order, never on the order the clients read', async () => {
    const { h, o } = await atPickup(NIGHT);
    const stored = await h.orders.startCodeOf(o.id);
    expect(stored).toMatch(/^\d{4}$/);
    expect(JSON.stringify(await h.orders.get(o.id))).not.toContain(`"${stored}"`);
    expect(await h.orders.get(o.id)).not.toHaveProperty('startCode');
  });

  it('a day ride has none and starts as before', async () => {
    const { h, o, t, stop } = await atPickup(DAY);
    expect(await h.orders.startCodeOf(o.id)).toBeNull();
    const after = await h.trips.completeStop(t.id, stop.id, 'd1');
    expect(after.stops.find((s) => s.id === stop.id)!.state).toBe('completed');
    expect(h.tripEvents.events.find((e) => e.type === 'stop.completed')!.payload).not.toHaveProperty('startCodeChecked');
  });

  it('a ride booked for the night gets one even when booked by day', async () => {
    const { h, o } = await atPickup(DAY, { scheduledFor: new Date('2026-10-03T20:00:00Z') });
    expect(await h.orders.startCodeOf(o.id)).toMatch(/^\d{4}$/);
  });

  it('no code is start_code_required, and nothing is counted', async () => {
    const { h, t, stop } = await atPickup(NIGHT);
    expect(await code(h.trips.completeStop(t.id, stop.id, 'd1'))).toBe('start_code_required');
    expect((await h.trips.get(t.id)).stops.find((s) => s.id === stop.id)!.state).toBe('arrived');
    expect(h.tripEvents.events.some((e) => e.type === 'stop.start_code_wrong')).toBe(false);
  });

  it('a wrong code is refused and counted (never the code itself on the event); the right one starts the ride', async () => {
    const { h, o, t, stop } = await atPickup(NIGHT);
    const right = (await h.orders.startCodeOf(o.id))!;
    const wrong = right === '0000' ? '0001' : '0000';
    expect(await code(h.trips.completeStop(t.id, stop.id, 'd1', { startCode: wrong }))).toBe('start_code_wrong');
    const ev = h.tripEvents.events.find((e) => e.type === 'stop.start_code_wrong')!;
    expect(ev.payload).toEqual({ stopId: stop.id, cityId: 'aziziyah', wrong: 1, alerted: false });
    expect(JSON.stringify(ev)).not.toContain(right);
    const after = await h.trips.completeStop(t.id, stop.id, 'd1', { startCode: right });
    expect(after.stops.find((s) => s.id === stop.id)!.state).toBe('completed');
    expect(h.tripEvents.events.find((e) => e.type === 'stop.completed')!.payload).toMatchObject({ startCodeChecked: true });
  });

  it(`${START_CODE_RULES.wrongAlertAt} wrong codes raise one alert for ops, listed while it is fresh`, async () => {
    const { h, o, t, stop } = await atPickup(NIGHT);
    const right = (await h.orders.startCodeOf(o.id))!;
    const wrong = right === '0000' ? '0001' : '0000';
    for (let i = 0; i < START_CODE_RULES.wrongAlertAt + 1; i++) await code(h.trips.completeStop(t.id, stop.id, 'd1', { startCode: wrong }));
    const wrongs = h.tripEvents.events.filter((e) => e.type === 'stop.start_code_wrong').map((e) => e.payload);
    expect(wrongs.map((p) => p['alerted'])).toEqual([false, false, false, false, true, false]);
    const alerts = await h.trips.startCodeAlerts('aziziyah', START_CODE_RULES.alertShowMin);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.stop).toMatchObject({ id: stop.id, startCodeWrong: 6 });
    expect(alerts[0]!.trip.id).toBe(t.id);
    expect(await h.trips.startCodeAlerts('kut', START_CODE_RULES.alertShowMin)).toEqual([]);
    h.clock.advance((START_CODE_RULES.alertShowMin + 1) * 60_000);
    expect(await h.trips.startCodeAlerts('aziziyah', START_CODE_RULES.alertShowMin)).toEqual([]);
  });

  it('another driver typing codes gets no hint: his tap is refused before any code check', async () => {
    const { h, t, stop } = await atPickup(NIGHT);
    expect(await code(h.trips.completeStop(t.id, stop.id, 'd2', { startCode: '0000' }))).not.toBe('start_code_wrong');
    expect(h.tripEvents.events.some((e) => e.type === 'stop.start_code_wrong')).toBe(false);
  });

  it('the drop-off never asks for the code', async () => {
    const { h, o, t, stop } = await atPickup(NIGHT);
    await h.trips.completeStop(t.id, stop.id, 'd1', { startCode: (await h.orders.startCodeOf(o.id))! });
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    const after = await h.trips.completeStop(t.id, drop.id, 'd1');
    expect(after.stops.find((s) => s.id === drop.id)!.state).toBe('completed');
  });
});
