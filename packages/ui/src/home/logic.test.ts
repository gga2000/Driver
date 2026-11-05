import { describe, expect, it } from 'vitest';
import { liveAge, liveLabel, mealKey, mealWindow, panelMinutes, panelMode, stepsA11y, trackerSteps, riverFill } from './logic';
import { SLOT, splitSlot } from './format';

/** A Baghdad wall-clock time on Thursday 2026-11-05 (UTC+3). */
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 5, h - 3, m));

describe('the meal windows for offers (Ali, 2026-11-02: lunch 12–3, dinner 7–11)', () => {
  it('lunch runs 12:00 to 14:59 on the city clock', () => {
    expect(mealWindow(at(11, 59))).toBeNull();
    expect(mealWindow(at(12))).toBe('lunch');
    expect(mealWindow(at(14, 59))).toBe('lunch');
    expect(mealWindow(at(15))).toBeNull();
  });
  it('dinner runs 19:00 to 22:59', () => {
    expect(mealWindow(at(18, 59))).toBeNull();
    expect(mealWindow(at(19))).toBe('dinner');
    expect(mealWindow(at(22, 59))).toBe('dinner');
    expect(mealWindow(at(23))).toBeNull();
  });
  it('a meal key names the day and the meal, so seeing today\'s lunch offers says nothing about dinner', () => {
    expect(mealKey(at(13))).toBe('2026-11-05:lunch');
    expect(mealKey(at(20))).toBe('2026-11-05:dinner');
    expect(mealKey(at(16))).toBeNull();
  });
});

describe('which panel sits under the map', () => {
  const base = { running: false, offers: 3, seenMeal: null as string | null };
  it('anything running wins, at any hour, offers or not', () => {
    expect(panelMode({ ...base, running: true, now: at(13) })).toBe('order');
    expect(panelMode({ ...base, running: true, now: at(4) })).toBe('order');
  });
  it('offers at a meal time when at least one exists', () => {
    expect(panelMode({ ...base, now: at(13) })).toBe('offers');
    expect(panelMode({ ...base, now: at(20) })).toBe('offers');
  });
  it('calm at a meal time with no offers', () => {
    expect(panelMode({ ...base, offers: 0, now: at(13) })).toBe('calm');
  });
  it('calm outside the meal times, even with offers', () => {
    expect(panelMode({ ...base, now: at(10) })).toBe('calm');
    expect(panelMode({ ...base, now: at(17) })).toBe('calm');
  });
  it('calm again once this meal\'s offers were seen and scrolled past; the next meal brings them back', () => {
    expect(panelMode({ ...base, seenMeal: '2026-11-05:lunch', now: at(14) })).toBe('calm');
    expect(panelMode({ ...base, seenMeal: '2026-11-05:lunch', now: at(20) })).toBe('offers');
    expect(panelMode({ ...base, seenMeal: '2026-11-04:lunch', now: at(13) })).toBe('offers');
  });
});

describe('the order steps', () => {
  it('done, now and next for each stage', () => {
    expect(trackerSteps('placed')).toEqual(['now', 'next', 'next', 'next']);
    expect(trackerSteps('preparing')).toEqual(['done', 'now', 'next', 'next']);
    expect(trackerSteps('on_way')).toEqual(['done', 'done', 'now', 'next']);
    expect(trackerSteps('arrived')).toEqual(['done', 'done', 'done', 'done']);
  });
  it('the river fills as the order moves forward and is full when it arrives', () => {
    expect(riverFill(null)).toBe(0);
    expect(riverFill('placed')).toBeCloseTo(0.25);
    expect(riverFill('on_way')).toBeCloseTo(0.75);
    expect(riverFill('arrived')).toBe(1);
  });
});

describe('the live tag says how old the update is', () => {
  it('now under 5 seconds, then seconds, then minutes', () => {
    expect(liveAge(2)).toEqual({ unit: 'now', n: 0 });
    expect(liveAge(8)).toEqual({ unit: 'sec', n: 8 });
    expect(liveAge(59)).toEqual({ unit: 'sec', n: 59 });
    expect(liveAge(61)).toEqual({ unit: 'min', n: 1 });
    expect(liveAge(600)).toEqual({ unit: 'min', n: 10, stale: true });
  });
  it('older than 2 minutes is stale', () => {
    expect(liveAge(119).stale).toBeFalsy();
    expect(liveAge(121).stale).toBe(true);
  });
});

describe('round 5: labels', () => {
  it('the live tag: offline first, then the town, stale, now, seconds, minutes', () => {
    expect(liveLabel(240, true, 'العزيزية')).toContain('ماكو انترنت');
    expect(liveLabel(undefined, false, 'العزيزية')).toContain('العزيزية');
    expect(liveLabel(200, false, 'العزيزية')).not.toContain('مباشر');
    expect(liveLabel(2, false, 'العزيزية')).toBe('مباشر · هسة');
    expect(liveLabel(8, false, 'العزيزية')).toContain('8');
  });
  it('the step row reads «خطوة n من 4», and the last step once it has arrived', () => {
    expect(stepsA11y(trackerSteps('preparing'))).toBe('خطوة 2 من 4: دا يتحضّر');
    expect(stepsA11y(trackerSteps('arrived'))).toBe('خطوة 4 من 4: وصل');
  });
  it('panel minutes are whole and never negative', () => {
    expect([panelMinutes(-3), panelMinutes(4.6), panelMinutes(12)]).toEqual([0, 5, 12]);
  });
});

describe('round 6: the price slot', () => {
  it('splits a line around the slot, and keeps the price when a translation lost it', () => {
    expect(splitSlot(`مطعم خالد · ${SLOT} · 30 دقيقة`)).toEqual(['مطعم خالد · ', ' · 30 دقيقة']);
    const [before, after] = splitSlot('مطعم خالد');
    expect(before.startsWith('مطعم خالد ')).toBe(true);
    expect(after).toBe('');
  });
  it('no steps read as nothing, never a broken key', () => {
    expect(stepsA11y([])).toBe('');
  });
});
