import { describe, expect, it, vi } from 'vitest';
import { DriverError, type Actor, type RoleKind } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import type { IdentityService } from '../identity/index.js';
import type { OpsPickupSpotsService } from '../ops/index.js';
import { OrgsService } from '../orgs/index.js';
import { InMemoryPlacesRepository, PlacesService, ZoneResolver, type LandmarkFeedService } from '../places/index.js';
import { InMemoryMapEditorRepository } from './map-editor.repository.js';
import { findDuplicates, MapEditorService, sourceOf } from './map-editor.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's1' };
const YASIR: Actor = { personId: 'p_yasir', sessionId: 's2' };
const SAMI: Actor = { personId: 'p_sami', sessionId: 's3' };
const OWNER: Actor = { personId: 'p_owner', sessionId: 's4' };
const CITY = 'aziziyah';
const MOSQUE = { lat: 32.9045, lng: 45.0595 };
const NEAR_MOSQUE = { lat: 32.9047, lng: 45.0597 };
const SOUQ = { lat: 32.9021, lng: 45.0666 };
const FAR_AWAY = { lat: 33.4, lng: 44.4 };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** The editor over real in-memory places, orgs and audit log; the kitchen move is the stores' own rule in short. */
async function setup() {
  const clock = new FakeClock('2026-10-20T21:00:00Z');
  const uow = new UnitOfWork(new NoDatabaseRunner());
  const orgs = new OrgsService(undefined, clock, undefined, uow);
  const khalid = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: CITY, ownerId: OWNER.personId });
  await orgs.setMerchantSettings(khalid.id, { location: { zoneKey: 'centre', pin: SOUQ } });
  const places = new PlacesService(new InMemoryPlacesRepository());
  const invalidate = vi.fn();
  const feed = { invalidate } as unknown as LandmarkFeedService;
  const zones = new ZoneResolver();
  const moveKitchen = vi.fn(async (_a: Actor, input: { merchantOrgId: string; pin: { lat: number; lng: number } }) => {
    await orgs.setMerchantSettings(input.merchantOrgId, { location: { zoneKey: zones.resolve(CITY, input.pin) ?? 'centre', pin: input.pin } });
  });
  const pickupSpots = { moveKitchen } as unknown as OpsPickupSpotsService;
  const roles = new Map<string, RoleKind[]>([[YASIR.personId, ['courier']], [SAMI.personId, ['courier']], [OWNER.personId, ['merchant_owner']]]);
  const identity = {
    firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === ALI.personId ? 'علي' : null])),
    activeRoles: async (id: string) => roles.get(id) ?? [],
  } as unknown as IdentityService;
  const auditRepo = new InMemoryControlsRepository();
  const audits = new AuditLogService(auditRepo, new StaffNames(identity, clock), clock);
  const svc = new MapEditorService(places, feed, orgs, pickupSpots, audits, new StaffNames(identity, clock), identity, uow, new InMemoryMapEditorRepository(), clock);
  return { clock, orgs, khalid, places, svc, invalidate, moveKitchen, auditRepo };
}

describe('MapEditorService — Console › محرر الخريطة (Ali, 2026-10-20)', () => {
  it('shows the restaurants with their kitchen pins and the landmarks, the setup ones marked', async () => {
    const h = await setup();
    const layers = await h.svc.layers(ALI, { cityId: CITY });
    expect(layers.restaurants).toEqual([expect.objectContaining({ orgId: h.khalid.id, name: 'مطعم خالد', pin: SOUQ, zoneKey: 'centre' })]);
    const souq = layers.landmarks.find((l) => l.id === 'lm_garage_souq');
    expect(souq).toMatchObject({ seeded: true, hidden: false, category: 'garage' });
  });

  it('adds a landmark: on every map at once, in the history and the audit log', async () => {
    const h = await setup();
    const added = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'دوّار الساعة', aliases_ar: ['الساعة', 'دوّار الساعة'], category: 'other', pin: NEAR_MOSQUE });
    expect(added).toMatchObject({ name_ar: 'دوّار الساعة', aliases_ar: ['الساعة'], seeded: false, hidden: false });
    expect(h.invalidate).toHaveBeenCalledWith(CITY);
    const [edit] = await h.svc.history(ALI, { cityId: CITY, limit: 10 });
    expect(edit).toMatchObject({ action: 'add', summaryAr: 'ضاف «دوّار الساعة» على الخريطة', byName: 'علي', canUndo: true });
    expect((await h.auditRepo.audit({ limit: 5 })).map((a) => a.action)).toEqual(['map.landmark_add']);
  });

  it('refuses a pin outside the service area and leaves the setup landmarks as they are', async () => {
    const h = await setup();
    expect(await code(h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'بغداد', aliases_ar: [], category: 'other', pin: FAR_AWAY }))).toBe('outside_zone');
    expect(await code(h.svc.editLandmark(ALI, { cityId: CITY, id: 'lm_garage_souq', name_ar: 'كراج' }))).toBe('map_landmark_seeded');
    expect(await code(h.svc.editLandmark(ALI, { cityId: CITY, id: 'pl_nope', name_ar: 'x' }))).toBe('map_place_unknown');
  });

  it('renames, hides and undoes, newest first; an older change waits for the newer one', async () => {
    const h = await setup();
    const lm = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'جامع الرحمن', aliases_ar: [], category: 'mosque', pin: MOSQUE });
    await h.svc.editLandmark(ALI, { cityId: CITY, id: lm.id, name_ar: 'جامع الرحمة' });
    await h.svc.editLandmark(ALI, { cityId: CITY, id: lm.id, hidden: true });
    const history = await h.svc.history(ALI, { cityId: CITY, limit: 10 });
    expect(history.map((e) => [e.action, e.canUndo])).toEqual([['hide', true], ['edit', false], ['add', false]]);
    expect(await code(h.svc.undo(ALI, { cityId: CITY, editId: history[1]!.id }))).toBe('map_edit_stale');
    await h.svc.undo(ALI, { cityId: CITY, editId: history[0]!.id });
    await h.svc.undo(ALI, { cityId: CITY, editId: history[1]!.id });
    const back = (await h.svc.layers(ALI, { cityId: CITY })).landmarks.find((l) => l.id === lm.id);
    expect(back).toMatchObject({ name_ar: 'جامع الرحمن', hidden: false });
    expect((await h.svc.history(ALI, { cityId: CITY, limit: 10 })).map((e) => e.canUndo)).toEqual([false, false, true]);
  });

  it('an edit made the same way again changes nothing and writes no history', async () => {
    const h = await setup();
    const lm = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'فرن صبيح', aliases_ar: [], category: 'other', pin: MOSQUE });
    await h.svc.editLandmark(ALI, { cityId: CITY, id: lm.id, name_ar: 'فرن صبيح', pin: MOSQUE });
    expect(await h.svc.history(ALI, { cityId: CITY, limit: 10 })).toHaveLength(1);
  });

  it('moves several pins at once: a restaurant through the stores’ move, and undoes it while nobody moved it since', async () => {
    const h = await setup();
    const lm = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'صيدلية الشفاء', aliases_ar: [], category: 'clinic', pin: MOSQUE });
    const layers = await h.svc.movePins(ALI, { cityId: CITY, moves: [{ kind: 'landmark', id: lm.id, pin: NEAR_MOSQUE }, { kind: 'restaurant', id: h.khalid.id, pin: NEAR_MOSQUE }] });
    expect(h.moveKitchen).toHaveBeenCalledWith(ALI, { merchantOrgId: h.khalid.id, pin: NEAR_MOSQUE });
    expect(layers.restaurants[0]?.pin).toEqual(NEAR_MOSQUE);
    expect(layers.landmarks.find((l) => l.id === lm.id)?.pin).toEqual(NEAR_MOSQUE);
    const [restaurantMove] = await h.svc.history(ALI, { cityId: CITY, limit: 10 });
    expect(restaurantMove).toMatchObject({ kind: 'restaurant', action: 'move', canUndo: true });
    await h.svc.undo(ALI, { cityId: CITY, editId: restaurantMove!.id });
    expect((await h.orgs.get(h.khalid.id)).merchant?.location?.pin).toEqual(SOUQ);
  });

  it('a restaurant the owner moved since is not undone over his move', async () => {
    const h = await setup();
    await h.svc.movePins(ALI, { cityId: CITY, moves: [{ kind: 'restaurant', id: h.khalid.id, pin: NEAR_MOSQUE }] });
    await h.orgs.setMerchantSettings(h.khalid.id, { location: { zoneKey: 'centre', pin: MOSQUE } });
    const [move] = await h.svc.history(ALI, { cityId: CITY, limit: 10 });
    expect(await code(h.svc.undo(ALI, { cityId: CITY, editId: move!.id }))).toBe('map_edit_stale');
  });

  it('merges two landmarks that are one place: the copy is hidden, its name kept; undo brings it back', async () => {
    const h = await setup();
    const a = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'فرن علي صبيح', aliases_ar: [], category: 'other', pin: MOSQUE });
    const b = await h.svc.addLandmark(ALI, { cityId: CITY, name_ar: 'فرن صبيح', aliases_ar: [], category: 'other', pin: NEAR_MOSQUE });
    const dup = findDuplicates((await h.svc.layers(ALI, { cityId: CITY })).landmarks).find((d) => [d.keep.id, d.drop.id].sort().join() === [a.id, b.id].sort().join());
    expect(dup).toBeDefined();
    const kept = await h.svc.merge(ALI, { cityId: CITY, keepId: a.id, dropId: b.id });
    expect(kept.aliases_ar).toEqual(['فرن صبيح']);
    expect((await h.svc.layers(ALI, { cityId: CITY })).landmarks.find((l) => l.id === b.id)?.hidden).toBe(true);
    const [merge] = await h.svc.history(ALI, { cityId: CITY, limit: 10 });
    await h.svc.undo(ALI, { cityId: CITY, editId: merge!.id });
    const after = (await h.svc.layers(ALI, { cityId: CITY })).landmarks;
    expect(after.find((l) => l.id === b.id)?.hidden).toBe(false);
    expect(after.find((l) => l.id === a.id)?.aliases_ar).toEqual([]);
  });

  it('two couriers saying the same shop moved make one card; accepting moves it', async () => {
    const h = await setup();
    await h.svc.report(YASIR, { cityId: CITY, kind: 'moved', target: { kind: 'restaurant', id: h.khalid.id }, pin: MOSQUE, note: 'الباب بعد الإشارة' });
    await h.svc.report(SAMI, { cityId: CITY, kind: 'moved', target: { kind: 'restaurant', id: h.khalid.id }, pin: NEAR_MOSQUE });
    await h.svc.report(OWNER, { cityId: CITY, kind: 'new_place', pin: MOSQUE, name_ar: 'دوّار الساعة' });
    const inbox = await h.svc.inbox(ALI, { cityId: CITY });
    expect(inbox.counts).toMatchObject({ driver: 1, merchant: 1 });
    const card = inbox.cards[0]!;
    expect(card).toMatchObject({ kind: 'moved', reporters: 2, source: 'driver', target: { kind: 'restaurant', name: 'مطعم خالد' }, notes: ['الباب بعد الإشارة'] });
    expect(card.distanceM).toBeGreaterThan(500);
    const next = await h.svc.decide(ALI, { cityId: CITY, reportIds: card.reportIds, decision: 'accept' });
    expect(next.cards).toHaveLength(1);
    expect(h.moveKitchen).toHaveBeenCalledTimes(1);
    expect(await code(h.svc.decide(ALI, { cityId: CITY, reportIds: card.reportIds, decision: 'reject' }))).toBe('map_report_unknown');
  });

  it('the same courier saying the same shop moved twice is one report', async () => {
    const h = await setup();
    const a = await h.svc.report(YASIR, { cityId: CITY, kind: 'moved', target: { kind: 'restaurant', id: h.khalid.id }, pin: MOSQUE });
    const b = await h.svc.report(YASIR, { cityId: CITY, kind: 'moved', target: { kind: 'restaurant', id: h.khalid.id }, pin: NEAR_MOSQUE });
    expect(b.reportId).toBe(a.reportId);
    expect((await h.svc.inbox(ALI, { cityId: CITY })).cards[0]).toMatchObject({ reporters: 1 });
  });

  it('accepting a new place adds it as a landmark with the team’s correction', async () => {
    const h = await setup();
    const { reportId } = await h.svc.report(YASIR, { cityId: CITY, kind: 'new_place', pin: MOSQUE, name_ar: 'دوار الساعه' });
    await h.svc.decide(ALI, { cityId: CITY, reportIds: [reportId], decision: 'accept', name_ar: 'دوّار الساعة', pin: NEAR_MOSQUE });
    const added = (await h.svc.layers(ALI, { cityId: CITY })).landmarks.find((l) => l.name_ar === 'دوّار الساعة');
    expect(added?.pin).toEqual(NEAR_MOSQUE);
  });

  it('a report about a place that is not on the map, or too many open ones, is refused', async () => {
    const h = await setup();
    expect(await code(h.svc.report(YASIR, { cityId: CITY, kind: 'closed', target: { kind: 'landmark', id: 'pl_nope' } }))).toBe('map_place_unknown');
    for (let i = 0; i < 20; i += 1) await h.svc.report(YASIR, { cityId: CITY, kind: 'new_place', pin: MOSQUE, name_ar: `مكان ${i}` });
    expect(await code(h.svc.report(YASIR, { cityId: CITY, kind: 'new_place', pin: MOSQUE, name_ar: 'واحد بعد' }))).toBe('map_reports_limit');
  });

  it('files shops’ fixes under the shops and field ops under the road', () => {
    expect(sourceOf(['merchant_staff', 'courier'])).toBe('merchant');
    expect(sourceOf(['field_ops'])).toBe('ops');
    expect(sourceOf(['courier'])).toBe('driver');
  });
});
