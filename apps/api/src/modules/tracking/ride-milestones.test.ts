import { describe, expect, it } from 'vitest';
import { rideMilestones, type FinishedRide } from './ride-milestones.js';

/** A ride placed at `hh:mm` Baghdad (UTC+3) on day `d` of October 2026, reaching him 20 minutes later. */
const ride = (id: string, d: number, hhmm: string): FinishedRide => {
  const placedAt = new Date(`2026-10-${String(d).padStart(2, '0')}T${hhmm}:00+03:00`);
  return { id, placedAt, doneAt: new Date(placedAt.getTime() + 20 * 60_000) };
};

describe('rideMilestones (ride idea g2)', () => {
  it('has nothing before the first finished ride', () => {
    expect(rideMilestones([])).toEqual({ nightRideOrderId: null, rideMilestone: null });
  });

  it('names the first ride booked at night, by when the rides reached him', () => {
    const day = ride('day', 1, '14:00');
    const lateNight = ride('late', 3, '23:40');
    const earlyNight = ride('early', 2, '05:10');
    expect(rideMilestones([lateNight, day, earlyNight])).toEqual({ nightRideOrderId: 'early', rideMilestone: null });
    // 06:00 is morning and 20:59 is still evening: neither is a night ride.
    expect(rideMilestones([ride('a', 1, '06:00'), ride('b', 1, '20:59')]).nightRideOrderId).toBeNull();
    expect(rideMilestones([ride('c', 1, '21:00')]).nightRideOrderId).toBe('c');
  });

  it('gives the 10th ride its sticker, and keeps it there until the 25th', () => {
    const rides = Array.from({ length: 30 }, (_, i) => ride(`r${i + 1}`, 1 + Math.floor(i / 2), i % 2 ? '16:00' : '09:00'));
    expect(rideMilestones(rides.slice(0, 9)).rideMilestone).toBeNull();
    expect(rideMilestones(rides.slice(0, 10)).rideMilestone).toEqual({ orderId: 'r10', count: 10 });
    expect(rideMilestones(rides.slice(0, 24)).rideMilestone).toEqual({ orderId: 'r10', count: 10 });
    expect(rideMilestones([...rides].reverse()).rideMilestone).toEqual({ orderId: 'r25', count: 25 });
  });
});
