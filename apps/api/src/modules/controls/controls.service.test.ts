import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import { AuditLogService, StaffNames } from './audit.js';
import { InMemoryControlsRepository } from './controls.repository.js';
import { ControlsService, daysBetween, loadState, throttleMessage } from './controls.service.js';

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

  it('the default refusal says when the service is back, and never "إن شاء الله" (K-13)', async () => {
    const h = await harness();
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'vertical', key: 'food', active: true, holdDispatch: false, reason: 'مطر', expiresAt: new Date('2026-10-04T20:30:00Z') });
    await expect(h.svc.assertOrderAllowed(gate())).rejects.toMatchObject({ envelope: { message_ar: 'خدمة الأكل موقّفة لحد الساعة 11:30 م. جرّب بعدها' } });
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'vertical', key: 'food', active: false, holdDispatch: false, reason: 'خلص' });
    await h.svc.setSwitch(ALI, { cityId: 'aziziyah', scope: 'zone', key: 'zakur', active: true, holdDispatch: false, reason: 'حفريات' });
    await expect(h.svc.assertOrderAllowed(gate())).rejects.toMatchObject({ envelope: { message_ar: 'ما نگدر نخدم منطقة زاكور هسة. جرّب بعدين' } });
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

  it('daysBetween counts calendar days between two YYYY-MM-DD dates', () => {
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2026-11-13', '2026-11-27')).toBe(14);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('quiet days: by Baghdad date, every city or one city; cleared ones go; never in the past, at most 15 days', async () => {
    const h = await harness('2026-11-12T20:30:00Z'); // 23:30 Baghdad, 12 Nov
    expect(await h.svc.season({ cityId: 'aziziyah' })).toEqual({ quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null, kind: 'ordinary', accent: true, ramadan: null, homeCard: null });
    const q = await h.svc.setQuietDays(ALI, { cityId: null, startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء' });
    expect(q).toMatchObject({ active: false, setByName: 'علي', startsOn: '2026-11-13' });
    expect((await h.svc.season({ cityId: 'aziziyah' })).quiet).toBe(false);
    h.clock.advanceMinutes(31); // 00:01 Baghdad, 13 Nov
    expect(await h.svc.season({ cityId: 'aziziyah' })).toEqual({ quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: '2026-11-13', kind: 'quiet', accent: false, ramadan: null, homeCard: null });
    expect(await h.svc.isQuietDay(h.clock.now())).toBe(true);
    expect((await h.svc.quietDays())[0]).toMatchObject({ id: q.id, active: true });
    h.clock.set('2026-11-13T21:00:00Z'); // 00:00 Baghdad, 14 Nov
    expect((await h.svc.season({})).quiet).toBe(false);
    const kut = await h.svc.setQuietDays(ALI, { cityId: 'kut', startsOn: '2026-11-14', endsOn: '2026-11-15', label_ar: 'الكوت فقط' });
    expect((await h.svc.season({ cityId: 'aziziyah' })).quiet).toBe(false);
    expect((await h.svc.season({ cityId: 'kut' })).quietUntil).toBe('2026-11-15');
    await h.svc.clearQuietDays(ALI, { quietId: kut.id });
    expect((await h.svc.season({ cityId: 'kut' })).quiet).toBe(false);
    await expect(h.svc.setQuietDays(ALI, { startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'أمس' })).rejects.toMatchObject({ code: 'quiet_invalid' });
    await expect(h.svc.setQuietDays(ALI, { startsOn: '2026-11-14', endsOn: '2026-11-29', label_ar: 'طويل' })).rejects.toMatchObject({ code: 'quiet_invalid' });
    await expect(h.svc.clearQuietDays(ALI, { quietId: 'qd_none' })).rejects.toMatchObject({ code: 'quiet_not_found' });
    expect((await h.svc.audit({ cityId: 'kut', subjectKind: 'quiet', limit: 10 })).map((a) => a.action)).toEqual(['quiet.clear', 'quiet.set', 'quiet.set']);
  });

  it('J6 seasons: Ramadan is not a quiet day; its times reach the apps; ops correct a day; quiet days still list only quiet', async () => {
    const h = await harness('2027-01-20T09:00:00Z');
    const r = await h.svc.setSeason(ALI, { kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09', label_ar: 'شهر رمضان' });
    expect(r).toMatchObject({ kind: 'ramadan', celebrations: true, sounds: true, promos: true, accent: true, homeCard: true, shiaOffsetMin: null });
    expect(r.days).toHaveLength(31);
    expect(r.days[1]).toMatchObject({ day: '2027-02-08', sunni: { iftar: '17:39' }, shia: { iftar: '17:54' } });
    await expect(h.svc.setSeason(ALI, { kind: 'ramadan', startsOn: '2027-03-01', endsOn: '2027-03-10', label_ar: 'مكرر' })).rejects.toMatchObject({ code: 'season_overlap' });
    await expect(h.svc.setSeason(ALI, { kind: 'eid', startsOn: '2027-01-19', endsOn: '2027-01-20', label_ar: 'أمس' })).rejects.toMatchObject({ code: 'season_invalid' });

    h.clock.set('2027-02-08T09:00:00Z'); // 12:00 Baghdad, 8 Feb
    expect(await h.svc.isQuietDay(h.clock.now())).toBe(false);
    const s = await h.svc.season({ cityId: 'aziziyah', timetable: 'sunni' });
    expect(s).toMatchObject({ kind: 'ramadan', quiet: false, homeCard: { kind: 'ramadan', text_ar: null }, ramadan: { day: '2027-02-08', timetable: 'sunni' } });
    expect(s.ramadan?.iftarAt).toEqual(new Date('2027-02-08T14:39:00Z'));

    const fixed = await h.svc.setIftarTime(ALI, { seasonId: r.id, day: '2027-02-08', timetable: 'shia', time: '17:57' });
    expect(fixed.days[1]).toMatchObject({ shia: { iftar: '17:57', overridden: true }, sunni: { overridden: false } });
    expect((await h.svc.season({ timetable: 'shia' })).ramadan?.iftarAt).toEqual(new Date('2027-02-08T14:57:00Z'));
    expect(await h.svc.promoHold(new Date('2027-02-08T14:50:00Z'))).toEqual({ reason: 'iftar', until: new Date('2027-02-08T14:57:00Z') });
    const back = await h.svc.setIftarTime(ALI, { seasonId: r.id, day: '2027-02-08', timetable: 'shia', time: null });
    expect(back.days[1]?.shia).toMatchObject({ iftar: '17:54', overridden: false });
    await expect(h.svc.setIftarTime(ALI, { seasonId: r.id, day: '2027-03-10', timetable: 'shia', time: '18:20' })).rejects.toMatchObject({ code: 'season_invalid' });

    await h.svc.setQuietDays(ALI, { startsOn: '2027-02-26', endsOn: '2027-02-28', label_ar: 'ليالي العزاء' });
    expect((await h.svc.quietDays()).map((q) => q.label_ar)).toEqual(['ليالي العزاء']);
    expect((await h.svc.seasons()).map((q) => q.kind)).toEqual(['quiet', 'ramadan']);
    await h.svc.clearSeason(ALI, { seasonId: r.id });
    expect((await h.svc.season({})).ramadan).toBeNull();
    expect((await h.svc.audit({ subjectKind: 'season', limit: 10 })).map((a) => a.action)).toEqual(['season.clear', 'season.iftar', 'season.iftar', 'season.set']);
  });
});
