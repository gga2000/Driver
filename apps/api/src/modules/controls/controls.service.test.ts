import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import { AuditLogService, StaffNames } from './audit.js';
import { InMemoryControlsRepository } from './controls.repository.js';
import { ControlsService, loadState, throttleMessage } from './controls.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's1' };

async function harness(start = '2026-10-04T09:00:00Z') {
  const clock = new FakeClock(start);
  const ev = createInMemoryEvents({ clock });
  const repo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === 'p_ali' ? 'علي' : null])) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const audits = new AuditLogService(repo, names, clock);
  const orgs = new OrgsService(ev.events, clock);
  const kitchen = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'p_owner' });
  const svc = new ControlsService(repo, new ConfigService(), orgs, ev.events, audits, names, ev.uow, clock);
  const counts = new Map<string, number>();
  svc.bindActiveOrders(async () => counts);
  svc.registerCorridors([{ id: 'aziziyah_kut', name_ar: 'العزيزية ⇄ الكوت' }]);
  return { clock, ev, repo, svc, kitchen, counts };
}

const gate = (over: Partial<Parameters<ControlsService['assertOrderAllowed']>[0]> = {}) => ({
  cityId: 'aziziyah',
  vertical: 'food' as const,
  zones: ['street_30', 'zakur'],
  customerZone: 'zakur',
  merchantOrgId: null,
  scheduledFor: null,
  ...over,
});

describe('launch controls', () => {
  it('a switch that expires lets orders through again by itself, and the console sees it as off', async () => {
    const h = await harness();
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'zone', key: 'zakur', active: true, holdDispatch: false, reason: 'حفريات', expiresAt: new Date('2026-10-04T10:00:00Z') });
    await expect(h.svc.assertOrderAllowed(gate())).rejects.toMatchObject({ code: 'service_paused' });
    h.clock.advanceMinutes(61);
    await expect(h.svc.assertOrderAllowed(gate())).resolves.toBeUndefined();
    const view = await h.svc.view('aziziyah');
    expect(view.switches[0]).toMatchObject({ key: 'zakur', active: false, setByName: 'علي' });
    expect(view.zones.find((z) => z.zoneKey === 'zakur')).toMatchObject({ killed: false, state: 'ok' });
  });

  it('refuses unknown targets and past expiries; writes an event and an audit row per change', async () => {
    const h = await harness();
    await expect(h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'restaurant', key: 'org_nope', active: true, holdDispatch: false, reason: 'تجربة' })).rejects.toMatchObject({ code: 'control_invalid' });
    await expect(h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'corridor', key: 'aziziyah_basra', active: true, holdDispatch: false, reason: 'تجربة' })).rejects.toMatchObject({ code: 'control_invalid' });
    await expect(h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'vertical', key: 'food', active: true, holdDispatch: false, reason: 'تجربة', expiresAt: new Date('2026-10-04T08:00:00Z') })).rejects.toMatchObject({ code: 'control_invalid' });
    const on = await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'restaurant', key: h.kitchen.id, active: true, holdDispatch: true, reason: 'الفرن عطلان' });
    // Hold-dispatch only applies to vertical / zone switches: a restaurant switch drops the flag.
    expect(on).toMatchObject({ label_ar: 'مطعم خالد', holdDispatch: false, active: true });
    await expect(h.svc.assertOrderAllowed(gate({ merchantOrgId: h.kitchen.id }))).rejects.toMatchObject({ code: 'service_paused', envelope: { message_ar: 'مطعم خالد موقّف الطلبات مؤقتاً. جرّب مطعم ثاني' } });
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'food', zoneId: 'street_30' })).resolves.toBe(false);
    expect((await h.ev.events.forAggregate('ops_control', `aziziyah:restaurant:${h.kitchen.id}:*`)).map((e) => e.type)).toEqual(['ops.kill_switch_on']);
    expect(h.repo.auditRows.map((a) => a.action)).toEqual(['kill_switch.on']);
  });

  it('dispatch holds: a vertical switch everywhere, a zone switch only there (and only its vertical when limited)', async () => {
    const h = await harness();
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'zone', key: 'khamas', vertical: 'tuktuk', active: true, holdDispatch: true, reason: 'طريق ترابي' });
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'khamas' })).resolves.toBe(true);
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'food', zoneId: 'khamas' })).resolves.toBe(false);
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'centre' })).resolves.toBe(false);
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'vertical', key: 'taxi', active: true, holdDispatch: true, reason: 'عاصفة ترابية' });
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre' })).resolves.toBe(true);
    // A switch turned off never holds, whatever it said before.
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'vertical', key: 'taxi', active: false, holdDispatch: true, reason: 'هدأت' });
    await expect(h.svc.dispatchHeld({ cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre' })).resolves.toBe(false);
  });

  it('the throttle counts the customer zone only; a throttle on another zone or none at all never refuses', async () => {
    const h = await harness();
    await h.svc.setCapacity(ALI, { cityId: 'aziziyah', zoneKey: 'zakur', maxActive: 2, mode: 'refuse', etaMin: 15 });
    h.counts.set('zakur', 1);
    h.counts.set('street_30', 50);
    await expect(h.svc.assertOrderAllowed(gate())).resolves.toBeUndefined();
    h.counts.set('zakur', 2);
    await expect(h.svc.assertOrderAllowed(gate())).rejects.toMatchObject({ code: 'zone_at_capacity', envelope: { retryAfterSec: 900 } });
    await expect(h.svc.assertOrderAllowed(gate({ customerZone: null }))).resolves.toBeUndefined();
    const z = (await h.svc.view('aziziyah')).zones.find((x) => x.zoneKey === 'zakur')!;
    expect(z).toMatchObject({ active: 2, maxActive: 2, state: 'full' });
    await expect(h.svc.setCapacity(ALI, { cityId: 'aziziyah', zoneKey: 'atlantis', maxActive: 2, mode: 'refuse', etaMin: 15 })).rejects.toMatchObject({ code: 'control_invalid' });
  });

  it('honest refusal copy and gauge states', () => {
    expect(throttleMessage(15, 'refuse')).toBe('الطلبات هواية هسة بمنطقتك، جرّب بعد ربع ساعة');
    expect(throttleMessage(30, 'queue')).toBe('الطلبات هواية هسة بمنطقتك، جرّب بعد نص ساعة أو احجز طلبك لبعد نص ساعة ويوصلك بوقته');
    expect(throttleMessage(20, 'refuse')).toBe('الطلبات هواية هسة بمنطقتك، جرّب بعد 20 دقيقة');
    expect(loadState(null, 9, false)).toEqual({ load: 0, state: 'ok' });
    expect(loadState(10, 7, false)).toEqual({ load: 0.7, state: 'ok' });
    expect(loadState(10, 8, false)).toEqual({ load: 0.8, state: 'busy' });
    expect(loadState(10, 10, false)).toEqual({ load: 1, state: 'full' });
    expect(loadState(10, 3, true).state).toBe('off');
  });

  it('banners: most severe first, by audience and city, scheduled ones wait, cleared ones go; never longer than a day', async () => {
    const h = await harness();
    const exp = new Date('2026-10-04T15:00:00Z');
    await h.svc.setBanner(ALI, { severity: 'info', audiences: ['customer', 'merchant'], message_ar: 'عروض الافتتاح شغّالة', expiresAt: exp });
    const crit = await h.svc.setBanner(ALI, { cityId: 'aziziyah', severity: 'critical', audiences: ['customer'], message_ar: 'انقطاع بالشبكة، الطلبات متوقفة', expiresAt: exp });
    await h.svc.setBanner(ALI, { cityId: 'kut', severity: 'critical', audiences: ['merchant'], message_ar: 'الكوت فقط', expiresAt: exp });
    await h.svc.setBanner(ALI, { severity: 'warning', audiences: ['partner'], message_ar: 'بعد ساعة', startsAt: new Date('2026-10-04T10:00:00Z'), expiresAt: exp });
    expect((await h.svc.banner({ app: 'customer', cityId: 'aziziyah' }))?.id).toBe(crit.id);
    expect((await h.svc.banner({ app: 'merchant', cityId: 'aziziyah' }))?.message_ar).toBe('عروض الافتتاح شغّالة');
    expect(await h.svc.banner({ app: 'partner' })).toBeNull();
    h.clock.advanceMinutes(61);
    expect((await h.svc.banner({ app: 'partner' }))?.message_ar).toBe('بعد ساعة');
    await h.svc.clearBanner(ALI, { bannerId: crit.id });
    expect((await h.svc.banner({ app: 'customer', cityId: 'aziziyah' }))?.message_ar).toBe('عروض الافتتاح شغّالة');
    h.clock.set('2026-10-04T15:00:00Z');
    expect(await h.svc.banner({ app: 'customer' })).toBeNull();
    await expect(h.svc.setBanner(ALI, { severity: 'info', audiences: ['customer'], message_ar: 'طويل', expiresAt: new Date('2026-10-05T15:00:01Z') })).rejects.toMatchObject({ code: 'banner_invalid' });
    await expect(h.svc.clearBanner(ALI, { bannerId: 'bn_none' })).rejects.toMatchObject({ code: 'banner_not_found' });
  });
});
