import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { OrgsService } from './orgs.service.js';

function setup() {
  const clock = new FakeClock();
  const { events } = createInMemoryEvents({ clock });
  const orgs = new OrgsService(events, clock);
  const seen: string[] = [];
  events.subscribe('test:seen', '*', async (e) => {
    seen.push(e.type);
  });
  return { events, orgs, seen };
}

describe('households (domain §12)', () => {
  it('creator is the payer; members carry a role and a spending limit', async () => {
    const { orgs, events, seen } = setup();
    const home = await orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: 'p_ali' });
    expect(home.type).toBe('household');
    expect(home.members).toEqual([{ personId: 'p_ali', role: 'payer', spendingLimitIqd: null }]);
    await orgs.addMember(home.id, 'p_minar', { role: 'orderer', spendingLimitIqd: 25_000, actorId: 'p_ali' });
    const again = await orgs.addMember(home.id, 'p_minar', { role: 'orderer', spendingLimitIqd: 25_000 });
    expect(again.members).toHaveLength(2);
    expect(await orgs.withinLimit(home.id, 'p_minar', 25_000)).toBe(true);
    expect(await orgs.withinLimit(home.id, 'p_minar', 25_250)).toBe(false);
    expect(await orgs.withinLimit(home.id, 'p_ali', 1_000_000)).toBe(true);
    // Events commit with the change: nothing left to settle.
    expect(seen).toEqual(['org.created', 'org.member_added']);
    expect(await events.pendingOutbox()).toBe(0);
    expect((await orgs.householdsOf('p_minar')).map((o) => o.id)).toEqual([home.id]);
  });

  it('requestPayerApproval emits org.payer_approval_requested once per order and the payer resolves it', async () => {
    const { orgs, seen } = setup();
    const home = await orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_ali' });
    await orgs.addMember(home.id, 'p_kid', { role: 'orderer', spendingLimitIqd: 10_000 });
    const req = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: 'p_kid', amountIqd: 18_000 });
    expect((await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: 'p_kid', amountIqd: 18_000 })).id).toBe(req.id);
    expect(req.payerId).toBe('p_ali');
    expect(req.state).toBe('pending');
    expect(await orgs.pendingApprovals(home.id)).toHaveLength(1);
    expect(seen.filter((t) => t === 'org.payer_approval_requested')).toHaveLength(1);
    await expect(orgs.resolvePayerApproval(req.id, 'p_kid', 'approved')).rejects.toThrow(DriverError);
    expect((await orgs.resolvePayerApproval(req.id, 'p_ali', 'approved')).state).toBe('approved');
    // A second answer changes nothing and records nothing.
    expect((await orgs.resolvePayerApproval(req.id, 'p_ali', 'declined')).state).toBe('approved');
    expect(seen.filter((t) => t === 'org.payer_approved' || t === 'org.payer_declined')).toEqual(['org.payer_approved']);
    expect(await orgs.pendingApprovals(home.id)).toHaveLength(0);
    await expect(orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_2', requestedBy: 'p_stranger', amountIqd: 1 })).rejects.toThrow(/household/);
  });

  it('a household without a payer cannot request approval', async () => {
    const { orgs } = setup();
    const home = await orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_ali' });
    await orgs.addMember(home.id, 'p_ali', { role: 'member' });
    await expect(orgs.requestPayerApproval({ orgId: home.id, orderId: 'o', requestedBy: 'p_ali', amountIqd: 5 })).rejects.toThrow(/payer/);
  });
});

describe('merchant settings', () => {
  it('patches only what is given; unknown orgs are org_not_found', async () => {
    const { orgs } = setup();
    const kebab = await orgs.create({ type: 'restaurant', name: 'كباب الزهراء', cityId: 'aziziyah', ownerId: 'p1' });
    expect(await orgs.merchantSettings(kebab.id)).toMatchObject({ autoAccept: false, pauseWindows: null, location: null, busyUntil: null, closed: null, printer: null });
    const at = new Date('2026-10-03T09:00:00Z');
    await orgs.setMerchantSettings(kebab.id, { location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } }, defaultPrepMin: 18 });
    await orgs.setMerchantSettings(kebab.id, { busyUntil: at, printer: { state: 'disconnected', name: 'XP-58', at } });
    await orgs.setMerchantSettings(kebab.id, { closed: { reason: 'sold_out', note: null, at } });
    expect(await orgs.merchantSettings(kebab.id)).toMatchObject({
      location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } },
      defaultPrepMin: 18,
      busyUntil: at,
      printer: { state: 'disconnected', name: 'XP-58', at },
      closed: { reason: 'sold_out', note: null, at },
    });
    await orgs.setMerchantSettings(kebab.id, { closed: null, busyUntil: null });
    expect(await orgs.merchantSettings(kebab.id)).toMatchObject({ closed: null, busyUntil: null, defaultPrepMin: 18 });
    await expect(orgs.merchantSettings('org_nope')).rejects.toMatchObject({ code: 'org_not_found' });
    expect(await orgs.find('org_nope')).toBeNull();
  });
});

describe('merchants (Console picker)', () => {
  it('lists the city’s restaurants and grocers by name, with their heartbeat; no households or fleets', async () => {
    const { orgs } = setup();
    const kebab = await orgs.create({ type: 'restaurant', name: 'كباب الزهراء', cityId: 'aziziyah', ownerId: 'p1' });
    const grocer = await orgs.create({ type: 'grocer', name: 'أسواق الأمانة', cityId: 'aziziyah', ownerId: 'p2' });
    await orgs.create({ type: 'restaurant', name: 'مطعم الكوت', cityId: 'kut', ownerId: 'p3' });
    await orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p4' });
    await orgs.create({ type: 'fleet', name: 'أسطول', cityId: 'aziziyah', ownerId: 'p5' });
    const at = new Date('2026-10-03T09:00:00Z');
    await orgs.heartbeat(kebab.id, at);
    expect(await orgs.merchants('aziziyah')).toEqual([
      { id: grocer.id, name: 'أسواق الأمانة', type: 'grocer', cityId: 'aziziyah', lastHeartbeatAt: null },
      { id: kebab.id, name: 'كباب الزهراء', type: 'restaurant', cityId: 'aziziyah', lastHeartbeatAt: at },
    ]);
    expect(await orgs.merchants('nowhere')).toEqual([]);
  });
});
