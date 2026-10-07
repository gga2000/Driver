import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from './shared/db/prisma.service.js';
import { UnitOfWork } from './shared/db/unit-of-work.js';
import { PrismaControlsRepository, targetOf } from './modules/controls/index.js';
import { PrismaDriverAccountRepository } from './modules/driver-account/index.js';
import { PrismaFleetRepository } from './modules/fleet/index.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from './modules/ledger/prisma.repository.js';
import { PrismaOpsRepository } from './modules/ops/index.js';
import { PrismaPromotionsRepository } from './modules/promotions/index.js';
import { PrismaSupportRepository } from './modules/support/index.js';

/**
 * Launch control room on a real Postgres (migrations deployed and seeded): kill switches, zone capacities,
 * banners and the audit log; support tickets and entries (moved out of memory) with the per-customer
 * advisory lock; and the review columns / queries the approvals queue added to driver documents,
 * deals, landmark photos, onboarding drafts and fleet vehicles. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('control room repositories on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const run = `cr${Date.now().toString(36)}`;
  const at = new Date('2026-10-04T09:00:00Z');

  beforeAll(async () => {
    await prisma.prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('controls: switches upsert by target, capacities by zone, banners live until expiry or clear, audit newest first', async () => {
    const repo = new PrismaControlsRepository(prisma);
    const city = `city_${run}`;
    const base = { cityId: city, scope: 'zone' as const, key: 'zakur', vertical: null, target: targetOf('zone', 'zakur', null), holdDispatch: true, messageAr: null, reason: 'حفريات', setById: 'p1', setAt: at, expiresAt: null };
    const on = await repo.upsertSwitch({ ...base, active: true });
    const off = await repo.upsertSwitch({ ...base, active: false, holdDispatch: false, reason: 'خلصت', setAt: new Date(at.getTime() + 60_000) });
    expect(off.id).toBe(on.id);
    await repo.upsertSwitch({ ...base, vertical: 'taxi', target: targetOf('zone', 'zakur', 'taxi'), active: true });
    // Newest change first: the switch-back (at + 1 min) before the taxi-only switch (at).
    expect((await repo.switches(city)).map((s) => [s.target, s.active])).toEqual([
      ['zone:zakur:*', false],
      ['zone:zakur:taxi', true],
    ]);
    await repo.upsertCapacity({ cityId: city, zoneKey: 'zakur', maxActive: 5, mode: 'queue', etaMin: 30, setById: 'p1', setAt: at });
    await repo.upsertCapacity({ cityId: city, zoneKey: 'zakur', maxActive: null, mode: 'refuse', etaMin: 15, setById: 'p2', setAt: at });
    expect(await repo.capacities(city)).toMatchObject([{ zoneKey: 'zakur', maxActive: null, mode: 'refuse', setById: 'p2' }]);

    const b = await repo.createBanner({ cityId: city, severity: 'critical', audiences: ['customer', 'partner'], messageAr: run, messageEn: null, startsAt: at, expiresAt: new Date('2099-01-01T00:00:00Z'), setById: 'p1', setAt: at, clearedAt: null, clearedById: null });
    expect((await repo.liveBanners(new Date())).some((x) => x.id === b.id && x.audiences.includes('partner'))).toBe(true);
    await repo.clearBanner(b.id, 'p2', new Date());
    expect((await repo.liveBanners(new Date())).some((x) => x.id === b.id)).toBe(false);
    expect((await repo.banner(b.id))?.clearedById).toBe('p2');

    await uow.run(async (tx) => {
      await repo.addAudit({ cityId: city, actorId: 'p1', action: 'kill_switch.on', subjectKind: 'kill_switch', subjectId: 'zone:zakur:*', summaryAr: 'وقّف', detail: { a: 1 }, at }, tx);
      await repo.addAudit({ cityId: city, actorId: 'p2', action: 'capacity.set', subjectKind: 'capacity', subjectId: 'zakur', summaryAr: 'سقف', detail: {}, at: new Date(at.getTime() + 1000) }, tx);
    });
    expect((await repo.audit({ cityId: city, limit: 2 })).map((a) => a.action)).toEqual(['capacity.set', 'kill_switch.on']);
    expect((await repo.audit({ cityId: city, subjectKind: 'kill_switch', limit: 5 }))[0]?.detail).toEqual({ a: 1 });
  });

  it('support: tickets by source key, entries idempotent, refunds per agent / per customer, the customer lock', async () => {
    const repo = new PrismaSupportRepository(prisma);
    const customer = `c_${run}`;
    const t = await repo.create({
      cityId: 'aziziyah',
      kind: 'dispute',
      status: 'open',
      channel: 'in_app',
      subject: 'تأخير',
      orderId: `o_${run}`,
      tripId: null,
      customerId: customer,
      openedById: customer,
      openedAt: at,
      firstResponseAt: null,
      resolvedAt: null,
      slaDueAt: new Date(at.getTime() + 3_600_000),
      assigneeId: null,
      faultParty: 'none',
      refundedIqd: 0,
      escalatedTo: null,
      escalatedAt: null,
      resolution: null,
      sourceKey: `dispute:o_${run}`,
      reopenCount: 0,
      lastActivityAt: at,
    });
    expect((await repo.bySourceKey(`dispute:o_${run}`))?.id).toBe(t.id);
    await uow.run(async (tx) => {
      await repo.lockCustomer(customer, tx);
      await repo.addEntry({ ticketId: t.id, actorId: `a_${run}`, kind: 'refund', text: '1,000', amountIqd: 1000, meta: { method: 'wallet' }, idempotencyKey: `refund:${run}`, at }, tx);
      await repo.update(t.id, { refundedIqd: 1000, status: 'waiting' }, tx);
    });
    await expect(repo.addEntry({ ticketId: t.id, actorId: `a_${run}`, kind: 'refund', text: 'x', amountIqd: 1, meta: {}, idempotencyKey: `refund:${run}`, at })).rejects.toThrow();
    expect((await repo.entryByKey(`refund:${run}`))?.meta).toEqual({ method: 'wallet' });
    expect((await repo.refundsBy(`a_${run}`, new Date(at.getTime() - 1))).map((e) => e.amountIqd)).toEqual([1000]);
    expect((await repo.refundsOn([t.id], new Date(at.getTime() - 1))).length).toBe(1);
    expect((await repo.forCustomer(customer, new Date(at.getTime() - 1))).map((x) => x.status)).toEqual(['waiting']);
    expect((await repo.list({ cityId: 'aziziyah', statuses: ['waiting'], limit: 500 })).some((x) => x.id === t.id)).toBe(true);
    await repo.update(t.id, { status: 'resolved', resolvedAt: at });
    expect((await repo.list({ cityId: 'aziziyah', statuses: [], resolvedSince: new Date(at.getTime() - 1), limit: 500 })).some((x) => x.id === t.id)).toBe(true);
  });

  it('approvals queue reads and conditional decisions on the owning tables', async () => {
    const docs = new PrismaDriverAccountRepository(prisma);
    const person = (await prisma.prisma.person.create({ data: { locale: 'ar-IQ' } })).id;
    const doc = await docs.createDocument({ personId: person, kind: 'licence', status: 'pending', expiresAt: null, submittedAt: at, reviewedAt: null, reviewedById: null, rejectReason: null, supersededAt: null });
    expect((await docs.pendingDocuments(1000)).some((d) => d.id === doc.id)).toBe(true);

    const ops = new PrismaOpsRepository(prisma);
    const photo = await ops.addLandmarkPhoto({ targetKind: 'landmark', targetId: `new:${run}`, uploadId: `up_${run}`, caption: null, localNames: ['يم الجامع'], state: 'proposed', addedById: person, createdAt: at });
    expect((await ops.photosIn('proposed', 1000)).some((p) => p.id === photo.id)).toBe(true);
    expect(await ops.decidePhoto(photo.id, { state: 'approved', reviewedById: 'r1', reviewedAt: at, rejectReason: null })).toMatchObject({ state: 'approved', reviewedById: 'r1' });
    expect(await ops.decidePhoto(photo.id, { state: 'rejected', reviewedById: 'r2', reviewedAt: at, rejectReason: 'x' })).toBeNull();
    expect((await ops.approvedPhotosOf(`new:${run}`)).map((p) => p.id)).toEqual([photo.id]);

    const org = await prisma.prisma.org.create({ data: { type: 'restaurant', name: `مطعم ${run}`, cityId: 'aziziyah' } });
    const draft = await ops.addOnboarding({ orgId: org.id, cityId: 'aziziyah', name: 'فلافل', type: 'restaurant', contactPersonId: person, location: { zoneKey: 'zakur' }, menuPhotoRefs: ['m1'], shopPhotoRef: null, notes: null, state: 'draft', createdById: 'f1', createdAt: at });
    await ops.addTask({ cityId: 'aziziyah', kind: 'merchant_followup', refId: draft.id, title: 'كمّل', state: 'open', assigneeId: 'f1', dueAt: null, payload: {}, completedAt: null, completedById: null, createdAt: at });
    expect((await ops.onboardingsIn(['draft'], 1000)).some((o) => o.id === draft.id)).toBe(true);
    expect((await ops.openTasksFor(draft.id)).length).toBe(1);
    expect(await ops.decideOnboarding(draft.id, { state: 'active', reviewedById: 'r1', reviewedAt: at, rejectReason: null })).toMatchObject({ state: 'active', location: { zoneKey: 'zakur' } });
    expect(await ops.decideOnboarding(draft.id, { state: 'rejected', reviewedById: 'r1', reviewedAt: at, rejectReason: 'x' })).toBeNull();

    const fleetOrg = await prisma.prisma.org.create({ data: { type: 'fleet', name: `أسطول ${run}`, cityId: 'aziziyah' } });
    const fleet = new PrismaFleetRepository(prisma);
    const v = await fleet.createVehicle({ plate: `CR ${run}`, vehicleClass: 'tuktuk', ownerOrgId: fleetOrg.id });
    expect(v.reviewState).toBe('pending');
    expect((await fleet.vehiclesInReview(1000)).some((x) => x.id === v.id)).toBe(true);
    expect(await fleet.reviewVehicle(v.id, { verified: false, by: 'r1', at, note: 'اللوحة غلط' })).toMatchObject({ reviewState: 'rejected', active: false, activeDriverId: null });
    expect(await fleet.reviewVehicle(v.id, { verified: true, by: 'r1', at, note: null })).toBeNull();

    // Ride step 3: model, colour and the features the car check confirmed.
    const car = await fleet.createVehicle({ plate: `CF ${run}`, vehicleClass: 'car', ownerOrgId: fleetOrg.id, model: 'Toyota Corolla', colour: 'white' });
    expect(car).toMatchObject({ model: 'Toyota Corolla', colour: 'white', features: [], featuresConfirmed: [] });
    expect(await fleet.reviewVehicle(car.id, { verified: true, by: 'r1', at, note: null, features: { features: ['ac'], featuresConfirmed: ['ac'] } })).toMatchObject({ reviewState: 'verified', features: ['ac'], featuresConfirmed: ['ac'] });
    expect((await fleet.vehiclesWithUnconfirmedFeatures(1000)).some((x) => x.id === car.id)).toBe(false);
    expect(await fleet.setFeatures(car.id, { features: ['family', 'ac'], featuresConfirmed: ['ac'] }, at)).toMatchObject({ features: ['ac', 'family'], featuresConfirmed: ['ac'] });
    expect((await fleet.vehiclesWithUnconfirmedFeatures(1000)).some((x) => x.id === car.id)).toBe(true);
    // The database keeps the confirmed ones a subset of the claims.
    await expect(fleet.setFeatures(car.id, { features: ['ac'], featuresConfirmed: ['ac', 'heating'] }, at)).rejects.toThrow();

    const promos = new PrismaPromotionsRepository(prisma);
    const deal = await promos.createDeal({
      cityId: 'aziziyah',
      merchantOrgId: org.id,
      ownerId: person,
      nameAr: 'خصم',
      type: 'percent',
      value: 10,
      itemIds: [],
      schedule: { startsAt: at, endsAt: new Date(at.getTime() + 86_400_000), days: [] },
      minOrderIqd: 0,
      budgetCapIqd: null,
      spentIqd: 0,
      projection: { ordersPerWeek: 1, costPerOrderIqd: 500, weeklyCostIqd: 500, totalCostIqd: 500, basisOrders: 1 },
      proposalState: 'pending_approval',
      active: true,
      approvedAt: null,
      createdAt: at,
    });
    expect((await promos.pendingDeals(1000)).some((d) => d.id === deal.id)).toBe(true);
  });

  it('ledger: lines by order and by type in a window', async () => {
    const repo = new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate);
    const person = (await prisma.prisma.person.create({ data: { locale: 'ar-IQ' } })).id;
    const orderId = (await prisma.prisma.order.create({ data: { cityId: 'aziziyah', type: 'food', ordererId: person } })).id;
    await repo.appendMany([
      { type: 'credit_issued', amount: 1000, currency: 'IQD', fromAccount: 'platform', toAccount: `customer:c_${run}`, orderId, postingGroupId: `support:${run}`, idempotencyKey: `support:${run}:0`, occurredAt: at, memo: `support:tk:platform` },
      { type: 'driver_settlement', amount: 5000, currency: 'IQD', fromAccount: 'bank', toAccount: `cash:d_${run}`, postingGroupId: `settlement:${run}`, idempotencyKey: `settlement:${run}:0`, occurredAt: at, memo: 'ops_round:D-1' },
    ]);
    expect((await repo.byOrder(orderId)).map((e) => e.type)).toEqual(['credit_issued']);
    const window = await repo.byTypesBetween(['driver_settlement'], new Date(at.getTime() - 1), new Date(at.getTime() + 1));
    expect(window.some((e) => e.toAccount === `cash:d_${run}`)).toBe(true);
  });
});
