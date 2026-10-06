import { describe, expect, it } from 'vitest';
import { isDriverError, type Order, type PartnerOnlineGate, type RoleKind, type Stop, type Trip, type VehicleClass, type Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PartnerService } from './partner.service.js';
import type { PartnerCapStatus, PartnerDeps, PartnerPresence } from './ports.js';

const NOW = new Date('2026-10-03T10:00:00Z');
const actor = { personId: 'drv1', sessionId: 's1' };
const KITCHEN = { lat: 32.9095, lng: 45.0635 };
const HOME = { lat: 32.887, lng: 45.0765 };

function stop(id: string, seq: number, type: Stop['type'], zoneKey: string, target: { lat: number; lng: number }, state: Stop['state'] = 'pending', orderId = 'o1'): Stop {
  return {
    id,
    tripId: 't1',
    seq,
    orderId,
    type,
    state,
    placeId: null,
    meetingPointId: null,
    zoneKey,
    target,
    windowStart: null,
    windowEnd: null,
    geofenceEnteredAt: null,
    courierNearAt: null,
    arrivedAt: null,
    arrivedOutsideGeofence: false,
    arrivalDistanceM: null,
    completedAt: state === 'completed' ? NOW : null,
    skippedAt: null,
    skipReason: null,
    handoverProof: {},
    childRef: null,
    childTapInAt: null,
    childTapOutAt: null,
  };
}

function trip(id: string, stops: Stop[], extra: Partial<Trip> = {}): Trip {
  return {
    id,
    cityId: 'aziziyah',
    vertical: 'food',
    state: 'accepted',
    courierId: 'drv1',
    vehicleId: null,
    quoteId: null,
    batchId: null,
    offeredAt: NOW,
    acceptedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    unreachable: null,
    stops,
    orders: [{ orderId: 'o1', attachedAt: NOW, detachedAt: null, reason: null, minVehicleClass: null }],
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const order = (extra: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    cityId: 'aziziyah',
    type: 'food',
    state: 'preparing',
    ordererId: 'cust1',
    merchantOrgId: 'm1',
    paymentMethod: 'cash',
    itemsTotalIqd: 14_000,
    deliveryFeeIqd: 1_000,
    serviceFeeIqd: 500,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 15_500,
    promisedReadyAt: new Date(NOW.getTime() + 8 * 60_000),
    readyAt: null,
    pickedUpAt: null,
    placedAt: NOW,
    note: 'باب أخضر يم الجامع',
    ...extra,
  }) as Order;

const OPEN: PartnerOnlineGate = { canGoOnline: true, reasons: [] };
const NO_CHECKIN: PartnerOnlineGate = { canGoOnline: false, reasons: [{ code: 'checkin_required', message_ar: 'سوّي التحقق اليومي بالسيلفي قبل ما تشتغل' }] };
const LOCKED: PartnerOnlineGate = { canGoOnline: false, reasons: [{ code: 'checkin_locked', message_ar: 'فشل التحقق مرتين اليوم' }] };
const EXPIRED: PartnerOnlineGate = {
  canGoOnline: false,
  reasons: [
    { code: 'checkin_required', message_ar: 'سوّي التحقق اليومي' },
    { code: 'document_expired', message_ar: 'إجازة السوق منتهية. جدّدها حتى تشتغل' },
  ],
};

function harness(
  opts: {
    roles?: RoleKind[];
    online?: boolean;
    trips?: Trip[];
    offerTrip?: Trip | null;
    cap?: Partial<PartnerCapStatus>;
    gate?: PartnerOnlineGate;
    now?: Date;
    registered?: VehicleClass | null;
    onOnline?: (input: { vehicle: VehicleClass; verticals?: readonly Vertical[] | undefined }) => void;
    roads?: Array<readonly { lat: number; lng: number }[]>;
    lastFix?: { lat: number; lng: number } | null;
    rideOrder?: boolean;
    places?: PartnerDeps['places'];
  } = {},
) {
  let presence: PartnerPresence | null = opts.online ? { cityId: 'aziziyah', lat: 32.905, lng: 45.06, vehicle: 'bike', tier: 'silver', zoneId: 'centre' } : null;
  const offerTrip = opts.offerTrip ?? null;
  const deps: PartnerDeps = {
    presence: {
      get: async () => presence,
      online: async (_id, input) => {
        opts.onOnline?.(input);
        presence = { cityId: input.cityId, lat: input.at.lat, lng: input.at.lng, vehicle: input.vehicle, tier: input.tier, zoneId: 'street_30', onlineSince: presence?.onlineSince ?? NOW.getTime() - 3 * 3_600_000 };
        return presence;
      },
      offline: async () => {
        presence = null;
      },
      zones: async () => ['centre', 'zakur'],
    },
    dispatch: {
      openOffer: async () =>
        offerTrip
          ? {
              offer: { id: 'do_1', tripId: offerTrip.id, wave: 1, state: 'sent', distanceKm: 0.8, compensationIqd: 0, sentAt: NOW, seenAt: null, expiresAt: new Date(NOW.getTime() + 15_000) },
              request: { tripId: offerTrip.id, vertical: 'food', zoneId: 'street_30', dropoffZoneId: 'zakur', pickup: KITCHEN },
            }
          : null,
      waitingZones: async () => ['centre', 'centre', 'centre'],
    },
    trips: {
      forDriver: async () => opts.trips ?? [],
      get: async (id) => [...(opts.trips ?? []), ...(offerTrip ? [offerTrip] : [])].find((t) => t.id === id)!,
      lastPosition: async () => (opts.lastFix ? { pin: opts.lastFix, driverId: actor.personId } : null),
    },
    ...(opts.roads
      ? {
          roads: {
            path: async (points: readonly { lat: number; lng: number }[]) => {
              opts.roads!.push(points);
              return { polyline6: 'road6', basis: 'road' as const };
            },
          },
        }
      : {}),
    orders: { get: async (id) => (opts.rideOrder ? order({ type: 'ride', merchantOrgId: null }) : id === 'o2' ? order({ id: 'o2', paymentMethod: 'wallet' }) : order()) },
    merchants: { name: (id) => (id === 'm1' ? 'مطعم خالد' : null) },
    quotes: { quote: () => null },
    money: {
      cap: async () => ({ tier: 'silver', owedIqd: 128_000, capIqd: 150_000, capRemainingIqd: 22_000, overCap: false, cashIqd: -131_000, ...opts.cap }),
      driverLines: async () => [
        { type: 'delivery_fee', amountIqd: 1_000, orderId: 'a' },
        { type: 'delivery_fee', amountIqd: 1_500, orderId: 'b' },
      ],
      batchShare: 0.7,
      take: () => null,
    },
    roles: { activeRoles: async () => opts.roles ?? ['customer', 'courier'] },
    vehicles: { vehicleOf: async () => (opts.registered === undefined ? 'bike' : opts.registered) },
    gate: { onlineGate: async () => opts.gate ?? OPEN },
    ...(opts.places ? { places: opts.places } : {}),
  };
  return new PartnerService(deps, new FakeClock(opts.now ?? NOW));
}

describe('PartnerService', () => {
  it('status offline: modes from roles, cash vs cap with the near-cap warning, today, demand', async () => {
    const s = await harness().status(actor);
    expect(s).toMatchObject({
      modes: ['courier'],
      primaryMode: 'courier',
      canDrive: true,
      online: false,
      vehicleClass: 'bike',
      tier: 'silver',
      cash: { heldIqd: 131_000, owedIqd: 128_000, capIqd: 150_000, remainingIqd: 22_000, overCap: false, nearCap: true },
      today: { earningsIqd: 2_500, jobs: 2 },
      demand: { level: 'high', zoneId: 'centre', waitingJobs: 3 },
      activeTripId: null,
      offerId: null,
      gate: { canGoOnline: true, reasons: [] },
    });
  });

  it('fleet owners and field ops get a status without driving', async () => {
    const s = await harness({ roles: ['fleet_owner', 'field_ops'] }).status(actor);
    expect(s).toMatchObject({ modes: ['fleet', 'ops'], primaryMode: 'fleet', canDrive: false, demand: null, gate: null });
  });

  it('status carries the online gate with its reasons (the home banner and the blocked switch)', async () => {
    const s = await harness({ gate: NO_CHECKIN }).status(actor);
    expect(s.gate).toEqual(NO_CHECKIN);
  });

  it('goOnline puts him in the presence index with his vehicle; goOffline takes him out', async () => {
    const svc = harness();
    const on = await svc.goOnline(actor, { cityId: 'aziziyah', at: { lat: 32.9095, lng: 45.0635 } });
    expect(on).toMatchObject({ online: true, zoneId: 'street_30', vehicleClass: 'bike', position: { lat: 32.9095, lng: 45.0635 } });
    // The shift's start (end-of-shift summary, S-4) comes from presence; offline has none.
    expect(on.onlineSince?.getTime()).toBe(NOW.getTime() - 3 * 3_600_000);
    const off = await svc.goOffline(actor);
    expect(off.online).toBe(false);
    expect(off.onlineSince).toBeNull();
  });

  it.each([
    ['no check-in today', NO_CHECKIN, 'online_checkin_required'],
    ['locked out after two failed check-ins', LOCKED, 'checkin_locked'],
    ['an expired document (worse than the missing check-in)', EXPIRED, 'online_document_expired'],
  ] as const)('goOnline is refused with a typed code and Arabic message: %s', async (_name, gate, code) => {
    const svc = harness({ gate });
    const err = await svc.goOnline(actor, { cityId: 'aziziyah', at: KITCHEN }).catch((e: unknown) => e);
    expect(isDriverError(err)).toBe(true);
    expect(err).toMatchObject({ code, status: 'FORBIDDEN' });
    expect((err as { envelope: { message_ar: string } }).envelope.message_ar.length).toBeGreaterThan(5);
    expect((await svc.status(actor)).online).toBe(false);
  });

  it('a heartbeat across local midnight keeps an online driver on for the night (until 04:00 local)', async () => {
    // 00:30 Baghdad: yesterday's check-in still carries his shift.
    const on = await harness({ online: true, gate: NO_CHECKIN, now: new Date('2026-10-02T21:30:00Z') }).goOnline(actor, { cityId: 'aziziyah', at: KITCHEN });
    expect(on.online).toBe(true);
  });

  it('heartbeating never skips the daily check-in past the night grace (review 2026-10-04 #5)', async () => {
    // 13:00 Baghdad, still online since yesterday, never checked in today: refused and taken offline.
    const svc = harness({ online: true, gate: NO_CHECKIN });
    await expect(svc.goOnline(actor, { cityId: 'aziziyah', at: KITCHEN })).rejects.toMatchObject({ code: 'online_checkin_required' });
    expect((await svc.status(actor)).online).toBe(false);
  });

  it('a lock-out or an expired document refuses the heartbeat and takes him offline', async () => {
    for (const gate of [LOCKED, EXPIRED]) {
      const svc = harness({ online: true, gate });
      await expect(svc.goOnline(actor, { cityId: 'aziziyah', at: KITCHEN })).rejects.toMatchObject({ code: gate === LOCKED ? 'checkin_locked' : 'online_document_expired' });
      expect((await svc.status(actor)).online).toBe(false);
    }
  });

  it('offerRoute (maps program d2): his position to the kitchen only; a ride (a person’s door) gets none', async () => {
    const t = trip('t1', [stop('s1', 0, 'pickup', 'street_30', KITCHEN), stop('s2', 1, 'dropoff', 'zakur', HOME)], { state: 'offered', courierId: null });
    const roads: Array<readonly { lat: number; lng: number }[]> = [];
    const r = await harness({ online: true, offerTrip: t, roads }).offerRoute(actor, { offerId: 'do_1' });
    expect(r).toMatchObject({ polyline6: 'road6', basis: 'road', from: { lat: 32.905, lng: 45.06 } });
    expect(roads).toEqual([[{ lat: 32.905, lng: 45.06 }, KITCHEN]]);
    expect(await harness({ online: true, offerTrip: t, roads: [] }).offerRoute(actor, { offerId: 'other' })).toMatchObject({ polyline6: null });
    expect(await harness({ online: true, offerTrip: t, roads: [], rideOrder: true }).offerRoute(actor, { offerId: 'do_1' })).toMatchObject({ polyline6: null });
  });

  it('jobRoute (maps program d2): from his last fix through the stops still to do, in order', async () => {
    const t = trip('t1', [stop('s1', 0, 'pickup', 'street_30', KITCHEN, 'completed'), stop('s2', 1, 'dropoff', 'zakur', HOME)], { state: 'in_transit' });
    const roads: Array<readonly { lat: number; lng: number }[]> = [];
    const fix = { lat: 32.9, lng: 45.07 };
    const r = await harness({ trips: [t], roads, lastFix: fix }).jobRoute(actor);
    expect(r).toMatchObject({ polyline6: 'road6', from: fix });
    expect(roads).toEqual([[fix, HOME]]);
    expect(await harness({ trips: [], roads: [] }).jobRoute(actor)).toMatchObject({ polyline6: null });
  });

  it('demandMap (maps program d5): waiting now, the usual pickups this hour, drivers there', async () => {
    const m = await harness().demandMap(actor);
    // The harness: three jobs waiting in the centre, drivers in the centre and zakur, no history.
    expect(m.zones).toEqual([
      { zoneId: 'centre', waiting: 3, expected: 0, drivers: 1, level: 'hot' },
      { zoneId: 'zakur', waiting: 0, expected: 0, drivers: 1, level: 'calm' },
    ]);
  });

  it('currentOffer: zones, merchant prep, cash to collect, ring, named pay', async () => {
    const t = trip('t1', [stop('s1', 0, 'pickup', 'street_30', KITCHEN), stop('s2', 1, 'dropoff', 'zakur', HOME)], { state: 'offered', courierId: null });
    const offer = await harness({ online: true, offerTrip: t }).currentOffer(actor);
    expect(offer).toMatchObject({
      offerId: 'do_1',
      tripId: 't1',
      ringSec: 15,
      pickup: { zoneId: 'street_30', label: 'مطعم خالد' },
      dropoff: { zoneId: 'zakur', label: null },
      distanceToPickupKm: 0.8,
      pay: { totalIqd: 1_000, components: [{ key: 'delivery', amountIqd: 1_000 }] },
      batch: null,
      merchant: { name: 'مطعم خالد', state: 'preparing', readyInMin: 8 },
      collectIqd: 15_500,
    });
    expect(offer!.tripKm).toBeGreaterThan(2);
  });

  it("an offer names zones, never the customer's exact door (review 2026-10-04 #13)", async () => {
    const t = trip('t1', [stop('s1', 0, 'pickup', 'street_30', KITCHEN), stop('s2', 1, 'dropoff', 'zakur', HOME)], { state: 'offered', courierId: null });
    const offer = (await harness({ online: true, offerTrip: t }).currentOffer(actor))!;
    // Every driver in every wave sees the offer; only the one who accepts gets the door (activeJob).
    expect(offer.dropoff.pin).toBeNull();
    expect(JSON.stringify(offer)).not.toContain(String(HOME.lat));
    expect(offer.pickup.pin).toEqual(KITCHEN); // a merchant's kitchen is public
    expect(offer.tripKm).toBeGreaterThan(2); // the distance is still computed server-side
  });

  it('currentOffer while on a job is a batch: 70 % as the batch bonus', async () => {
    const current = trip('t0', [stop('a', 0, 'pickup', 'street_30', KITCHEN)]);
    const t = trip('t1', [stop('s1', 0, 'pickup', 'street_30', KITCHEN), stop('s2', 1, 'dropoff', 'zakur', HOME)], { state: 'offered' });
    const offer = await harness({ online: true, trips: [current], offerTrip: t }).currentOffer(actor);
    expect(offer).toMatchObject({ batch: { extraIqd: 700, withTripIds: ['t0'] }, pay: { totalIqd: 700, components: [{ key: 'batch_bonus', amountIqd: 700 }] } });
  });

  it('currentOffer is null without an open offer', async () => {
    expect(await harness({ online: true }).currentOffer(actor)).toBeNull();
  });

  it('activeJob: stops in order, the current task, cash at the door, kitchen state', async () => {
    const t = trip('t1', [stop('s2', 1, 'dropoff', 'zakur', HOME), stop('s1', 0, 'pickup', 'street_30', KITCHEN, 'completed')]);
    const job = await harness({ trips: [t] }).activeJob(actor);
    expect(job).toMatchObject({
      tripId: 't1',
      currentStopId: 's2',
      pay: { totalIqd: 1_000 },
      merchant: { name: 'مطعم خالد' },
    });
    expect(job!.stops.map((s) => [s.stopId, s.label, s.collectIqd, s.note])).toEqual([
      ['s1', 'مطعم خالد', 0, null],
      ['s2', null, 15_500, 'باب أخضر يم الجامع'],
    ]);
  });

  it('activeJob: a drop-off at a saved place shows its door and whether he was ever there (maps f6, a5)', async () => {
    const asked: Array<{ placeId: string; courierId: string }> = [];
    const visits = new Map([['pl_home', 0]]);
    const places: NonNullable<PartnerDeps['places']> = {
      courierDoor: async (placeId, input) => {
        asked.push({ placeId, courierId: input.courierId });
        return { placeNote: 'الباب الأسود', photos: [{ id: 'up1', url: 'https://cdn/up1?sig=x' }], doorConfirmed: false, entranceSet: false };
      },
      dropoffsAt: async (placeId) => visits.get(placeId) ?? 0,
    };
    const t = trip('t1', [{ ...stop('s2', 1, 'dropoff', 'zakur', HOME), placeId: 'pl_home' }, stop('s1', 0, 'pickup', 'street_30', KITCHEN)]);
    const first = await harness({ trips: [t], places }).activeJob(actor);
    expect(first!.stops.find((s) => s.stopId === 's2')!.door).toEqual({ placeNote: 'الباب الأسود', photos: [{ id: 'up1', url: 'https://cdn/up1?sig=x' }], doorConfirmed: false, entranceSet: false, firstVisit: true });
    // Pickups and drop-offs without a saved place have no door.
    expect(first!.stops.find((s) => s.stopId === 's1')!.door).toBeNull();
    expect(asked).toEqual([{ placeId: 'pl_home', courierId: actor.personId }]);
    visits.set('pl_home', 2);
    const again = await harness({ trips: [t], places }).activeJob(actor);
    expect(again!.stops.find((s) => s.stopId === 's2')!.door!.firstVisit).toBe(false);
  });

  it('activeJob is null when he has no trip', async () => {
    expect(await harness().activeJob(actor)).toBeNull();
  });
});

describe('goOnline uses the registered vehicle and the roles (backend review 2026-10-04 #20)', () => {
  const at = { lat: 32.9095, lng: 45.0635 };
  type Sent = { vehicle: VehicleClass; verticals?: readonly Vertical[] | undefined };

  it('a courier cannot claim a car he has not registered; without a claim he is online on his own vehicle', async () => {
    const sent: Sent[] = [];
    const svc = harness({ roles: ['customer', 'courier'], registered: 'bike', onOnline: (i) => sent.push(i) });
    const err = await svc.goOnline(actor, { cityId: 'aziziyah', at, vehicleClass: 'car' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'vehicle_not_registered' });
    expect((err as { envelope: { message_ar: string } }).envelope.message_ar.length).toBeGreaterThan(10);
    expect(sent).toHaveLength(0);
    const on = await svc.goOnline(actor, { cityId: 'aziziyah', at });
    expect(on.vehicleClass).toBe('bike');
    expect(sent[0]).toEqual(expect.objectContaining({ vehicle: 'bike', verticals: ['food', 'grocery', 'errand', 'parcel'] }));
  });

  it('a courier with nothing registered rides a bike (he cannot claim more)', async () => {
    const sent: Sent[] = [];
    const svc = harness({ roles: ['courier'], registered: null, onOnline: (i) => sent.push(i) });
    await expect(svc.goOnline(actor, { cityId: 'aziziyah', at, vehicleClass: 'tuktuk' })).rejects.toMatchObject({ code: 'vehicle_not_registered' });
    await svc.goOnline(actor, { cityId: 'aziziyah', at, vehicleClass: 'bike' });
    expect(sent[0]).toEqual(expect.objectContaining({ vehicle: 'bike' }));
  });

  it('a driver serves the rides of his registered vehicle: tuktuk → tuktuk rides, car → taxi', async () => {
    const got: Array<readonly Vertical[] | undefined> = [];
    await harness({ roles: ['driver'], registered: 'tuktuk', onOnline: (i) => got.push(i.verticals) }).goOnline(actor, { cityId: 'aziziyah', at, vehicleClass: 'tuktuk' });
    await harness({ roles: ['driver'], registered: 'car', onOnline: (i) => got.push(i.verticals) }).goOnline(actor, { cityId: 'aziziyah', at });
    expect(got).toEqual([['tuktuk'], ['taxi']]);
  });

  it('a driver without a registered car or tuktuk has nothing to serve and stays offline', async () => {
    const svc = harness({ roles: ['driver'], registered: null });
    await expect(svc.goOnline(actor, { cityId: 'aziziyah', at })).rejects.toMatchObject({ code: 'vehicle_not_registered' });
    expect((await svc.status(actor)).online).toBe(false);
  });
});
