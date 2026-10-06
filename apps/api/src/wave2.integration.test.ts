import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { UnitOfWork } from './shared/db/unit-of-work.js';
import { CatalogService, PrismaCatalogRepository } from './modules/catalog/index.js';
import { PrismaDriverAccountRepository } from './modules/driver-account/index.js';
import { createInMemoryEvents } from './modules/events/index.js';
import { PrismaFleetRepository } from './modules/fleet/index.js';
import { PrismaIdentityRepository } from './modules/identity/identity.repository.js';
import { PrismaKhatRepository } from './modules/khat/index.js';
import { PrismaMerchantAdminRepository } from './modules/merchant-admin/index.js';
import { PrismaOpsRepository } from './modules/ops/index.js';
import { PrismaPromotionsRepository, PromotionsService } from './modules/promotions/index.js';

/**
 * Partner & Merchant wave 2 on a real Postgres (migrations deployed, seed loaded): every new
 * repository round-trips through Prisma, and the catalog admin path runs inside one unit of work.
 * Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('wave 2 repositories on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const run = `w2${Date.now().toString(36)}`;
  const at = new Date('2026-10-03T12:00:00Z');
  let personId = '';
  let otherId = '';
  let merchantOrgId = '';
  let fleetOrgId = '';

  beforeAll(async () => {
    const identity = new PrismaIdentityRepository(prisma);
    personId = (await identity.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: `+9647${Date.now() % 1e9}1`, phoneHash: `${run}-h1`, name: null, now: at })).id;
    otherId = (await identity.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: `+9647${Date.now() % 1e9}2`, phoneHash: `${run}-h2`, name: null, now: at })).id;
    merchantOrgId = (await prisma.prisma.org.create({ data: { type: 'restaurant', name: `مطعم ${run}`, cityId: 'aziziyah' } })).id;
    fleetOrgId = (await prisma.prisma.org.create({ data: { type: 'fleet', name: `أسطول ${run}`, cityId: 'aziziyah' } })).id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('identity: vault refs and org role holders', async () => {
    const repo = new PrismaIdentityRepository(prisma);
    await repo.appendVaultRef(personId, 'documentRefs', { ref: 'up_1', kind: 'licence', recordId: 'd1' });
    await repo.appendVaultRef(personId, 'documentRefs', { ref: 'up_2', kind: 'photo', recordId: 'd2' });
    expect((await repo.vaultRefs(personId, 'documentRefs')).map((r) => r['ref'])).toEqual(['up_1', 'up_2']);
    expect(await repo.vaultRefs(personId, 'selfieRefs')).toEqual([]);
    await repo.upsertRole({ personId, kind: 'merchant_owner', orgId: merchantOrgId, grantedBy: null, now: at });
    await repo.upsertRole({ personId: otherId, kind: 'merchant_staff', orgId: merchantOrgId, grantedBy: null, now: at });
    expect((await repo.orgRoleHolders(merchantOrgId, ['merchant_owner', 'merchant_staff'])).map((r) => [r.personId, r.kind])).toEqual([
      [personId, 'merchant_owner'],
      [otherId, 'merchant_staff'],
    ]);
  });

  it('driver documents and check-ins', async () => {
    const repo = new PrismaDriverAccountRepository(prisma);
    const doc = await repo.createDocument({ personId, kind: 'licence', status: 'pending', expiresAt: null, submittedAt: at, reviewedAt: null, reviewedById: null, rejectReason: null, supersededAt: null });
    const reviewed = await repo.updateDocument(doc.id, { status: 'approved', reviewedAt: at, reviewedById: otherId, expiresAt: new Date('2027-01-01T00:00:00Z') });
    expect(reviewed).toMatchObject({ status: 'approved', reviewedById: otherId });
    expect((await repo.currentDocuments([personId])).map((d) => d.id)).toEqual([doc.id]);
    await repo.updateDocument(doc.id, { supersededAt: at });
    expect(await repo.currentDocuments([personId])).toEqual([]);

    const chk = await repo.createCheckIn({ personId, localDate: '2026-10-03', gesture: 'blink', issuedAt: at, expiresAt: new Date(at.getTime() + 120_000), result: 'pending', submittedAt: null, livenessScore: null, failureReason: null });
    await repo.updateCheckIn(chk.id, { result: 'passed', submittedAt: at, livenessScore: 0.9 });
    expect((await repo.checkInsOn(personId, '2026-10-03')).map((c) => [c.result, c.livenessScore])).toEqual([['passed', 0.9]]);
  });

  it('khat absences are unique per trip and child', async () => {
    const repo = new PrismaKhatRepository(prisma);
    const a = await repo.createAbsence({ tripId: `trip_${run}`, childRef: `ch_${run}`, localDate: '2026-10-03', reportedById: personId, reason: 'sick', note: null, skippedStopIds: ['s1', 's2'], createdAt: at });
    expect(await repo.absence(`trip_${run}`, `ch_${run}`)).toMatchObject({ id: a.id, reason: 'sick', skippedStopIds: ['s1', 's2'] });
    await expect(repo.createAbsence({ ...a, createdAt: at })).rejects.toThrow();
    expect((await repo.absencesForTrips([`trip_${run}`])).length).toBe(1);
  });

  it('khat sweep alerts: one per run, the first late confirm kept', async () => {
    const repo = new PrismaKhatRepository(prisma);
    const tripId = `trip_sw_${run}`;
    const input = { tripId, cityId: 'aziziyah', driverId: personId, childrenTotal: 2, lastDropAt: at, lastDropZone: 'centre', runEndedAt: at, raisedAt: new Date(at.getTime() + 5 * 60_000) };
    const first = await repo.raiseSweepAlert(input);
    expect(first.created).toBe(true);
    const again = await repo.raiseSweepAlert(input);
    expect(again).toMatchObject({ created: false, alert: { id: first.alert.id } });
    const late = new Date(at.getTime() + 7 * 60_000);
    expect((await repo.confirmSweepAlert(tripId, late))?.confirmedAt).toEqual(late);
    expect((await repo.confirmSweepAlert(tripId, new Date(late.getTime() + 60_000)))?.confirmedAt).toEqual(late);
    expect((await repo.sweepAlertsSince('aziziyah', at)).some((a) => a.id === first.alert.id)).toBe(true);
    expect(await repo.sweepAlert(first.alert.id)).toMatchObject({ tripId, lastDropZone: 'centre' });
  });

  it('fleet vehicles (registry) and drivers', async () => {
    const repo = new PrismaFleetRepository(prisma);
    const v1 = await repo.createVehicle({ plate: `P1-${run}`, vehicleClass: 'car', ownerOrgId: fleetOrgId });
    const v2 = await repo.createVehicle({ plate: `P2-${run}`, vehicleClass: 'tuktuk', ownerOrgId: fleetOrgId });
    expect((await repo.vehicleByPlate(`P1-${run}`))?.id).toBe(v1.id);
    await repo.setActiveDriver(v1.id, personId);
    await repo.setActiveDriver(v2.id, personId);
    expect((await repo.vehicles(fleetOrgId)).map((v) => [v.id, v.activeDriverId])).toEqual([
      [v1.id, null],
      [v2.id, personId],
    ]);
    const link = await repo.addDriver({ fleetOrgId, personId, addedById: otherId, at });
    expect((await repo.addDriver({ fleetOrgId, personId, addedById: otherId, at })).id).toBe(link.id);
    expect((await repo.drivers(fleetOrgId)).map((d) => d.personId)).toEqual([personId]);
    // Consent (review 2026-10-04 #2): pending until the driver accepts; leaving ends the link.
    expect(link.acceptedAt).toBeNull();
    expect((await repo.answerLink({ fleetOrgId, personId, accept: true, at }))?.acceptedAt).toEqual(at);
    expect((await repo.linksOf(personId)).map((l) => [l.fleetOrgId, l.acceptedAt])).toEqual([[fleetOrgId, at]]);
    expect((await repo.answerLink({ fleetOrgId, personId, accept: false, at }))?.removedAt).toEqual(at);
    expect(await repo.drivers(fleetOrgId)).toEqual([]);
    expect((await repo.addDriver({ fleetOrgId, personId, addedById: otherId, at })).acceptedAt).toBeNull();
  });

  it('ops photos, cash receipts, onboardings and tasks', async () => {
    const repo = new PrismaOpsRepository(prisma);
    expect((await repo.addLandmarkPhoto({ targetKind: 'landmark', targetId: 'lm1', uploadId: 'up_x', caption: null, localNames: ['يم الجامع'], state: 'proposed', addedById: personId, createdAt: at })).localNames).toEqual(['يم الجامع']);
    const r = await repo.addCashReceipt({ courierId: otherId, receivedById: personId, amountIqd: 10000, reference: `D-${run}`, idempotencyKey: `key-${run}`, note: null, courierCashAfterIqd: -5000, createdAt: at });
    expect((await repo.cashReceiptByKey(`key-${run}`))?.id).toBe(r.id);
    expect(await repo.countCashReceipts(otherId)).toBe(1);
    const ob = await repo.addOnboarding({ orgId: 'org_mem_1', cityId: 'aziziyah', name: 'محل', type: 'grocer', contactPersonId: otherId, location: { zoneKey: 'centre' }, menuPhotoRefs: ['up_1'], shopPhotoRef: null, notes: null, state: 'draft', createdById: personId, createdAt: at });
    expect(ob.id).toBeTruthy();
    const t = await repo.addTask({ cityId: 'aziziyah', kind: 'merchant_followup', refId: ob.id, title: 'كمّل', state: 'open', assigneeId: personId, dueAt: null, payload: { n: 1 }, completedAt: null, completedById: null, createdAt: at });
    expect((await repo.openTasks(personId)).map((x) => x.id)).toContain(t.id);
    expect((await repo.updateTask(t.id, { state: 'done', completedAt: at, completedById: personId })).state).toBe('done');
    expect((await repo.openTasks(personId)).map((x) => x.id)).not.toContain(t.id);
  });

  it('catalog admin in one unit of work: price history, sold out today, modifiers, imports', async () => {
    const clock = new FakeClock('2026-10-03T12:00:00Z');
    const repo = new PrismaCatalogRepository(prisma);
    const catalog = new CatalogService(repo, clock);
    const { item } = await uow.run((tx) => catalog.upsertItem(merchantOrgId, { patch: { nameAr: 'لفة', priceIqd: 3000, categoryAr: 'لفات' } }, personId, tx));
    await uow.run((tx) => catalog.updatePrice(merchantOrgId, item.id, 3500, personId, tx));
    expect((await catalog.priceHistory(merchantOrgId, item.id)).map((c) => [c.oldPriceIqd, c.newPriceIqd])).toEqual([
      [3000, 3500],
      [0, 3000],
    ]);
    const sold = await uow.run((tx) => catalog.soldOutToday(merchantOrgId, item.id, tx));
    expect(sold.soldOutUntil?.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect((await catalog.itemsOf(merchantOrgId, [item.id]))[0]?.available).toBe(false);
    clock.set('2026-10-03T21:00:01Z');
    expect((await catalog.itemsOf(merchantOrgId, [item.id]))[0]?.available).toBe(true);

    const mods = await uow.run((tx) => catalog.setModifiers(merchantOrgId, item.id, [{ nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'كبير', priceIqd: 1000 }] }], tx));
    expect(mods.modifierGroups.map((g) => g.modifiers.map((m) => m.nameAr))).toEqual([['كبير']]);

    const job = await catalog.createImportJob(merchantOrgId, ['up_a'], personId);
    const applied = await uow.run((tx) => catalog.applyImport(merchantOrgId, job.id, [{ nameAr: 'كباب', priceIqd: 5000 }], personId, tx));
    expect(applied).toMatchObject({ state: 'applied', appliedCount: 1 });
    expect((await catalog.adminMenu(merchantOrgId)).map((i) => i.nameAr)).toEqual(['لفة', 'كباب']);
  });

  it('merchant deals in promotions and dispute responses', async () => {
    const clock = new FakeClock('2026-10-03T12:00:00Z');
    const ev = createInMemoryEvents({ clock });
    const promotions = new PromotionsService(new PrismaPromotionsRepository(prisma), ev.events, uow, clock);
    const schedule = { startsAt: clock.now(), endsAt: new Date(clock.now().getTime() + 7 * 86_400_000), days: [5, 6], hours: { start: '18:00', end: '23:00' } };
    const projection = { ordersPerWeek: 3, costPerOrderIqd: 1000, weeklyCostIqd: 3000, totalCostIqd: 3000, basisOrders: 12 };
    const d = await promotions.propose({ type: 'percent', value: 15, itemIds: ['i1'], schedule, minOrderIqd: 5000, budgetCapIqd: 50000, cityId: 'aziziyah', merchantOrgId, ownerId: personId, nameAr: 'عرض الويكند', projection, requireApproval: true });
    expect(d).toMatchObject({ state: 'pending_approval', projected: projection, schedule: { days: [5, 6], hours: { start: '18:00', end: '23:00' } }, minOrderIqd: 5000, budgetCapIqd: 50000 });
    expect((await promotions.review(d.dealId, true, otherId)).state).toBe('approved');
    expect((await promotions.list(merchantOrgId)).map((x) => x.dealId)).toEqual([d.dealId]);

    const responses = new PrismaMerchantAdminRepository(prisma);
    await responses.upsertResponse({ orderId: `ord_${run}`, merchantOrgId, decision: 'contest', note: 'x', evidenceRefs: ['up_1'], respondedById: personId, at });
    await responses.upsertResponse({ orderId: `ord_${run}`, merchantOrgId, decision: 'accept_default', note: null, evidenceRefs: [], respondedById: personId, at: new Date(at.getTime() + 60_000) });
    expect((await responses.responses([`ord_${run}`])).map((r) => [r.decision, r.evidenceRefs])).toEqual([['accept_default', []]]);
  });
});
