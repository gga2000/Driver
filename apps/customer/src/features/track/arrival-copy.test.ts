import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { rideArrivalCopy, rideMinutes, type RideArrivalView } from './arrival-copy';

const t = createT('ar-IQ');
const T0 = new Date('2026-10-06T15:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function ride(o: { pickupDone?: Date | null; done?: Date | null; name?: string | null; type?: string } = {}): RideArrivalView {
  return {
    order: { type: o.type ?? 'ride' },
    trip: {
      completedAt: o.done === undefined ? at(12) : o.done,
      stops: [
        { mine: true, type: 'pickup', completedAt: o.pickupDone === undefined ? at(0) : o.pickupDone },
        { mine: true, type: 'dropoff', completedAt: at(12) },
      ],
    },
    courier: { firstName: o.name === undefined ? 'عباس' : o.name },
  };
}

describe('ride arrived copy (L-09)', () => {
  it('minutes on the road from pickup to arrival', () => {
    expect(rideMinutes(ride())).toBe(12);
    expect(rideMinutes(ride({ done: at(0.3) }))).toBe(1);
    expect(rideMinutes(ride({ pickupDone: null }))).toBeNull();
    expect(rideMinutes(ride({ done: null }))).toBeNull();
    expect(rideMinutes(ride({ type: 'food' }))).toBeNull();
  });
  it('says who drove and how long, and names him on the button', () => {
    expect(rideArrivalCopy(t, ride())).toEqual({ subtitle: 'ويا عباس · 12 دقيقة', rate: 'قيّم عباس' });
    expect(rideArrivalCopy(t, ride({ done: at(2) })).subtitle).toBe('ويا عباس · دقيقتين');
    expect(rideArrivalCopy(t, ride({ pickupDone: null })).subtitle).toBe('ويا عباس');
    expect(rideArrivalCopy(t, ride({ name: null }))).toEqual({ subtitle: 'ويا السايق · 12 دقيقة', rate: 'قيّم السايق' });
  });
});
