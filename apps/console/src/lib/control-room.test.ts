import { describe, expect, it } from 'vitest';
import type { ZoneCapacityView } from '@driver/contracts';
import { ageLabel, dayBars, defaultRefusal, expiryAt, fileUrl, gaugePct, metricTone, refundChips, slaClock, sortZones, throttlePreview, waitLabel } from './control-room';

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
    expect(defaultRefusal('vertical', 'الأكل')).toBe('خدمة الأكل موقّفة مؤقتاً. نرجع قريب إن شاء الله');
    expect(defaultRefusal('zone', 'زاكور')).toBe('ما نگدر نخدم منطقة زاكور هسة. نرجع قريب إن شاء الله');
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
});
