import { describe, expect, it } from 'vitest';
import {
  doorsOfTags,
  drinksOnly,
  FridayRule,
  HoursPreset,
  hoursPresetsFor,
  prepDefaultsFor,
  presetDays,
  presetProblems,
  setupProgress,
  tagsForDoors,
  type SetupFacts,
} from './merchant-setup-io.js';
import { doorOf } from './food-doors.js';
import { windowsFromDays } from './store-hours.js';

const NOTHING: SetupFacts = { kindsConfirmed: false, items: 0, pendingCards: 0, missingPhotos: 0, hoursSet: false, payoutSeen: false, pickupSet: false, practiced: false };
const ALL: SetupFacts = { kindsConfirmed: true, items: 26, pendingCards: 0, missingPhotos: 0, hoursSet: true, payoutSeen: true, pickupSet: true, practiced: true };
const PRAYER = { start: '11:45', end: '13:15' };

describe('setupProgress — the ring, the steps left and the minutes', () => {
  it('a new shop: 0 %, seven steps, about ten minutes, kind first', () => {
    const p = setupProgress(NOTHING);
    expect(p).toMatchObject({ percent: 0, done: 0, total: 7, left: 7, next: 'kind' });
    // 10 + 360 + 60 + 20 + 20 + 30 + 120 seconds.
    expect(p.minutesLeft).toBe(11);
  });

  it('field ops already did the menu and the pickup spot: 40 %, the menu weighs three', () => {
    const p = setupProgress({ ...NOTHING, items: 26, pickupSet: true, missingPhotos: 9 });
    expect(p.percent).toBe(40);
    expect(p.left).toBe(5);
    expect(p.steps.find((s) => s.key === 'photos')).toEqual({ key: 'photos', done: false, seconds: 90 });
    expect(p.next).toBe('kind');
  });

  it('cards waiting keep the menu open, 8 seconds a card', () => {
    const p = setupProgress({ ...ALL, pendingCards: 20 });
    expect(p.steps.find((s) => s.key === 'menu')).toEqual({ key: 'menu', done: false, seconds: 160 });
    expect(p.next).toBe('menu');
    expect(p.percent).toBe(70);
  });

  it('a menu with no dishes is never done, and neither are its photos', () => {
    const p = setupProgress({ ...ALL, items: 0 });
    expect(p.steps.filter((s) => !s.done).map((s) => s.key)).toEqual(['menu', 'photos']);
  });

  it('only a finished shop reads 100 and zero minutes', () => {
    expect(setupProgress(ALL)).toMatchObject({ percent: 100, left: 0, minutesLeft: 0, next: null });
    expect(setupProgress({ ...ALL, practiced: false }).percent).toBe(90);
  });
});

describe('what he sells — the four doors', () => {
  it('reads every door from field ops’ tags, neutral tags ignored', () => {
    expect(doorsOfTags(['grill', 'family'])).toEqual(['meal']);
    expect(doorsOfTags(['juice', 'ice_cream'])).toEqual(['cold', 'sweet']);
    expect(doorsOfTags(['new'])).toEqual([]);
  });

  it('writes tags the customer app places behind the right door', () => {
    expect(tagsForDoors(['cafe'], [])).toEqual(['cafe']);
    expect(doorOf(tagsForDoors(['cafe'], []))).toBe('cafe');
    // A meal kitchen keeps its own meal tags; adding sweets adds one tag.
    expect(tagsForDoors(['meal', 'sweet'], ['grill', 'kebab', 'family'])).toEqual(['grill', 'kebab', 'family', 'sweets']);
    // Unticking a door drops its tags.
    expect(tagsForDoors(['cold'], ['juice', 'cafe'])).toEqual(['juice']);
    expect(doorOf(tagsForDoors(['meal', 'cafe'], []))).toBe('meal');
  });

  it('drinks-only shops start quicker; anything with food keeps the usual times', () => {
    expect(drinksOnly(['cafe', 'cold'])).toBe(true);
    expect(drinksOnly(['cafe', 'sweet'])).toBe(false);
    expect(prepDefaultsFor(['cold'])).toEqual({ storeMinutes: 5, dishMinutes: 5 });
    expect(prepDefaultsFor(['meal', 'cafe'])).toBeNull();
    expect(prepDefaultsFor([])).toBeNull();
  });
});

describe('hours in one tap', () => {
  it('every ready schedule with every Friday rule saves cleanly (past midnight included)', () => {
    for (const preset of HoursPreset.options) for (const friday of FridayRule.options) expect(presetProblems(preset, friday, PRAYER)).toEqual([]);
  });

  it('lunch and dinner: 11 to midnight every day; Friday after the prayer starts when it ends', () => {
    const days = presetDays('lunch_dinner', 'after_prayer', PRAYER);
    expect(days[0]).toEqual({ dow: 0, shifts: [{ start: '11:00', end: '00:00' }] });
    expect(days[5]).toEqual({ dow: 5, shifts: [{ start: '13:15', end: '00:00' }] });
  });

  it('dinner runs past midnight and is untouched by the prayer', () => {
    const days = presetDays('dinner', 'after_prayer', PRAYER);
    expect(days[5]).toEqual({ dow: 5, shifts: [{ start: '17:00', end: '01:00' }] });
    // Saturday night runs into Sunday's small hours without overlapping Sunday.
    expect(windowsFromDays(days).filter((w) => w.dow === 6)).toEqual([{ dow: 6, start: '17:00', end: '01:00' }]);
  });

  it('breakfast on a Friday after the prayer is what is left after it; closed Friday has no shift', () => {
    expect(presetDays('breakfast_lunch', 'after_prayer', PRAYER)[5]).toEqual({ dow: 5, shifts: [{ start: '13:15', end: '15:00' }] });
    expect(presetDays('breakfast_lunch', 'closed', PRAYER)[5]).toEqual({ dow: 5, shifts: [] });
    expect(presetDays('breakfast_lunch', 'same', PRAYER)[5]).toEqual({ dow: 5, shifts: [{ start: '06:00', end: '15:00' }] });
    // No prayer window in the city: Friday is like the others.
    expect(presetDays('lunch_dinner', 'after_prayer', null)[5]).toEqual({ dow: 5, shifts: [{ start: '11:00', end: '00:00' }] });
  });

  it('a café is offered café hours first', () => {
    expect(hoursPresetsFor(['cafe'])[0]).toBe('afternoon_night');
    expect(hoursPresetsFor(['meal', 'cafe'])[0]).toBe('lunch_dinner');
    expect(hoursPresetsFor([])[0]).toBe('lunch_dinner');
  });
});
