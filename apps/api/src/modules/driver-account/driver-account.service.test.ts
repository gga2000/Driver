import { describe, expect, it } from 'vitest';
import type { Actor, Order, RoleKind, Trip } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { postDriverIncentive } from '../ledger/postings.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import type { OrdersService } from '../orders/index.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import type { TripsService } from '../trips/index.js';
import { InMemoryDriverAccountRepository } from './driver-account.repository.js';
import { DriverAccountService } from './driver-account.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const DAY = 86_400_000;

/** Stores a tiny JPEG through the dev blob store's signed PUT, as the app would. */
async function storedUpload(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

/** DriverAccountService on in-memory identity, ledger, events and blob store; trips and orders scripted. */
function setup(start = '2026-10-03T09:00:00Z') {
  const id = identityHarness(start);
  const clock = id.clock;
  const ledger = ledgerHarness({ start });
  const ev = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'test-blob-secret' });
  const repo = new InMemoryDriverAccountRepository();
  const trips: Trip[] = [];
  const orders = new Map<string, Order>();
  const tripsFake = { forDriver: async (driverId: string) => trips.filter((t) => t.courierId === driverId) } as unknown as TripsService;
  const ordersFake = {
    get: async (orderId: string) => {
      const o = orders.get(orderId);
      if (!o) throw new Error('order not found');
      return o;
    },
  } as unknown as OrdersService;
  const service = new DriverAccountService(repo, ledger.facade, ev.events, tripsFake, ordersFake, id.service, blobs, ev.uow, clock, 'handover-test-secret');
  async function person(phone: string, roles: RoleKind[] = []): Promise<Actor> {
    const { actor } = await id.login(phone);
    for (const kind of roles) await id.service.grantRole({ personId: 'admin' }, { personId: actor.personId, kind });
    return actor;
  }
  return { id, clock, ledger, ev, blobs, repo, trips, orders, service, person, upload: (ownerId: string) => storedUpload(blobs, ownerId) };
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
    await h.ledger.ledger.recordAll(postDriverIncentive({ key: 'g1', driverId: d.personId, amountIqd: 2000, reason: 'guarantee:lunch', occurredAt: new Date('2026-10-03T12:45:00Z') })!);

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
});

describe('driverAccount.documents', () => {
  it('uploads to pending (photo ref in the vault), reviews, derives expiring / expired and blocks going online', async () => {
    const h = setup();
    const d = await h.person('07700000001', ['driver']);
    const up = await h.upload(d.personId);
    const doc = await h.service.uploadDocument(d, { kind: 'licence', uploadId: up });
    expect(doc).toMatchObject({ kind: 'licence', status: 'pending', status_ar: 'قيد المراجعة', kind_ar: 'إجازة السوق' });
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
