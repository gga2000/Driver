import { describe, expect, it } from 'vitest';
import type { BookingView } from '@driver/contracts';
import { returnOfferFor } from './return-bundle';

const seat = (id: string, direction: 'from_aziziyah' | 'to_aziziyah', departAt: string, returnOfferPercent: number | null, corridorId = 'aziziyah_baghdad') =>
  ({ id, returnOfferPercent, departure: { corridorId, direction, departAt: new Date(departAt) } }) as unknown as BookingView;

describe('returnOfferFor (step 5, return trip 10 %)', () => {
  it('a booked seat out offers the pair on cars back on the same road, the earliest first', () => {
    const mine = [seat('b2', 'from_aziziyah', '2026-10-09T10:00:00Z', 10), seat('b1', 'from_aziziyah', '2026-10-09T06:00:00Z', 10)];
    expect(returnOfferFor(mine, 'aziziyah_baghdad', 'to_aziziyah')).toMatchObject({ percent: 10, booking: { id: 'b1' } });
  });

  it('nothing on the same direction, another road, or a seat the server no longer offers', () => {
    expect(returnOfferFor([seat('b1', 'from_aziziyah', '2026-10-09T06:00:00Z', 10)], 'aziziyah_baghdad', 'from_aziziyah')).toBeNull();
    expect(returnOfferFor([seat('b1', 'from_aziziyah', '2026-10-09T06:00:00Z', 10, 'aziziyah_kut')], 'aziziyah_baghdad', 'to_aziziyah')).toBeNull();
    expect(returnOfferFor([seat('b1', 'from_aziziyah', '2026-10-09T06:00:00Z', null)], 'aziziyah_baghdad', 'to_aziziyah')).toBeNull();
    expect(returnOfferFor(undefined, 'aziziyah_baghdad', 'to_aziziyah')).toBeNull();
  });
});
