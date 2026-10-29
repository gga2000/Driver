import { describe, expect, it } from 'vitest';
import { fromLocalM, type Actor, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { ConfigService } from '../config/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { PricingEngine } from '../pricing/index.js';
import { InMemoryZoneChecksRepository } from './zone-checks.repository.js';
import { InMemoryZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's1' };
const ORIGIN: LatLng = { lat: 32.905, lng: 45.06 };
const square = (side: number, dx = 0, dy = 0): LatLng[] =>
  [{ x: dx, y: dy }, { x: dx + side, y: dy }, { x: dx + side, y: dy + side }, { x: dx, y: dy + side }].map((q) => fromLocalM(q, ORIGIN));
const middle = (side: number, dx = 0, dy = 0): LatLng => fromLocalM({ x: dx + side / 2, y: dy + side / 2 }, ORIGIN);

function harness(config?: ConfigService) {
  const clock = new FakeClock('2026-10-05T10:00:00Z');
  const ev = createInMemoryEvents({ clock });
  const audit = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === 'p_ali' ? 'علي' : null])) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const svc = new ZonesService(new InMemoryZonesRepository(), ev.events, new AuditLogService(audit, names, clock), names, ev.uow, clock, new InMemoryZoneChecksRepository(), config);
  return { svc, ev, audit };
}

describe('ZonesService', () => {
  it('lists the 34 zones as AI drafts with Western-digit names', async () => {
    const zones = await harness().svc.list('aziziyah');
    expect(zones).toHaveLength(34);
    expect(zones.find((z) => z.key === 'street_30')).toMatchObject({ name_ar: 'شارع 30', placement: 'draft', placedBy: null });
  });

  it('saves an outline: placed, by whom, audited, evented', async () => {
    const h = harness();
    const v = await h.svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(600), centre: middle(600) });
    expect(v).toMatchObject({ key: 'centre', placement: 'placed', placedBy: 'علي', placedAt: new Date('2026-10-05T10:00:00Z') });
    expect(v.areaM2).toBeGreaterThan(355_000);
    expect(h.audit.auditRows.map((a) => a.action)).toEqual(['zone.placed']);
    expect((await h.ev.events.forAggregate('zone', 'aziziyah:centre')).map((e) => e.type)).toEqual(['zone.placed']);
  });

  it('refuses unknown zones and broken outlines', async () => {
    const { svc } = harness();
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'atlantis', ring: square(600), centre: middle(600) })).rejects.toMatchObject({ code: 'zone_unknown' });
    const [a, b, c, d] = square(600) as [LatLng, LatLng, LatLng, LatLng];
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: [a, c, b, d], centre: middle(600) })).rejects.toMatchObject({ code: 'zone_shape_invalid' });
  });

  it('refuses overlapping a placed neighbour, not an AI draft, and ignores its own old outline', async () => {
    const { svc } = harness();
    await svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(600), centre: middle(600) });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'street_30', ring: square(600, 300), centre: middle(600, 300) })).rejects.toMatchObject({ code: 'zone_overlap' });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'street_30', ring: square(600, 600), centre: middle(600, 600) })).resolves.toMatchObject({ placement: 'placed' });
    await expect(svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(590), centre: middle(590) })).resolves.toMatchObject({ placement: 'placed' });
  });

  it('moves an area to another group: audited with both groups, and its fees follow at once', async () => {
    const config = new ConfigService();
    const h = harness(config);
    await h.svc.syncTiers();
    const food = (to: string) =>
      new PricingEngine(() => 'q').quote({ cityId: 'aziziyah', vertical: 'food', stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: to, type: 'dropoff' }], options: { frontSeat: false, doorPickup: false, streetHandover: false, waitMinutes: 0, promoIqd: 0 } } as never, config.city('aziziyah')!)
        .components.find((c) => c.key === 'base')!.amount;
    expect(food('hashimi')).toBe(500);
    const v = await h.svc.setTier(ALI, { cityId: 'aziziyah', key: 'hashimi', tier: 'mid' });
    expect(v).toMatchObject({ key: 'hashimi', tier: 'mid' });
    expect(food('hashimi')).toBe(1000);
    expect(h.audit.auditRows.map((a) => [a.action, a.summaryAr])).toEqual([['zone.tier_set', 'نقل الهاشمي من «قريب» إلى «متوسط»']]);
    expect((await h.ev.events.forAggregate('zone', 'aziziyah:hashimi')).map((e) => e.type)).toEqual(['zone.tier_set']);
    // the same group again changes nothing and logs nothing
    await h.svc.setTier(ALI, { cityId: 'aziziyah', key: 'hashimi', tier: 'mid' });
    expect(h.audit.auditRows).toHaveLength(1);
  });

  it('keeps edge areas fixed and unknown areas refused; shows each group\'s fee from the centre', async () => {
    const config = new ConfigService();
    const { svc } = harness(config);
    const edge = (await svc.list('aziziyah')).find((z) => z.tier === 'edge');
    if (edge) await expect(svc.setTier(ALI, { cityId: 'aziziyah', key: edge.key, tier: 'far' })).rejects.toMatchObject({ code: 'zone_tier_edge_fixed' });
    await expect(svc.setTier(ALI, { cityId: 'aziziyah', key: 'atlantis', tier: 'far' })).rejects.toMatchObject({ code: 'zone_unknown' });
    expect(svc.tierFares('aziziyah').map((f) => [f.tier, f.deliveryIqd])).toEqual([['centre', 500], ['near', 500], ['mid', 1000], ['far', 1500], ['edge', 2000]]);
  });

  it('dry run: a pin the drawn outline holds is placed there, and it moves no fee or outline', async () => {
    const h = harness();
    await h.svc.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: square(600), centre: middle(600) });
    const inside = middle(600);
    h.svc.attachPinSource({ recentDropoffPins: async () => [inside, { lat: 32.5, lng: 44.0 }] });
    const before = await h.svc.list('aziziyah');
    const r = await h.svc.pinCheck('aziziyah');
    expect(r).toMatchObject({ pins: 2, drawnZones: 1 });
    expect(r.moves.every((m) => m.toKey === 'centre')).toBe(true);
    expect(await h.svc.list('aziziyah')).toEqual(before);
  });

  it('dry run without a pin source reports nothing to compare', async () => {
    expect(await harness().svc.pinCheck('aziziyah')).toMatchObject({ pins: 0, changed: 0, moves: [] });
  });
});
