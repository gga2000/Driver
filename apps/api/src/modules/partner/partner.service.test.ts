import { describe, expect, it } from 'vitest';
import { isDriverError, type Order, type PartnerOnlineGate, type RoleKind, type Stop, type Trip } from '@driver/contracts';
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

function harness(opts: { roles?: RoleKind[]; online?: boolean; trips?: Trip[]; offerTrip?: Trip | null; cap?: Partial<PartnerCapStatus>; gate?: PartnerOnlineGate } = {}) {
  let presence: PartnerPresence | null = opts.online ? { cityId: 'aziziyah', lat: 32.905, lng: 45.06, vehicle: 'bike', tier: 'silver', zoneId: 'centre' } : null;
  const offerTrip = opts.offerTrip ?? null;
  const deps: PartnerDeps = {
    presence: {
      get: async () => presence,
      online: async (_id, input) => {
        presence = { cityId: input.cityId, lat: input.at.lat, lng: input.at.lng, vehicle: input.vehicle, tier: input.tier, zoneId: 'street_30' };
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
    },
    orders: { get: async (id) => (id === 'o2' ? order({ id: 'o2', paymentMethod: 'wallet' }) : order()) },
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
    vehicles: { vehicleOf: async () => 'bike' },
    gate: { onlineGate: async () => opts.gate ?? OPEN },
  };
  return new PartnerService(deps, new FakeClock(NOW));
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
    expect((await svc.goOffline(actor)).online).toBe(false);
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

  it('a heartbeat across local midnight keeps an online driver on until he next goes online', async () => {
    const on = await harness({ online: true, gate: NO_CHECKIN }).goOnline(actor, { cityId: 'aziziyah', at: KITCHEN });
    expect(on.online).toBe(true);
  });

  it('a lock-out or an expired document refuses the heartbeat and takes him offline', async () => {
    for (const gate of [LOCKED, EXPIRED]) {
      const svc = harness({ online: true, gate });
      await expect(svc.goOnline(actor, { cityId: 'aziziyah', at: KITCHEN })).rejects.toMatchObject({ code: gate === LOCKED ? 'checkin_locked' : 'online_document_expired' });
      expect((await svc.status(actor)).online).toBe(false);
    }
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

  it('activeJob is null when he has no trip', async () => {
    expect(await harness().activeJob(actor)).toBeNull();
  });
});
