import { describe, expect, it } from 'vitest';
import {
  addLocalName,
  amountInput,
  amountProblem,
  baghdadClock,
  baghdadDate,
  canConfirmCash,
  dueOf,
  emptyDraft,
  nearestZone,
  onboardingInput,
  parseAmount,
  photosKey,
  pressKey,
  quickAmounts,
  stepReady,
  zoneOptions,
  canHandOver,
  dishesKey,
  shootProgress,
  visitChoices,
  visitDay,
} from './logic';

describe('hand-over code pad', () => {
  it('fills four digits and deletes the last', () => {
    let code = '';
    for (const k of ['4', '0', '7', '1', '9'] as const) code = pressKey(code, k);
    expect(code).toBe('4071');
    expect(pressKey(code, 'del')).toBe('407');
    expect(pressKey('', 'del')).toBe('');
  });

  it('only confirms a valid amount with the full code', () => {
    expect(canConfirmCash(25_000, 45_000, '4071')).toBe(true);
    expect(canConfirmCash(25_000, 45_000, '407')).toBe(false);
    expect(canConfirmCash(50_000, 45_000, '4071')).toBe(false);
    expect(canConfirmCash(0, 45_000, '4071')).toBe(false);
  });
});

describe('amounts', () => {
  it('reads what people type, Arabic digits and commas included', () => {
    expect(parseAmount('25,000')).toBe(25_000);
    expect(parseAmount('٢٥٠٠٠')).toBe(25_000);
    expect(parseAmount('')).toBe(0);
    expect(amountInput('45000')).toBe('45,000');
    expect(amountInput('abc')).toBe('');
  });

  it('flags an empty amount or more than he holds', () => {
    expect(amountProblem(0, 10_000)).toBe('empty');
    expect(amountProblem(12_000, 10_000)).toBe('over');
    expect(amountProblem(10_000, 10_000)).toBeNull();
  });

  it('offers the full amount then round sums below it', () => {
    expect(quickAmounts(45_000)).toEqual([45_000, 25_000, 10_000]);
    expect(quickAmounts(120_000)).toEqual([120_000, 100_000, 50_000]);
    expect(quickAmounts(8_000)).toEqual([8_000]);
  });
});

describe('receipt clock', () => {
  it('prints Baghdad time and date', () => {
    const at = new Date('2026-10-03T18:42:00Z');
    expect(baghdadClock(at)).toBe('9:42 م');
    expect(baghdadClock(new Date('2026-10-03T05:05:00Z'))).toBe('8:05 ص');
    expect(baghdadClock(at, 'en')).toBe('9:42 PM');
    expect(baghdadDate(at)).toBe('3/10/2026');
  });
});

describe('tasks', () => {
  it('labels due dates on the Baghdad calendar', () => {
    const now = new Date('2026-10-03T09:00:00Z');
    expect(dueOf(null, now)).toBeNull();
    expect(dueOf(new Date('2026-10-03T08:00:00Z'), now)).toBe('overdue');
    expect(dueOf(new Date('2026-10-03T19:00:00Z'), now)).toBe('today');
    expect(dueOf(new Date('2026-10-04T09:00:00Z'), now)).toBe('tomorrow');
    expect(dueOf(new Date('2026-10-07T09:00:00Z'), now)).toBeNull();
  });

  it('counts photos in Iraqi agreement', () => {
    expect([0, 1, 3, 12].map(photosKey)).toEqual(['partner.ops_photos_zero', 'partner.ops_photos_one', 'partner.ops_photos_few', 'partner.ops_photos_many']);
  });
});

describe('zones', () => {
  it('lists the 34 zones with Western digits and finds the zone of a fix', () => {
    const zones = zoneOptions();
    expect(zones).toHaveLength(34);
    expect(zones.find((z) => z.id === 'street_30')?.name).toBe('شارع 30');
    expect(nearestZone({ lat: 32.905, lng: 45.06 })).toBe('centre');
    expect(nearestZone({ lat: 32.887, lng: 45.0765 })).toBe('zakur');
    expect(nearestZone({ lat: 33.3, lng: 44.4 })).toBeNull();
  });
});

describe('merchant onboarding wizard', () => {
  it('gates each step and builds the API input', () => {
    const d = emptyDraft();
    expect(stepReady('shop', d)).toBe(false);
    d.name = 'مطعم الريف';
    expect(stepReady('shop', d)).toBe(true);
    d.contactName = 'أبو حسن';
    d.contactPhone = '0780 000 0123';
    expect(stepReady('contact', d)).toBe(true);
    expect(stepReady('location', d)).toBe(false);
    d.zoneKey = 'hashimi';
    d.menuPhotos = [{ uri: 'blob:1', uploadId: null }];
    expect(stepReady('menu', d)).toBe(false);
    d.menuPhotos = [{ uri: 'blob:1', uploadId: 'up_1' }];
    expect(stepReady('review', d)).toBe(true);
    expect(onboardingInput(d)).toEqual({
      cityId: 'aziziyah',
      name: 'مطعم الريف',
      type: 'restaurant',
      contact: { name: 'أبو حسن', phone: '+9647800000123' },
      location: { zoneKey: 'hashimi' },
      menuPhotoUploadIds: ['up_1'],
      settlementMode: 'nightly_courier',
    });
  });

  it('refuses a bad phone number', () => {
    const d = { ...emptyDraft(), name: 'محل', contactName: 'x', contactPhone: '123' };
    expect(stepReady('contact', d)).toBe(false);
  });
});

describe('landmark local names', () => {
  it('trims, de-duplicates and caps at five', () => {
    let names: string[] = [];
    for (const n of ['  يم الجامع ', 'يم الجامع', 'صوب الكراج', '', 'a', 'b', 'c', 'd']) names = addLocalName(names, n);
    expect(names).toEqual(['يم الجامع', 'صوب الكراج', 'a', 'b', 'c']);
  });
});

describe('menu photo service', () => {
  it('offers in an hour, this afternoon while ahead, and tomorrow morning and afternoon (Baghdad time)', () => {
    // 10:07 Baghdad.
    const morning = visitChoices(new Date('2026-10-07T07:07:00Z'));
    expect(morning.map((c) => [c.key, c.at.toISOString()])).toEqual([
      ['in_hour', '2026-10-07T08:15:00.000Z'],
      ['today_afternoon', '2026-10-07T13:00:00.000Z'],
      ['tomorrow_morning', '2026-10-08T07:00:00.000Z'],
      ['tomorrow_afternoon', '2026-10-08T13:00:00.000Z'],
    ]);
    // 15:30 Baghdad: «اليوم العصر» is past an hour from now, so it drops.
    expect(visitChoices(new Date('2026-10-07T12:30:00Z')).map((c) => c.key)).toEqual(['in_hour', 'tomorrow_morning', 'tomorrow_afternoon']);
    // 23:30 Baghdad: "tomorrow" is the next Baghdad date, not the next UTC one.
    expect(visitChoices(new Date('2026-10-07T20:30:00Z')).find((c) => c.key === 'tomorrow_morning')?.at.toISOString()).toBe('2026-10-08T07:00:00.000Z');
  });

  it('names the visit day on the Baghdad calendar', () => {
    const now = new Date('2026-10-07T20:30:00Z'); // 23:30 Baghdad
    expect(visitDay(new Date('2026-10-07T20:45:00Z'), now)).toBe('today');
    expect(visitDay(new Date('2026-10-07T21:30:00Z'), now)).toBe('tomorrow'); // 00:30 Baghdad
    expect(visitDay(new Date('2026-10-09T07:00:00Z'), now)).toBe('other');
  });

  it('counts dishes the Iraqi way', () => {
    expect([0, 1, 2, 5, 12].map(dishesKey)).toEqual(['partner.ops_mp_dishes_zero', 'partner.ops_mp_dishes_one', 'partner.ops_mp_dishes_few', 'partner.ops_mp_dishes_few', 'partner.ops_mp_dishes_many']);
  });

  it('hands over only his scheduled visit with at least one photo', () => {
    const shot = { shotId: 's', itemId: 'a', photoUrl: '/f/a', state: 'proposed' as const, takenAt: new Date() };
    const dishes = [
      { itemId: 'a', nameAr: 'تكة', categoryAr: null, currentPhotoUrl: null, shot },
      { itemId: 'b', nameAr: 'كباب', categoryAr: null, currentPhotoUrl: null, shot: null },
    ];
    expect(shootProgress({ dishes })).toEqual({ shot: 1, total: 2 });
    expect(canHandOver({ dishes, canAct: true, state: 'scheduled' })).toBe(true);
    expect(canHandOver({ dishes, canAct: false, state: 'scheduled' })).toBe(false);
    expect(canHandOver({ dishes, canAct: true, state: 'shot' })).toBe(false);
    expect(canHandOver({ dishes: [dishes[1]!], canAct: true, state: 'scheduled' })).toBe(false);
  });
});
