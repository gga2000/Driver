import { describe, expect, it } from 'vitest';
import type { ZoneCapacityView } from '@driver/contracts';
import type { ControlsView, KillSwitchView } from '@driver/contracts';
import { ageLabel, bullet, cashLevel, dayBars, defaultRefusal, expiryAt, fileUrl, gaugePct, matrixCell, merchantWords, metricTone, nextAfter, owedWords, refundChips, slaClock, sortZones, throttlePreview, waitLabel, wallStale } from './control-room';

const z = (zoneKey: string, over: Partial<ZoneCapacityView>): ZoneCapacityView => ({
  zoneKey,
  name_ar: zoneKey,
  tier: 'near',
  maxActive: null,
  mode: 'refuse',
  etaMin: 15,
  active: 0,
  load: 0,
  state: 'ok',
  killed: false,
  setBy: null,
  setAt: null,
  ...over,
});

describe('control room helpers (console)', () => {
  it('sorts zones that need eyes first: full, off, busy, capped by load, then by name', () => {
    const sorted = sortZones([
      z('b_free', {}),
      z('a_busy', { state: 'busy', maxActive: 10, active: 8, load: 0.8 }),
      z('c_full', { state: 'full', maxActive: 5, active: 5, load: 1 }),
      z('d_off', { state: 'off', killed: true }),
      z('e_capped', { maxActive: 10, active: 2, load: 0.2 }),
    ]).map((x) => x.zoneKey);
    expect(sorted).toEqual(['c_full', 'd_off', 'a_busy', 'e_capped', 'b_free']);
    expect(gaugePct({ maxActive: 4, active: 6 })).toBe(100);
    expect(gaugePct({ maxActive: null, active: 6 })).toBe(0);
  });

  it('switch expiries: fixed offsets and the next Baghdad midnight', () => {
    const now = new Date('2026-10-04T18:30:00Z'); // 21:30 Baghdad
    expect(expiryAt('none', now)).toBeUndefined();
    expect(expiryAt('30m', now)?.toISOString()).toBe('2026-10-04T19:00:00.000Z');
    expect(expiryAt('midnight', now)?.toISOString()).toBe('2026-10-04T21:00:00.000Z');
    expect(expiryAt('midnight', new Date('2026-10-04T21:30:00Z'))?.toISOString()).toBe('2026-10-05T21:00:00.000Z');
  });

  it('the customer-facing copy matches the API (refusals and the throttle)', () => {
    // K-13: with an end time the customer is told when it's back; never "إن شاء الله" in a time.
    expect(defaultRefusal('vertical', 'الأكل')).toBe('خدمة الأكل موقّفة هسة. جرّب بعدين');
    expect(defaultRefusal('zone', 'زاكور')).toBe('ما نگدر نخدم منطقة زاكور هسة. جرّب بعدين');
    expect(defaultRefusal('vertical', 'التكسي', new Date('2026-10-04T20:30:00Z'))).toBe('خدمة التكسي موقّفة لحد الساعة 11:30 م. جرّب بعدها');
    expect(defaultRefusal('restaurant', 'مطعم خالد', new Date('2026-10-04T19:00:00Z'))).toBe('مطعم خالد موقّف الطلبات لحد الساعة 10:00 م. جرّب مطعم ثاني');
    for (const s of ['vertical', 'zone', 'restaurant', 'corridor'] as const) expect(defaultRefusal(s, 'x', new Date())).not.toContain('إن شاء الله');
    expect(throttlePreview(15, 'refuse')).toBe('الطلبات هواية هسة بمنطقتك، جرّب بعد ربع ساعة');
    expect(throttlePreview(30, 'queue')).toBe('الطلبات هواية هسة بمنطقتك، جرّب بعد نص ساعة أو احجز طلبك لبعد نص ساعة ويوصلك بوقته');
    expect(waitLabel(20)).toBe('20 دقيقة');
  });

  it('SLA clocks, ages and refund chips', () => {
    const now = new Date('2026-10-04T18:30:00Z');
    expect(slaClock({ slaDueAt: new Date('2026-10-04T21:00:00Z'), slaState: 'ok', status: 'open' }, now)).toEqual({ text: 'باقي 2 س 30 د', tone: 'neutral' });
    expect(slaClock({ slaDueAt: new Date('2026-10-04T19:00:00Z'), slaState: 'due_soon', status: 'open' }, now)).toEqual({ text: 'باقي 30 د', tone: 'warn' });
    expect(slaClock({ slaDueAt: new Date('2026-10-04T18:00:00Z'), slaState: 'breached', status: 'waiting' }, now)).toEqual({ text: 'متأخرة 30 د', tone: 'bad' });
    expect(slaClock({ slaDueAt: now, slaState: 'met', status: 'resolved' }, now).text).toBe('انحلّت بوقتها');
    expect(ageLabel(new Date('2026-10-04T18:20:00Z'), now)).toBe('قبل 10 د');
    expect(ageLabel(new Date('2026-10-02T18:20:00Z'), now)).toBe('قبل 2 يوم');
    expect(refundChips(5500)).toEqual([1000, 2000, 5000]);
  });

  it('photo URLs resolve against the API origin; wall tones and bars', () => {
    expect(fileUrl('/files/up_1?exp=1&sig=a', 'http://127.0.0.1:3395/trpc')).toBe('http://127.0.0.1:3395/files/up_1?exp=1&sig=a');
    expect(fileUrl('https://cdn.example/x.jpg', 'http://127.0.0.1:3395/trpc')).toBe('https://cdn.example/x.jpg');
    expect([metricTone({ ok: true }), metricTone({ ok: false }), metricTone({ ok: null })]).toEqual(['ok', 'bad', 'pending']);
    expect(dayBars([{ orders: 0 }, { orders: 10 }, { orders: 5 }])).toEqual([0, 100, 50]);
  });

  it('the zone × service matrix: own switch, whole zone, city-wide service', () => {
    const sw = (over: Partial<KillSwitchView>): KillSwitchView => ({ id: 's', cityId: 'aziziyah', scope: 'zone', key: 'zakur', label_ar: 'زاكور', vertical: null, active: true, holdDispatch: false, message_ar: null, reason: 'x', setBy: 'p', setByName: null, setAt: new Date(), expiresAt: null, ...over });
    const view: Pick<ControlsView, 'switches' | 'verticals'> = {
      switches: [sw({ id: 'a', key: 'khamas', vertical: 'taxi' }), sw({ id: 'b', key: 'zakur' }), sw({ id: 'c', key: 'centre', vertical: 'food', active: false })],
      verticals: [
        { key: 'food', label_ar: 'الأكل', killed: false },
        { key: 'parcel', label_ar: 'الطرود', killed: true },
      ],
    };
    expect(matrixCell(view, 'khamas', 'taxi')).toMatchObject({ state: 'off', sw: { id: 'a' } });
    expect(matrixCell(view, 'khamas', 'food').state).toBe('on');
    expect(matrixCell(view, 'khamas', null).state).toBe('on');
    expect(matrixCell(view, 'zakur', null)).toMatchObject({ state: 'off', sw: { id: 'b' } });
    expect(matrixCell(view, 'zakur', 'food').state).toBe('zone');
    expect(matrixCell(view, 'centre', 'food').state).toBe('on'); // switched back
    expect(matrixCell(view, 'centre', 'parcel').state).toBe('city');
  });

  it('money in words (K-16) and cash levels by the money spec (70 % amber, 90 % red)', () => {
    expect(owedWords(52_000)).toBe('لازم يسلّم 52,000 دينار');
    expect(owedWords(-2_000)).toBe('له 2,000 دينار');
    expect(owedWords(0)).toBe('ماكو حساب');
    expect(merchantWords(120_000)).toBe('للمطعم 120,000 دينار');
    expect(merchantWords(-4_250)).toBe('على المطعم 4,250 دينار');
    expect([cashLevel(0.5, false), cashLevel(0.7, false), cashLevel(0.92, false), cashLevel(0.4, true)]).toEqual(['ok', 'near', 'edge', 'over']);
  });

  it('wall bullets, staleness and the next approval after a decision', () => {
    expect(bullet('median_delivery', 31)).toEqual({ value: 52, target: 58 });
    expect(bullet('ledger', 0)).toBeNull();
    expect(bullet('acceptance', null)).toBeNull();
    expect(wallStale(1_000, 1_000 + 119_000)).toBe(false);
    expect(wallStale(1_000, 1_000 + 121_000)).toBe(true);
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextAfter(items, 'b')?.id).toBe('c');
    expect(nextAfter(items, 'c')?.id).toBe('b');
    expect(nextAfter([{ id: 'a' }], 'a')).toBeNull();
  });
});
