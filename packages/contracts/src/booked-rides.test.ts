import { describe, expect, it } from 'vitest';
import { bookedFavouriteUntil, bookedRideWindow } from './booked-rides.js';
import { BookedRidesConfig } from './city-config.js';
import { AZIZIYAH_MONEY_RULES, bookedFallbackCompensationIqd, MoneyRules } from './ledger-rules.js';
import { atLocal } from './ride-habits-io.js';

const cfg = BookedRidesConfig.parse({});
/** A Baghdad wall-clock time: `at('2026-10-08', '05:00')`. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return atLocal(date, h * 60 + m);
};

describe('bookedRideWindow (review #28)', () => {
  it('a ride tomorrow booked in the afternoon is offered from 18:00 and confirmed by 22:00 tonight', () => {
    expect(bookedRideWindow(at('2026-10-08', '05:00'), at('2026-10-07', '14:00'), cfg)).toEqual({ kind: 'evening_before', offerAt: at('2026-10-07', '18:00'), confirmBy: at('2026-10-07', '22:00') });
  });

  it('booked in the evening: offered at once, same 22:00 deadline', () => {
    expect(bookedRideWindow(at('2026-10-08', '05:00'), at('2026-10-07', '20:10'), cfg)).toEqual({ kind: 'evening_before', offerAt: at('2026-10-07', '20:10'), confirmBy: at('2026-10-07', '22:00') });
  });

  it('a ride days ahead waits for its own evening before', () => {
    expect(bookedRideWindow(at('2026-10-11', '07:30'), at('2026-10-07', '09:00'), cfg)).toEqual({ kind: 'evening_before', offerAt: at('2026-10-10', '18:00'), confirmBy: at('2026-10-10', '22:00') });
  });

  it('needs 30 minutes for drivers to answer: booked at 21:31 for tomorrow → none (search at T−30)', () => {
    expect(bookedRideWindow(at('2026-10-08', '09:00'), at('2026-10-07', '21:30'), cfg)).not.toBeNull();
    expect(bookedRideWindow(at('2026-10-08', '09:00'), at('2026-10-07', '21:31'), cfg)).toBeNull();
    expect(bookedRideWindow(at('2026-10-08', '05:00'), at('2026-10-07', '23:00'), cfg)).toBeNull();
  });

  it('same day, booked 3 hours ahead or more: offered at once, confirmed 90 minutes before', () => {
    expect(bookedRideWindow(at('2026-10-07', '18:00'), at('2026-10-07', '15:00'), cfg)).toEqual({ kind: 'same_day', offerAt: at('2026-10-07', '15:00'), confirmBy: at('2026-10-07', '16:30') });
    expect(bookedRideWindow(at('2026-10-07', '18:00'), at('2026-10-07', '15:01'), cfg)).toBeNull();
  });

  it('same day: never confirmed after 22:00, never asked before 08:00', () => {
    expect(bookedRideWindow(at('2026-10-07', '23:45'), at('2026-10-07', '10:00'), cfg)).toEqual({ kind: 'same_day', offerAt: at('2026-10-07', '10:00'), confirmBy: at('2026-10-07', '22:00') });
    expect(bookedRideWindow(at('2026-10-07', '12:00'), at('2026-10-07', '03:00'), cfg)).toEqual({ kind: 'same_day', offerAt: at('2026-10-07', '08:00'), confirmBy: at('2026-10-07', '10:30') });
    expect(bookedRideWindow(at('2026-10-07', '09:00'), at('2026-10-07', '03:00'), cfg)).toBeNull();
  });

  it('a city that confirms by 21:00 moves the deadline', () => {
    const early = BookedRidesConfig.parse({ confirmByHour: 21 });
    expect(bookedRideWindow(at('2026-10-08', '05:00'), at('2026-10-07', '14:00'), early)?.confirmBy).toEqual(at('2026-10-07', '21:00'));
  });
});

describe('bookedFavouriteUntil', () => {
  it('the favourite gets his hour, at most half the window', () => {
    expect(bookedFavouriteUntil({ offerAt: at('2026-10-07', '18:00'), confirmBy: at('2026-10-07', '22:00') }, cfg)).toEqual(at('2026-10-07', '19:00'));
    expect(bookedFavouriteUntil({ offerAt: at('2026-10-07', '21:00'), confirmBy: at('2026-10-07', '22:00') }, cfg)).toEqual(at('2026-10-07', '21:30'));
  });
});

describe('MoneyRules.bookedRideFallback (review #28 pickup compensation)', () => {
  it('is off with no amount until Ali sets it: nothing is paid', () => {
    expect(AZIZIYAH_MONEY_RULES.bookedRideFallback).toEqual({ enabled: false, pickupCompensationIqd: 0 });
    expect(bookedFallbackCompensationIqd(AZIZIYAH_MONEY_RULES)).toBe(0);
    expect(MoneyRules.parse({ ...AZIZIYAH_MONEY_RULES, bookedRideFallback: undefined }).bookedRideFallback.enabled).toBe(false);
  });

  it('pays the amount only once the city switches it on', () => {
    expect(bookedFallbackCompensationIqd({ bookedRideFallback: { enabled: false, pickupCompensationIqd: 750 } })).toBe(0);
    expect(bookedFallbackCompensationIqd({ bookedRideFallback: { enabled: true, pickupCompensationIqd: 750 } })).toBe(750);
  });
});
