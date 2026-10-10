import { describe, expect, it } from 'vitest';
import { DriverError, type Actor, type RoleKind } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import type { IdentityService } from '../identity/index.js';
import { MerchantService, type MerchantAreaPort, type MerchantEventsPort, type MerchantOrdersPort, type MerchantPeoplePort, type MerchantPhotosPort, type MerchantTripsPort } from '../merchant/index.js';
import { OrgsService } from '../orgs/index.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { OpsPickupSpotsService, PICKUP_SPOT_AUDIT } from './pickup-spots.service.js';

const HAIDER: Actor = { personId: 'p_haider', sessionId: 's1' };
const OWNER: Actor = { personId: 'p_owner', sessionId: 's2' };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * The Console's pickup-spot service over a real MerchantService (the owner's rules), a real in-memory
 * OrgsService and the real audit log; uploads belong to whoever is named in their id.
 */
async function setup() {
  const clock = new FakeClock('2026-10-07T09:00:00Z');
  const orgs = new OrgsService(undefined, clock);
  const khalid = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: OWNER.personId });
  const karim = await orgs.create({ type: 'grocer', name: 'أسواق كريم', cityId: 'aziziyah', ownerId: 'p_karim' });
  const elsewhere = await orgs.create({ type: 'restaurant', name: 'مطعم الكوت', cityId: 'kut', ownerId: 'p_kut' });
  const home = await orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_c' });

  const uploads = new Map([
    ['up_haider_window', HAIDER.personId],
    ['up_haider_door', HAIDER.personId],
    ['up_owner_window', OWNER.personId],
  ]);
  const removed: string[] = [];
  const photos: MerchantPhotosPort = {
    owns: async (id, personId) => uploads.get(id) === personId,
    readUrl: (id) => `/uploads/${id}?sig=x`,
    remove: async (id) => {
      removed.push(id);
      uploads.delete(id);
    },
  };
  const grants: Array<{ personId: string; kind: RoleKind; orgId: string | null }> = [{ personId: OWNER.personId, kind: 'merchant_owner', orgId: khalid.id }];
  const people: MerchantPeoplePort = {
    grants: async (personId) => grants.filter((g) => g.personId === personId).map((g) => ({ ...g, frozen: false })),
    hasRole: async (personId, kind, orgId) => grants.some((g) => g.personId === personId && g.kind === kind && (orgId === undefined || g.orgId === orgId)),
    courierFirstName: async () => null,
    courierVehicle: async () => null,
  };
  const recorded: Array<{ type: string; actorId: string; payload: Record<string, unknown> }> = [];
  const events: MerchantEventsPort = {
    record: async (type, actorId, _org, payload) => {
      recorded.push({ type, actorId, payload });
    },
  };
  const ordersPort: MerchantOrdersPort = { listActive: async () => [], deliveredByDropoffZone: async () => [] };
  const tripsPort: MerchantTripsPort = { activeForOrder: async () => null, lastPosition: async () => null };
  const area: MerchantAreaPort = { zones: async () => [], foodDeliveryFee: () => null, pausedZones: async () => new Set<string>() };
  const merchant = new MerchantService(ordersPort, tripsPort, people, orgs, { itemNames: async () => new Map() }, events, clock, new EtaService(new StraightLineRouter()), area, photos);

  const auditRepo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === HAIDER.personId ? 'حيدر' : null])) } as unknown as IdentityService;
  const audits = new AuditLogService(auditRepo, new StaffNames(identity, clock), clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const svc = new OpsPickupSpotsService(merchant, orgs, audits, catalog);
  return { clock, orgs, khalid, karim, elsewhere, home, merchant, catalog, svc, auditRepo, recorded, removed };
}

describe('OpsPickupSpotsService — Console › المطاعم (Ali 2026-10-07)', () => {
  it('lists the city’s restaurants and grocers by name, with how far each spot is set', async () => {
    const h = await setup();
    await h.merchant.setPickupSpot(OWNER, { merchantOrgId: h.khalid.id, note: 'الشباك اليسار', photoIds: ['up_owner_window'] });
    expect(await h.svc.stores(HAIDER, { cityId: 'aziziyah' })).toEqual([
      { merchantOrgId: h.karim.id, name: 'أسواق كريم', type: 'grocer', note: null, photos: 0, updatedAt: null, shopPhoto: false, dishes: 0, dishesNoPhoto: 0 },
      { merchantOrgId: h.khalid.id, name: 'مطعم خالد', type: 'restaurant', note: 'الشباك اليسار', photos: 1, updatedAt: h.clock.now(), shopPhoto: false, dishes: 0, dishesNoPhoto: 0 },
    ]);
  });

  it('k6 «للتكملة»: says whether the shop photo is up and how many dishes show no picture', async () => {
    const h = await setup();
    await h.catalog.saveStorefront({ orgId: h.khalid.id, cityId: 'aziziyah', nameAr: 'مطعم خالد', cuisineAr: 'مشويات', minOrderIqd: 0, photoUrl: 'upload:up_front' });
    const own = await h.catalog.addItem({ orgId: h.khalid.id, nameAr: 'تكة', priceIqd: 2500 });
    await h.catalog.replacePhoto(h.khalid.id, own.id, 'upload:up_tikka');
    const library = await h.catalog.addItem({ orgId: h.khalid.id, nameAr: 'كباب', priceIqd: 3000 });
    await h.catalog.replacePhoto(h.khalid.id, library.id, '/library/kebab-1.jpg', undefined, 'kebab');
    await h.catalog.addItem({ orgId: h.khalid.id, nameAr: 'شوربة', priceIqd: 1500 });
    await h.catalog.addItem({ orgId: h.karim.id, nameAr: 'صمون', priceIqd: 250 });
    const rows = await h.svc.stores(HAIDER, { cityId: 'aziziyah' });
    expect(rows.map((r) => [r.name, r.shopPhoto, r.dishes, r.dishesNoPhoto])).toEqual([
      ['أسواق كريم', false, 1, 1],
      ['مطعم خالد', true, 3, 1],
    ]);
  });

  it('field ops set the spot with their own photos; couriers get it, the store’s event and the audit say who', async () => {
    const h = await setup();
    expect(await h.svc.get(HAIDER, { merchantOrgId: h.khalid.id })).toEqual({ merchantOrgId: h.khalid.id, storeName: 'مطعم خالد', note: null, photos: [], canEdit: true, updatedAt: null, consoleEdit: null });
    const saved = await h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: '  من الشباك اليسار جنب باب المطبخ ', photoIds: ['up_haider_window'] });
    expect(saved).toMatchObject({
      storeName: 'مطعم خالد',
      note: 'من الشباك اليسار جنب باب المطبخ',
      photos: [{ id: 'up_haider_window', url: '/uploads/up_haider_window?sig=x' }],
      consoleEdit: { at: h.clock.now(), byName: 'حيدر' },
    });
    // The same spot the courier's job card reads.
    const courier = await h.merchant.courierPickupSpot(h.khalid.id, { courierId: 'k1', trip: { courierId: 'k1', acceptedAt: h.clock.now(), completedAt: null }, now: h.clock.now() });
    expect(courier?.note).toBe('من الشباك اليسار جنب باب المطبخ');
    expect(h.recorded.at(-1)).toEqual({ type: 'merchant.pickup_spot_set', actorId: HAIDER.personId, payload: { photos: 1, note: true, by: 'console' } });
    expect(h.auditRepo.auditRows).toEqual([
      expect.objectContaining({ cityId: 'aziziyah', actorId: HAIDER.personId, action: PICKUP_SPOT_AUDIT.action, subjectKind: 'store', subjectId: h.khalid.id, summaryAr: 'غيّر مكان الاستلام لـمطعم خالد', detail: { note: true, photos: 1 } }),
    ]);
  });

  it('keeps the owner’s rules: someone else’s upload is refused; dropped photos are deleted; empty clears', async () => {
    const h = await setup();
    await h.merchant.setPickupSpot(OWNER, { merchantOrgId: h.khalid.id, note: 'الشباك', photoIds: ['up_owner_window'] });
    // The owner's photo already on the spot may stay; a new one must be the caller's own.
    expect(await code(h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: null, photoIds: ['up_owner_window', 'up_missing'] }))).toBe('upload_invalid');
    const swapped = await h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: 'الشباك', photoIds: ['up_owner_window', 'up_haider_door'] });
    expect(swapped.photos.map((p) => p.id)).toEqual(['up_owner_window', 'up_haider_door']);
    const cleared = await h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: ' ', photoIds: [] });
    expect(cleared).toMatchObject({ note: null, photos: [], updatedAt: null, consoleEdit: { byName: 'حيدر' } });
    expect(h.removed).toEqual(['up_owner_window', 'up_haider_door']);
    expect(h.auditRepo.auditRows.at(-1)).toMatchObject({ summaryAr: 'شال مكان الاستلام من مطعم خالد', detail: { note: false, photos: 0 } });
  });

  it('an owner’s save after the Console’s takes the «changed from the Console» line away', async () => {
    const h = await setup();
    await h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: 'من الشباك', photoIds: [] });
    h.clock.advance(60_000);
    await h.merchant.setPickupSpot(OWNER, { merchantOrgId: h.khalid.id, note: 'من الباب الجانبي', photoIds: [] });
    expect(await h.svc.get(HAIDER, { merchantOrgId: h.khalid.id })).toMatchObject({ note: 'من الباب الجانبي', consoleEdit: null });
    // And an owner clearing it after a Console edit is the owner's word too.
    await h.svc.set(HAIDER, { merchantOrgId: h.khalid.id, note: 'من الشباك', photoIds: [] });
    h.clock.advance(60_000);
    await h.merchant.setPickupSpot(OWNER, { merchantOrgId: h.khalid.id, note: null, photoIds: [] });
    expect(await h.svc.get(HAIDER, { merchantOrgId: h.khalid.id })).toMatchObject({ note: null, consoleEdit: null });
  });

  it('only restaurants and grocers: a household or an unknown org is not a store', async () => {
    const h = await setup();
    expect(await code(h.svc.get(HAIDER, { merchantOrgId: h.home.id }))).toBe('org_not_found');
    expect(await code(h.svc.set(HAIDER, { merchantOrgId: 'org_missing', note: 'x', photoIds: [] }))).toBe('org_not_found');
    expect(h.auditRepo.auditRows).toEqual([]);
  });
});
