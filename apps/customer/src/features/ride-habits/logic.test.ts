import { describe, expect, it } from 'vitest';
import type { FavouriteDriverView } from '@driver/contracts';
import { askingNow, corridorCity, daysLabel, defaultRemind, dinnerLine, favouritesFor, firstSlot, hourOptions, isBookedRide, minuteOptions, morningAllowed, occurrenceAction, scheduleAt, scheduleOk, settleChoice, toggleDay } from './logic';

// Wednesday 7 Oct 2026, 22:50 Baghdad.
const NOW = new Date('2026-10-07T19:50:00Z');

describe('booking a ride for later', () => {
  it('starts 20 minutes ahead on the quarter', () => {
    expect(firstSlot(NOW)).toEqual({ day: 0, hour: 23, minute: 15 });
    expect(firstSlot(new Date('2026-10-07T20:50:00Z'))).toEqual({ day: 1, hour: 0, minute: 15 });
  });
  it('lists only the hours and quarters the server takes', () => {
    expect(hourOptions(NOW, 0)).toEqual([23]);
    expect(minuteOptions(NOW, 0, 23)).toEqual([15, 30, 45]);
    expect(hourOptions(NOW, 1)).toHaveLength(24);
    expect(scheduleAt(NOW, { day: 1, hour: 7, minute: 30 }).toISOString()).toBe('2026-10-08T04:30:00.000Z');
    expect(scheduleOk(NOW, { day: 0, hour: 23, minute: 0 })).toBe(false);
  });
  it('moves an invalid choice onto a valid quarter', () => {
    expect(settleChoice(NOW, { day: 0, hour: 23, minute: 0 })).toEqual({ day: 0, hour: 23, minute: 15 });
    expect(settleChoice(NOW, { day: 0, hour: 7, minute: 30 })).toEqual({ day: 0, hour: 23, minute: 15 });
    expect(settleChoice(NOW, { day: 1, hour: 7, minute: 30 })).toEqual({ day: 1, hour: 7, minute: 30 });
  });
  it('a booked ride waits on its own screen until 15 minutes before', () => {
    const at = new Date('2026-10-08T04:30:00Z');
    expect(isBookedRide({ type: 'ride', state: 'placed', scheduledFor: at }, NOW)).toBe(true);
    expect(isBookedRide({ type: 'ride', state: 'placed', scheduledFor: at }, new Date('2026-10-08T04:16:00Z'))).toBe(false);
    expect(isBookedRide({ type: 'ride', state: 'placed', scheduledFor: null }, NOW)).toBe(false);
    expect(isBookedRide({ type: 'food', state: 'placed', scheduledFor: at }, NOW)).toBe(false);
  });
});

describe('regular trips', () => {
  it('reads the days the Iraqi way', () => {
    expect(daysLabel([0, 1, 2, 3, 4])).toEqual({ kind: 'work' });
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toEqual({ kind: 'every' });
    expect(daysLabel([4])).toEqual({ kind: 'one', dow: 4 });
    expect(daysLabel([0, 6, 2])).toEqual({ kind: 'list', dows: [6, 0, 2] });
  });
  it('never leaves the days empty', () => {
    expect(toggleDay([4], 4)).toEqual([4]);
    expect(toggleDay([4], 0)).toEqual([0, 4]);
    expect(toggleDay([0, 4], 0)).toEqual([4]);
  });
  it('asks in the morning only for trips from 09:00, and suggests the evening for early ones', () => {
    expect(morningAllowed(8 * 60 + 55)).toBe(false);
    expect(morningAllowed(9 * 60)).toBe(true);
    expect(defaultRemind(7 * 60 + 30)).toBe('evening');
    expect(defaultRemind(14 * 60)).toBe('morning');
  });
  it('leads each occurrence with the right action, and lists the ones asking soonest first', () => {
    expect(occurrenceAction({ state: 'asking' })).toBe('confirm');
    expect(occurrenceAction({ state: 'waiting' })).toBe('confirm');
    expect(occurrenceAction({ state: 'confirmed' })).toBe('booked');
    expect(occurrenceAction({ state: 'closed' })).toBe('closed');
    const ride = { kind: 'ride' as const, rideVertical: 'taxi' as const, pickup: { zoneKey: 'a', pin: { lat: 0, lng: 0 }, label: 'x' }, dropoff: { zoneKey: 'b', pin: { lat: 0, lng: 0 }, label: 'y' }, doorPickup: false };
    const rajaa = { kind: 'rajaa' as const, corridorId: 'aziziyah_kut', direction: 'from_aziziyah' as const, garageId: 'g', travellingAs: 'rijal' as const };
    const trips = [
      { id: 'b', plan: ride, next: { state: 'asking' as const, at: new Date('2026-10-08T06:00:00Z') } },
      { id: 'a', plan: ride, next: { state: 'asking' as const, at: new Date('2026-10-08T04:30:00Z') } },
      { id: 'c', plan: rajaa, next: { state: 'asking' as const, at: new Date('2026-10-08T05:00:00Z') } },
      { id: 'd', plan: ride, next: { state: 'waiting' as const, at: new Date('2026-10-08T03:00:00Z') } },
    ];
    expect(askingNow(trips, 'ride').map((t) => t.id)).toEqual(['a', 'b']);
    expect(askingNow(trips).map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });
  it('names the far city of a corridor', () => {
    expect(corridorCity('aziziyah_kut')).toBe('kut');
    expect(corridorCity('aziziyah_baghdad')).toBe('baghdad');
  });
});

describe('favourites and dinner', () => {
  it('offers only favourites who drive that kind', () => {
    const f = (id: string, kinds: FavouriteDriverView['kinds']) => ({ id, driverId: id, firstName: id, photoUrl: null, kinds, rating: null, ratingCount: 0, tripsTogether: 1, since: NOW });
    expect(favouritesFor([f('a', ['taxi']), f('b', ['tuktuk', 'taxi']), f('c', ['intercity'])], 'taxi').map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('says dinner comes with him, or how long after', () => {
    expect(dinnerLine(0)).toEqual({ key: 'with' });
    expect(dinnerLine(12)).toEqual({ key: 'after', minutes: 12 });
  });
});
