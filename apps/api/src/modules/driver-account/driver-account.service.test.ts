import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, type Actor, type MoneyRules, type Order, type RoleKind, type Trip } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { EventsShiftActivity } from '../ledger/index.js';
import { postDriverIncentive } from '../ledger/postings.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import type { OrdersService } from '../orders/index.js';
import { ConfigService } from '../config/index.js';
import type { AuditLogService, StaffNames } from '../controls/index.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import { InMemorySupportRepository, SupportService } from '../support/index.js';
import type { TripsService } from '../trips/index.js';
import { InMemoryDriverAccountRepository } from './driver-account.repository.js';
import { DriverAccountService } from './driver-account.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const DAY = 86_400_000;
const UNFINISHED: readonly string[] = ['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff'];

/** Stores a tiny JPEG through the dev blob store's signed PUT, as the app would. */
async function storedUpload(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

/** DriverAccountService on in-memory identity, ledger, events and blob store; trips and orders scripted. */
function setup(start = '2026-10-03T09:00:00Z', rules: MoneyRules = AZIZIYAH_MONEY_RULES) {
  const id = identityHarness(start);
  const clock = id.clock;
  const ev = createInMemoryEvents({ clock });
  // G-91: the guarantee reads his trip events from the same log the service writes to.
  const ledger = ledgerHarness({ start, clock, rules, activity: new EventsShiftActivity(ev.events) });
  const blobs = new DevBlobStore(clock, { secret: 'test-blob-secret' });
  const repo = new InMemoryDriverAccountRepository();
  const trips: Trip[] = [];
  const orders = new Map<string, Order>();
  // Same reads as TripsService: `forDriver` lists only unfinished trips, the finished ones come from
  // `completedForDriver` / `endedForDriver` (the scorecard once read `forDriver` and saw none).
  const after = (at: Date | null, since: Date) => at !== null && at.getTime() >= since.getTime();
  const tripsFake = {
    forDriver: async (driverId: string) => trips.filter((t) => t.courierId === driverId && UNFINISHED.includes(t.state)),
    completedForDriver: async (driverId: string, since: Date) => trips.filter((t) => t.courierId === driverId && t.state === 'completed' && after(t.completedAt, since)),
    endedForDriver: async (driverId: string, since: Date) =>
      trips.filter((t) => t.courierId === driverId && ((t.state === 'completed' && after(t.completedAt, since)) || (t.state === 'driver_cancelled' && after(t.cancelledAt, since)))),
  } as unknown as TripsService;
  /** Orders placed per Baghdad hour on the day `placedPerHour` is asked about (tomorrow's busy window). */
  const hourly: { counts: number[]; asked: Array<{ from: Date; to: Date }> } = { counts: new Array<number>(24).fill(0), asked: [] };
  const ordersFake = {
    get: async (orderId: string) => {
      const o = orders.get(orderId);
      if (!o) throw new Error('order not found');
      return o;
    },
    placedPerHour: async (_city: string, from: Date, to: Date) => {
      hourly.asked.push({ from, to });
      return hourly.counts;
    },
  } as unknown as OrdersService;
  // The support desk on the same in-memory events and unit of work (only the ticket-opening path is used).
  const supportRepo = new InMemorySupportRepository();
  const audits: Array<{ action: string; subjectId: string }> = [];
  const auditsFake = { record: async (a: { action: string; subjectId: string }) => void audits.push(a) } as unknown as AuditLogService;
  const none = {} as never;
  const support = new SupportService(supportRepo, ordersFake, tripsFake, none, none, none, none, id.service, ev.events, auditsFake, { of: async () => ({}) } as unknown as StaffNames, ev.uow, clock);
  const service = new DriverAccountService(repo, ledger.facade, ev.events, tripsFake, ordersFake, id.service, blobs, ev.uow, clock, 'handover-test-secret', support, new ConfigService());
  async function person(phone: string, roles: RoleKind[] = []): Promise<Actor> {
    const { actor } = await id.login(phone);
    for (const kind of roles) await id.service.grantRole({ personId: 'admin' }, { personId: actor.personId, kind });
    return actor;
  }
  return { id, clock, ledger, ev, blobs, repo, trips, orders, service, person, hourly, supportRepo, support, audits, upload: (ownerId: string) => storedUpload(blobs, ownerId) };
}

describe('driverAccount.reviewDocument separation of duties (review 2026-10-04 #7)', () => {
  it('a field-ops person who also drives cannot approve his own document', async () => {
    const h = setup();
    const both = await h.person('07700000011', ['driver', 'field_ops']);
    const doc = await h.service.uploadDocument(both, { kind: 'licence', uploadId: await h.upload(both.personId) });
    await expect(h.service.reviewDocument(both, { documentId: doc.id, decision: 'approve', expiresAt: new Date(h.clock.now().getTime() + 400 * DAY) })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.repo.documents.get(doc.id)?.status).toBe('pending');
    const other = await h.person('07700000012', ['field_ops']);
    await expect(h.service.reviewDocument(other, { documentId: doc.id, decision: 'approve' })).resolves.toMatchObject({ status: 'approved' });
  });
});

describe('driverAccount.earnings', () => {
  it('names every pay component per job, totals them and shows cash and the cap bar', async () => {
    const h = setup('2026-10-03T13:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    // Food order (cash, delivery 1,000 + tip 1,000) and a car ride (5,000, 12 % take) on the same day.
    await h.ledger.posting.orderMoney(workedExample({ orderId: 'o1', courierId: d.personId, tipIqd: 1000 }));
    await h.ledger.posting.rideMoney({ tripId: 't_ride', occurredAt: new Date('2026-10-03T12:30:00Z'), customerId: 'c2', payment: 'cash', driverId: d.personId, takeClass: 'car', fareIqd: 5000 });
    await h.ledger.ledger.recordAll(postDriverIncentive({ key: 'g1', driverId: d.personId, amountIqd: 2000, reason: 'guarantee:2026-10-03:day', occurredAt: new Date('2026-10-03T12:45:00Z') })!);

    const e = await h.service.earnings(d, { period: 'day' });
    expect(e.period).toBe('day');
    expect(e.from.toISOString()).toBe('2026-10-02T21:00:00.000Z'); // Baghdad midnight
    expect(e.totals.grossIqd).toBe(1000 + 5000);
    expect(e.totals.takeIqd).toBe(600);
    expect(e.totals.tipsIqd).toBe(1000);
    expect(e.totals.guaranteeTopUpsIqd).toBe(2000);
    expect(e.totals.netIqd).toBe(1000 + 5000 - 600 + 1000 + 2000);
    expect(e.totals.jobs).toBe(2);
    const food = e.jobs.find((j) => j.orderId === 'o1')!;
    expect(food.components.map((c) => c.type).sort()).toEqual(['delivery_fee', 'tip']);
    expect(food.components.every((c) => c.label_ar.length > 0)).toBe(true);
    expect(food.cashCollectedIqd).toBeGreaterThan(0);
    const ride = e.jobs.find((j) => j.tripId === 't_ride')!;
    expect(ride.components.find((c) => c.type === 'commission_accrued')?.amountIqd).toBe(-600);
    expect(e.cash.collectedIqd).toBe(food.cashCollectedIqd + ride.cashCollectedIqd);
    expect(e.cap).toMatchObject({ role: 'courier', tier: 'bronze', capIqd: 75000, byTier: { bronze: 75000, silver: 150000, gold: 300000 } });
    expect(e.cap.fill).toBeCloseTo(e.cap.owedIqd / 75000);

    // Yesterday is empty; the week (Sunday start) holds today's jobs.
    expect((await h.service.earnings(d, { period: 'day', anchor: new Date('2026-10-02T12:00:00Z') })).jobs).toEqual([]);
    expect((await h.service.earnings(d, { period: 'week' })).totals.jobs).toBe(2);
  });

  it("refuses another driver's book unless the caller is back office", async () => {
    const h = setup();
    const a = await h.person('07700000001', ['courier']);
    const b = await h.person('07700000002', ['courier']);
    const finance = await h.person('07700000003', ['finance']);
    await expect(h.service.earnings(a, { period: 'day', driverId: b.personId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.service.earnings(finance, { period: 'day', driverId: b.personId })).resolves.toMatchObject({ driverId: b.personId });
  });
});

describe('driverAccount.scorecard', () => {
  it('stays hidden from the driver during the 30-day observation, with a learning message', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    await h.ev.events.emit(undefined, { actorId: d.personId, type: 'trip.declined', occurredAt: h.clock.now() }, { name: 'trip', id: 't1' });
    const card = await h.service.scorecard(d, {});
    expect(card.dayNumber).toBe(1);
    expect(card.visible).toBe(false);
    expect(card.metrics).toEqual([]);
    expect(card.index).toBeNull();
    expect(card.nudges).toEqual([]);
    expect(card.consequencesFrom).toBeNull();
    expect(card.learningMessage_ar).toContain('30');
    expect(card.visibleFrom.getTime() - h.clock.now().getTime()).toBe(30 * DAY);
    // Back office sees the numbers during observation.
    const admin = await h.person('07700000009', ['admin']);
    expect((await h.service.scorecard(admin, { driverId: d.personId })).metrics.length).toBe(5);
  });

  it('from day 31: metrics, nudges under the Silver line and consequences the following Sunday', async () => {
    const h = setup('2026-10-03T09:00:00Z'); // a Saturday
    const d = await h.person('07700000001', ['courier']);
    const at = (daysAgo: number) => new Date(h.clock.now().getTime() - daysAgo * DAY);
    await h.ev.events.emit(undefined, { actorId: d.personId, type: 'role.used', occurredAt: at(40) }, { name: 'person', id: d.personId });
    // 2 accepted, 3 declined in the last week → 40 % acceptance (below the Silver line).
    for (const [i, type] of ['trip.accepted', 'trip.accepted', 'trip.declined', 'trip.declined', 'trip.declined'].entries()) {
      await h.ev.events.emit(undefined, { actorId: d.personId, type, occurredAt: at(1 + i * 0.1) }, { name: 'trip', id: `t${i}` });
    }
    const card = await h.service.scorecard(d, {});
    expect(card.dayNumber).toBe(41);
    expect(card.visible).toBe(true);
    const acceptance = card.metrics.find((m) => m.key === 'acceptance')!;
    expect(acceptance.value).toBeCloseTo(0.4);
    expect(acceptance.belowSilver).toBe(true);
    expect(card.nudges.map((n) => n.key)).toEqual(['acceptance']);
    expect(card.nudges[0]!.message_ar).toContain('40%');
    expect(card.consequencesFrom?.toISOString()).toBe('2026-10-03T21:00:00.000Z'); // Sunday 00:00 Baghdad
    expect(card.index).not.toBeNull();
  });

  it('reads delivery ratings from the orders on his completed trips', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    await h.ev.events.emit(undefined, { actorId: d.personId, type: 'trip.accepted', occurredAt: new Date(h.clock.now().getTime() - 40 * DAY) }, { name: 'trip', id: 't0' });
    h.trips.push({ id: 't1', courierId: d.personId, state: 'completed', acceptedAt: h.clock.now(), completedAt: h.clock.now(), stops: [], orders: [{ orderId: 'o1', attachedAt: h.clock.now(), detachedAt: null, reason: null, minVehicleClass: null }] } as unknown as Trip);
    h.orders.set('o1', { id: 'o1', rating: { delivery: 4, food: 5, tags: [], note: null, ratedAt: h.clock.now() } } as unknown as Order);
    const rating = (await h.service.scorecard(d, {})).metrics.find((m) => m.key === 'rating')!;
    expect(rating.value).toBe(4);
    expect(rating.display).toBe('4.0');
    expect(rating.belowSilver).toBe(true);
  });

  it('counts his finished trips of the 14 days (not just the unfinished ones): completed trips, on-time stops, cancellations and ratings', async () => {
    const h = setup('2026-10-03T09:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    const at = (daysAgo: number) => new Date(h.clock.now().getTime() - daysAgo * DAY);
    await h.ev.events.emit(undefined, { actorId: d.personId, type: 'role.used', occurredAt: at(40) }, { name: 'person', id: d.personId });
    const trip = (id: string, state: Trip['state'], daysAgo: number, lateMin: number, orderId: string | null): Trip => {
      const end = at(daysAgo);
      const arrivedAt = new Date(end.getTime() - 5 * 60_000);
      return {
        id,
        courierId: d.personId,
        state,
        acceptedAt: new Date(end.getTime() - 30 * 60_000),
        completedAt: state === 'completed' ? end : null,
        cancelledAt: state === 'driver_cancelled' ? end : null,
        stops: state === 'completed' ? [{ windowEnd: new Date(arrivedAt.getTime() - lateMin * 60_000), arrivedAt }] : [],
        orders: orderId ? [{ orderId, attachedAt: end, detachedAt: null, reason: null, minVehicleClass: null }] : [],
      } as unknown as Trip;
    };
    // Four completed in the window (one 10 min late), one he cancelled, one completed before the
    // window and one still on the road.
    h.trips.push(
      trip('t1', 'completed', 1, 0, 'o1'),
      trip('t2', 'completed', 2, 0, 'o2'),
      trip('t3', 'completed', 3, 10, 'o3'),
      trip('t4', 'completed', 10, 0, 'o4'),
      trip('t5', 'driver_cancelled', 2, 0, null),
      trip('t6', 'completed', 20, 0, 'o6'),
      { ...trip('t7', 'in_transit', 0, 0, null), completedAt: null },
    );
    const rated = (id: string, delivery: number, daysAgo: number) => ({ id, rating: { delivery, food: 5, tags: [], note: null, ratedAt: at(daysAgo) } }) as unknown as Order;
    h.orders.set('o1', rated('o1', 5, 1));
    h.orders.set('o2', rated('o2', 5, 2));
    h.orders.set('o3', rated('o3', 4, 3));
    h.orders.set('o6', rated('o6', 3, 20)); // older than the 14 days, still among his last 50 ratings
    const card = await h.service.scorecard(d, {});
    expect(card.completedTrips).toBe(4);
    const metric = (key: string) => card.metrics.find((m) => m.key === key)!;
    expect(metric('on_time').samples).toBe(4);
    // The 10-day-old stop sits in the older week and weighs half: (1 + 1 + 0 + ½) / 3½.
    expect(metric('on_time').value).toBeCloseTo(2.5 / 3.5);
    expect(metric('completion').samples).toBe(5);
    expect(metric('completion').value).toBeLessThan(1);
    expect(metric('rating').samples).toBe(4);
    expect(metric('rating').value).toBeCloseTo((5 + 5 + 4 + 3) / 4);
  });
});

describe('driverAccount.documents', () => {
  it('uploads to pending (photo ref in the vault), reviews, derives expiring / expired and blocks going online', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['driver']);
    const up = await h.upload(d.personId);
    const doc = await h.service.uploadDocument(d, { kind: 'licence', uploadId: up });
    expect(doc).toMatchObject({ kind: 'licence', status: 'pending', status_ar: 'دا نراجعه', kind_ar: 'إجازة السوق' });
    // The ref is in the vault, not in the public row.
    expect(await h.id.repo.vaultRefs(d.personId, 'documentRefs')).toEqual([expect.objectContaining({ ref: up, kind: 'licence', recordId: doc.id })]);
    expect(JSON.stringify(h.repo.documents.get(doc.id))).not.toContain(up);

    const view = await h.service.documents(d, {});
    expect(view.missing).toEqual(['national_id_front', 'national_id_back', 'photo', 'vehicle_registration']);

    const ops = await h.person('07700000009', ['field_ops']);
    const approved = await h.service.reviewDocument(ops, { documentId: doc.id, decision: 'approve', expiresAt: new Date(h.clock.now().getTime() + 10 * DAY) });
    expect(approved.status).toBe('expiring');
    expect(approved.daysToExpiry).toBe(10);
    h.clock.advance(11 * DAY);
    const later = await h.service.documents(d, {});
    expect(later.documents[0]!.status).toBe('expired');
    expect(later.blocksOnline).toBe(true);
    const gate = await h.service.onlineGate(d);
    expect(gate.canGoOnline).toBe(false);
    expect(gate.reasons.map((r) => r.code)).toContain('document_expired');

    // A new submission supersedes the old one.
    const renewed = await h.service.uploadDocument(d, { kind: 'licence', uploadId: await h.upload(d.personId), expiresAt: new Date(h.clock.now().getTime() + 365 * DAY) });
    expect((await h.service.documents(d, {})).documents.map((x) => x.id)).toEqual([renewed.id]);
    // Review 2026-10-04 #18: uploading any photo must not reopen the gate; the renewal has to be approved.
    expect((await h.service.onlineGate(d)).reasons.map((r) => r.code)).toContain('document_expired');
    expect((await h.service.documents(d, {})).blocksOnline).toBe(true);
    await h.service.reviewDocument(ops, { documentId: renewed.id, decision: 'approve' });
    expect((await h.service.onlineGate(d)).reasons.map((r) => r.code)).not.toContain('document_expired');
    expect((await h.service.documents(d, {})).blocksOnline).toBe(false);
  });

  it('refuses an upload that is not his or not stored, and a rejection without a reason never reaches the service', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    const other = await h.person('07700000002', ['courier']);
    await expect(h.service.uploadDocument(d, { kind: 'photo', uploadId: await h.upload(other.personId) })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(h.service.uploadDocument(d, { kind: 'photo', uploadId: 'up_missing' })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(h.service.documents(d, { driverId: other.personId })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('driverAccount daily check-in', () => {
  it('passes with a stored selfie inside the 2-minute challenge and unlocks going online', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    expect((await h.service.onlineGate(d)).reasons.map((r) => r.code)).toEqual(['checkin_required']);
    const ch = await h.service.checkInChallenge(d);
    expect(ch.gesture_ar.length).toBeGreaterThan(2);
    const res = await h.service.submitCheckIn(d, { challengeId: ch.challengeId, uploadId: await h.upload(d.personId) });
    expect(res).toMatchObject({ result: 'passed', verifiedToday: true, badge_ar: 'متحقق اليوم', lockedOut: false });
    expect((await h.service.onlineGate(d)).canGoOnline).toBe(true);
    expect((await h.id.repo.vaultRefs(d.personId, 'selfieRefs')).length).toBe(1);
    expect((await h.ev.events.forActor(d.personId)).map((e) => e.type)).toContain('driver.checkin_selfie');
    // Next local day it is required again.
    h.clock.advance(DAY);
    expect((await h.service.checkInStatus(d)).verifiedToday).toBe(false);
  });

  it('two failures lock him out for the day with an ops alert; an expired challenge is refused', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    const stale = await h.service.checkInChallenge(d);
    h.clock.advance(3 * 60_000);
    await expect(h.service.submitCheckIn(d, { challengeId: stale.challengeId, uploadId: await h.upload(d.personId) })).rejects.toMatchObject({ code: 'checkin_challenge_invalid' });
    for (let i = 0; i < 2; i += 1) {
      const ch = await h.service.checkInChallenge(d);
      const res = await h.service.submitCheckIn(d, { challengeId: ch.challengeId, uploadId: await h.upload(d.personId), livenessScore: 0.1 });
      expect(res.result).toBe('failed');
      expect(res.reason).toBe('liveness_low');
    }
    const status = await h.service.checkInStatus(d);
    expect(status).toMatchObject({ failuresToday: 2, lockedOut: true });
    await expect(h.service.checkInChallenge(d)).rejects.toMatchObject({ code: 'checkin_locked' });
    expect((await h.service.onlineGate(d)).reasons.map((r) => r.code)).toEqual(['checkin_locked']);
    expect((await h.ev.events.forActor(d.personId)).filter((e) => e.type === 'driver.checkin_locked')).toHaveLength(1);
  });

  it('parallel submissions cannot beat the two-strikes lock-out (review 2026-10-04 #17)', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['courier']);
    const [c1, c2, c3] = [await h.service.checkInChallenge(d), await h.service.checkInChallenge(d), await h.service.checkInChallenge(d)];
    const [u1, u2, u3] = [await h.upload(d.personId), await h.upload(d.personId), await h.upload(d.personId)];
    const results = await Promise.allSettled([
      h.service.submitCheckIn(d, { challengeId: c1.challengeId, uploadId: u1, livenessScore: 0.1 }),
      h.service.submitCheckIn(d, { challengeId: c2.challengeId, uploadId: u2, livenessScore: 0.1 }),
      h.service.submitCheckIn(d, { challengeId: c3.challengeId, uploadId: u3, livenessScore: 0.99 }),
    ]);
    expect(results[2]).toMatchObject({ status: 'rejected', reason: { code: 'checkin_locked' } });
    expect((await h.service.onlineGate(d)).canGoOnline).toBe(false);
    expect((await h.ev.events.forActor(d.personId)).filter((e) => e.type === 'driver.checkin_locked')).toHaveLength(1);
  });

  it("refuses someone else's challenge", async () => {
    const h = setup();
    const a = await h.person('07700000001', ['courier']);
    const b = await h.person('07700000002', ['courier']);
    const ch = await h.service.checkInChallenge(a);
    await expect(h.service.submitCheckIn(b, { challengeId: ch.challengeId, uploadId: await h.upload(b.personId) })).rejects.toMatchObject({ code: 'checkin_challenge_invalid' });
  });
});

describe('driverAccount.handoverCode', () => {
  it('is 4 digits, verifies today and rotates at Baghdad midnight', async () => {
    const h = setup('2026-10-03T09:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    const { code, validUntil } = await h.service.handoverCode(d);
    expect(code).toMatch(/^\d{4}$/);
    expect(validUntil.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(h.service.verifyHandoverCode(d.personId, code)).toBe(true);
    h.clock.set('2026-10-03T21:00:01Z');
    const next = (await h.service.handoverCode(d)).code;
    expect(h.service.verifyHandoverCode(d.personId, next)).toBe(true);
    if (next !== code) expect(h.service.verifyHandoverCode(d.personId, code)).toBe(false);
  });
});

describe('driverAccount.shiftSummary (Partner S-4)', () => {
  it('sums the shift from the ledger: jobs, net, tips, per hour, best hour, the day, cash and tomorrow', async () => {
    // Saturday 3 Oct, 19:00 Baghdad. He went online at 15:00 Baghdad (12:00Z).
    const h = setup('2026-10-03T16:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    // Before the shift (10:00 Baghdad): counts for the day, not the shift.
    await h.ledger.posting.orderMoney(workedExample({ orderId: 'o_morning', courierId: d.personId, occurredAt: new Date('2026-10-03T07:00:00Z') }));
    // In the shift: two food orders in the 4–5 م hour (one with a tip), a ride with the take at 6:30 م.
    await h.ledger.posting.orderMoney(workedExample({ orderId: 'o1', courierId: d.personId, occurredAt: new Date('2026-10-03T13:10:00Z'), tipIqd: 1000 }));
    await h.ledger.posting.orderMoney(workedExample({ orderId: 'o2', courierId: d.personId, occurredAt: new Date('2026-10-03T13:40:00Z') }));
    await h.ledger.posting.rideMoney({ tripId: 't_ride', occurredAt: new Date('2026-10-03T15:30:00Z'), customerId: 'c2', payment: 'cash', driverId: d.personId, takeClass: 'car', fareIqd: 5000 });
    // Last Sunday (the weekday tomorrow falls on): orders peaked 1–3 م.
    h.hourly.counts[13] = 6;
    h.hourly.counts[14] = 4;
    h.hourly.counts[20] = 3;

    const s = await h.service.shiftSummary(d, { from: new Date('2026-10-03T12:00:00Z') });
    expect(s.from.toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(s.to.toISOString()).toBe('2026-10-03T16:00:00.000Z');
    expect(s.onlineMinutes).toBe(240);
    expect(s.jobs).toBe(3);
    expect(s.tipsIqd).toBe(1000);
    // 1,000 + 1,000 delivery, 1,000 tip, 5,000 fare − 600 take.
    expect(s.netIqd).toBe(1000 + 1000 + 1000 + 5000 - 600);
    expect(s.perHourIqd).toBe(1850); // 7,400 over 4 h = 1,850 an hour, to the nearest 50
    // The 6–7 م hour (the ride, 4,400 net) beats 4–5 م (3,000).
    expect(s.bestHour).toMatchObject({ from: new Date('2026-10-03T15:00:00Z'), to: new Date('2026-10-03T16:00:00Z'), netIqd: 4400, jobs: 1 });
    expect(s.day).toEqual({ netIqd: s.netIqd + 1000, jobs: 4 });
    expect(s.cash.capIqd).toBe(75_000);
    expect(s.cash.owedIqd).toBeGreaterThan(0);
    // Tomorrow is Sunday 4 Oct (Baghdad); last week's Sunday is 27 Sep, read as one Baghdad day.
    expect(h.hourly.asked[0]).toEqual({ from: new Date('2026-09-26T21:00:00Z'), to: new Date('2026-09-27T21:00:00Z') });
    expect(s.tomorrow).toEqual({ from: new Date('2026-10-04T10:00:00Z'), to: new Date('2026-10-04T12:00:00Z'), orders: 10 });
    // Month one: no scorecard nudge.
    expect(s.nudge).toBeNull();
  });

  it('defaults to the Baghdad day, says nothing per hour for a short shift and nothing for a quiet last week', async () => {
    const h = setup('2026-10-03T21:20:00Z'); // 00:20 Sunday Baghdad
    const d = await h.person('07700000001', ['courier']);
    const s = await h.service.shiftSummary(d, {});
    expect(s.from.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(s.onlineMinutes).toBe(20);
    expect(s.perHourIqd).toBeNull();
    expect(s.bestHour).toBeNull();
    expect(s.jobs).toBe(0);
    expect(s.tomorrow).toBeNull();
    // A `to` in the future is pulled back to now.
    expect((await h.service.shiftSummary(d, { to: new Date('2026-10-04T09:00:00Z') })).to.toISOString()).toBe('2026-10-03T21:20:00.000Z');
  });

  it('one scorecard nudge at most, from day 31', async () => {
    const h = setup('2026-10-03T09:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    const at = (daysAgo: number) => new Date(h.clock.now().getTime() - daysAgo * DAY);
    await h.ev.events.emit(undefined, { actorId: d.personId, type: 'role.used', occurredAt: at(40) }, { name: 'person', id: d.personId });
    for (const [i, type] of ['trip.accepted', 'trip.declined', 'trip.declined', 'trip.declined', 'trip.timed_out'].entries()) {
      await h.ev.events.emit(undefined, { actorId: d.personId, type, occurredAt: at(1 + i * 0.1) }, { name: 'trip', id: `t${i}` });
    }
    const s = await h.service.shiftSummary(d, {});
    expect(s.nudge?.key).toBe('acceptance');
    expect(s.nudge?.message_ar.length).toBeGreaterThan(0);
  });
});

describe('driverAccount.guarantee (G-91 shift guarantee)', () => {
  /** Aziziyah ships it switched off (Ali, 2026-10-06); the reads are tested with the switch on too. */
  const ON: MoneyRules = { ...AZIZIYAH_MONEY_RULES, guarantee: { ...AZIZIYAH_MONEY_RULES.guarantee, enabled: true } };
  /** A courier in Sunday 4 Oct's day shift (06:00–15:00 Baghdad = 03:00Z–12:00Z): 3 accepted and completed jobs, one declined offer. */
  async function lunch(now: string, roles: RoleKind[] = ['courier'], rules: MoneyRules = ON, jobs = ['2026-10-04T09:40:00Z', '2026-10-04T10:20:00Z', '2026-10-04T11:00:00Z']) {
    const h = setup('2026-10-04T08:00:00Z', rules);
    const d = await h.person('07700000021', roles);
    if (!roles.includes('courier')) h.ledger.profiles.set(d.personId, { role: 'driver', tier: 'bronze' });
    const emit = (type: string, actorId: string, tripId: string, at: string, payload: Record<string, unknown> = {}) =>
      h.ev.events.emit(undefined, { type, actorId, tripId, occurredAt: new Date(at), payload }, { name: 'trip', id: tripId });
    await emit('trip.declined', d.personId, 'tz', new Date(new Date(jobs[0]!).getTime() - 35 * 60_000).toISOString(), { driverId: d.personId });
    for (const [i, done] of jobs.entries()) {
      const tripId = `tg${i}`;
      await emit('trip.accepted', d.personId, tripId, new Date(new Date(done).getTime() - 20 * 60_000).toISOString(), { driverId: d.personId });
      await emit('trip.completed', d.personId, tripId, done);
      await h.ledger.posting.orderMoney(workedExample({ orderId: `og${i}`, tripId, courierId: d.personId, occurredAt: new Date(done) }));
    }
    h.clock.set(now);
    return { h, d };
  }

  it('live in a shift: the server counts his offers, jobs and earnings and what the rule gives', async () => {
    const { h, d } = await lunch('2026-10-04T11:30:00Z');
    const g = await h.service.guarantee(d);
    expect(g).toMatchObject({ enabled: true, amountIqd: 10_000, minAcceptance: 0.85, maxCancelsAfterAccept: 1, minCompletedJobs: 3, pendingIqd: 0 });
    // 3 of 4 offers accepted (75 %): the jobs are there, the acceptance is not.
    expect(g.current).toMatchObject({ id: '2026-10-04:day', status: 'live', offers: 4, accepted: 3, completedJobs: 3, jobsToGo: 0, earningsIqd: 3000, meets: { acceptance: false, cancels: true, jobs: true }, qualified: false, topUpIqd: 0 });
    expect(g.week.map((w) => w.id)).toEqual(['2026-10-04:day']);
    // The end-of-shift summary carries the same shift.
    const s = await h.service.shiftSummary(d, { from: new Date('2026-10-04T09:00:00Z') });
    expect(s.guarantee.map((w) => [w.id, w.status, w.completedJobs])).toEqual([['2026-10-04:day', 'live', 3]]);
  });

  it('past midnight: at 01:00 Monday the live shift is Sunday\'s 15:00–02:00, jobs after midnight included', async () => {
    const { h, d } = await lunch('2026-10-04T22:00:00Z', ['courier'], ON, ['2026-10-04T20:30:00Z', '2026-10-04T21:10:00Z', '2026-10-04T21:40:00Z']); // 23:30, 00:10, 00:40
    const g = await h.service.guarantee(d);
    expect(g.current).toMatchObject({ id: '2026-10-04:evening', status: 'live', from: new Date('2026-10-04T12:00:00Z'), to: new Date('2026-10-04T23:00:00Z'), offers: 4, completedJobs: 3 });
    expect(g.week.map((w) => w.id)).toEqual(['2026-10-04:evening', '2026-10-04:day']);
    // His work shift began after midnight: its summary still names the evening shift it ran into.
    const s = await h.service.shiftSummary(d, { from: new Date('2026-10-04T21:05:00Z') });
    expect(s.guarantee.map((w) => w.id)).toEqual(['2026-10-04:evening']);
  });

  it('after the shift a qualified top-up is pending until Sunday', async () => {
    const { h, d } = await lunch('2026-10-04T09:00:00Z');
    // Six more accepted offers that came to nothing (other drivers' jobs re-offered): 9 of 10 accepted.
    for (let i = 0; i < 6; i++) await h.ev.events.emit(undefined, { type: 'trip.accepted', actorId: d.personId, tripId: `tn${i}`, occurredAt: new Date(`2026-10-04T11:1${i}:00Z`), payload: { driverId: d.personId } }, { name: 'trip', id: `tn${i}` });
    h.clock.set('2026-10-04T14:00:00Z');
    const g = await h.service.guarantee(d);
    // 17:00: the evening shift is on, with nothing in it yet.
    expect(g.current).toMatchObject({ id: '2026-10-04:evening', status: 'live', offers: 0, completedJobs: 0 });
    expect(g.week.map((w) => w.id)).toEqual(['2026-10-04:evening', '2026-10-04:day']);
    expect(g.week[1]).toMatchObject({ id: '2026-10-04:day', status: 'ended', accepted: 9, offers: 10, qualified: true, topUpIqd: 7000, paysOn: new Date('2026-10-10T21:00:00Z') });
    expect(g.pendingIqd).toBe(7000);
  });

  it('switched off (Aziziyah as shipped, Ali 2026-10-06): a covered courier sees nothing, no pending money', async () => {
    const { h, d } = await lunch('2026-10-04T11:30:00Z', ['courier'], AZIZIYAH_MONEY_RULES);
    expect(await h.service.guarantee(d)).toMatchObject({ enabled: false, current: null, week: [], pendingIqd: 0 });
    expect((await h.service.shiftSummary(d, { from: new Date('2026-10-04T09:00:00Z') })).guarantee).toEqual([]);
    h.clock.set('2026-10-04T14:00:00Z');
    expect(await h.service.guarantee(d)).toMatchObject({ enabled: false, week: [], pendingIqd: 0 });
  });

  it('not covered (a car driver at launch): nothing to show', async () => {
    const { h, d } = await lunch('2026-10-04T11:30:00Z', ['driver']);
    expect(await h.service.guarantee(d)).toMatchObject({ enabled: false, current: null, week: [], pendingIqd: 0 });
    expect((await h.service.shiftSummary(d, {})).guarantee).toEqual([]);
  });
});

describe('driverAccount.jobReceipt and payQuery (Partner S-7)', () => {
  it('every line with its reason, the take rate, the cash and the ticket; an objection opens one support ticket', async () => {
    const h = setup('2026-10-03T16:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    await h.ledger.posting.rideMoney({ tripId: 't_ride', occurredAt: new Date('2026-10-03T15:30:00Z'), customerId: 'c2', payment: 'cash', driverId: d.personId, takeClass: 'car', fareIqd: 5000 });
    const job = (await h.service.earnings(d, { period: 'day' })).jobs.find((j) => j.tripId === 't_ride')!;

    const r = await h.service.jobReceipt(d, { key: job.key, at: job.at });
    expect(r.lines.map((l) => [l.type, l.reason?.code])).toEqual([
      ['fare', 'fare'],
      ['commission_accrued', 'take'],
    ]);
    expect(r).toMatchObject({ grossIqd: 5000, takeIqd: 600, takeRate: 0.12, netIqd: 4400, queryOpen: false });
    expect(r.lines[1]!.reason).toEqual({ code: 'take', params: { rate: 12 } });
    expect(r.cash).toEqual({ collectedIqd: 5000, toMerchantIqd: 0, keptIqd: 4400, toCompanyIqd: 600 });

    const q = await h.service.payQuery(d, { key: job.key, at: job.at, message: 'العمولة أكثر من المتفق عليه' });
    expect(q.alreadyOpen).toBe(false);
    const ticket = h.supportRepo.tickets.get(q.ticketId)!;
    expect(ticket).toMatchObject({ kind: 'complaint', channel: 'in_app', customerId: null, openedById: d.personId, tripId: r.tripId, status: 'open' });
    expect(ticket.subject).toContain('اعتراض');
    expect(h.audits.map((a) => a.action)).toEqual(['ticket.open']);
    expect((await h.ev.events.forActor(d.personId)).some((e) => e.type === 'support.ticket_opened')).toBe(true);

    // Asking again returns the same ticket; the receipt now says it is with support.
    const again = await h.service.payQuery(d, { key: job.key, at: job.at, message: 'ثاني مرة' });
    expect(again).toMatchObject({ ticketId: q.ticketId, alreadyOpen: true });
    expect((await h.service.jobReceipt(d, { key: job.key, at: job.at })).queryOpen).toBe(true);
  });

  it('S-7 follow-up: support\'s reply and the resolution reach the receipt, and the events name the driver and the job', async () => {
    const h = setup('2026-10-03T16:00:00Z');
    const d = await h.person('07700000001', ['courier']);
    const agent = { personId: 'agent_1', roles: ['support'] } as unknown as Parameters<typeof h.support.reply>[0];
    await h.ledger.posting.rideMoney({ tripId: 't_ride', occurredAt: new Date('2026-10-03T15:30:00Z'), customerId: 'c2', payment: 'cash', driverId: d.personId, takeClass: 'car', fareIqd: 5000 });
    const job = (await h.service.earnings(d, { period: 'day' })).jobs.find((j) => j.tripId === 't_ride')!;
    expect((await h.service.jobReceipt(d, { key: job.key, at: job.at })).query).toBeNull();
    const q = await h.service.payQuery(d, { key: job.key, at: job.at, message: 'العمولة أكثر من المتفق عليه' });
    expect((await h.service.jobReceipt(d, { key: job.key, at: job.at })).query).toEqual({ ticketId: q.ticketId, status: 'open', reply: null, resolution: null, resolvedAt: null });

    // An internal note never reaches him; a reply does, with the job's key and time for the push.
    h.clock.set('2026-10-03T17:00:00Z');
    await h.support.reply(agent, { ticketId: q.ticketId, text: 'ملاحظة داخلية', internal: true });
    await h.support.reply(agent, { ticketId: q.ticketId, text: 'العمولة 12% على المشاوير، نراجع الحساب', internal: false });
    const open = await h.service.jobReceipt(d, { key: job.key, at: job.at });
    expect(open.query).toMatchObject({ status: 'open', reply: { text: 'العمولة 12% على المشاوير، نراجع الحساب', at: new Date('2026-10-03T17:00:00Z') }, resolution: null });
    const replied = (await h.ev.events.forActor('agent_1')).find((e) => e.type === 'support.replied')!;
    expect(replied.payload).toMatchObject({ driverId: d.personId, jobKey: job.key, jobAt: job.at.toISOString(), text: 'العمولة 12% على المشاوير، نراجع الحساب' });

    h.clock.set('2026-10-03T18:00:00Z');
    await h.support.resolve(agent, { ticketId: q.ticketId, resolution: 'الحساب صحيح، العمولة 12%' });
    const done = await h.service.jobReceipt(d, { key: job.key, at: job.at });
    expect(done.query).toMatchObject({ status: 'resolved', resolution: 'الحساب صحيح، العمولة 12%', resolvedAt: new Date('2026-10-03T18:00:00Z') });
    expect(done.queryOpen).toBe(true);
    const resolved = (await h.ev.events.forActor('agent_1')).find((e) => e.type === 'support.resolved')!;
    expect(resolved.payload).toMatchObject({ driverId: d.personId, jobKey: job.key, jobAt: job.at.toISOString(), resolution: 'الحساب صحيح، العمولة 12%' });
  });

  it("is his own book only: another driver's job is not found", async () => {
    const h = setup('2026-10-03T16:00:00Z');
    const a = await h.person('07700000001', ['courier']);
    const b = await h.person('07700000002', ['courier']);
    await h.ledger.posting.orderMoney(workedExample({ orderId: 'o1', courierId: a.personId, occurredAt: new Date('2026-10-03T13:10:00Z') }));
    await expect(h.service.jobReceipt(b, { key: 'o1', at: new Date('2026-10-03T13:10:00Z') })).rejects.toMatchObject({ code: 'not_found' });
    await expect(h.service.payQuery(b, { key: 'o1', at: new Date('2026-10-03T13:10:00Z'), message: 'مو إلي' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await h.service.jobReceipt(a, { key: 'o1', at: new Date('2026-10-03T13:10:00Z') })).ticket).toMatch(/^\d{4}$/);
  });
});
