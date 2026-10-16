import { describe, expect, it } from 'vitest';
import type { PartnerBookedJob } from '@driver/contracts';
import { bookedHome, canStart, stillOpen } from './booked-logic';

const AT = new Date('2026-10-08T02:00:00Z'); // 05:00 Thursday
const job = (over: Partial<PartnerBookedJob> = {}): PartnerBookedJob => ({
  tripId: 't1',
  vertical: 'taxi',
  scheduledFor: AT,
  state: 'open',
  pickup: { zoneId: 'centre' },
  dropoff: { zoneId: 'zakur' },
  tripKm: 3.2,
  pay: { totalIqd: 3500, components: [], takePct: 12 },
  collectIqd: 4000,
  favourite: false,
  confirmBy: new Date('2026-10-07T19:00:00Z'),
  startFrom: new Date('2026-10-08T01:00:00Z'),
  showBy: new Date('2026-10-08T01:30:00Z'),
  ...over,
});

describe('«مشاوير باچر» (review #28)', () => {
  it('«طالع هسة» from an hour before until the half hour, only on his own', () => {
    const mine = job({ state: 'confirmed' });
    expect(canStart(mine, new Date('2026-10-08T00:59:00Z'))).toBe(false);
    expect(canStart(mine, new Date('2026-10-08T01:00:00Z'))).toBe(true);
    expect(canStart(mine, new Date('2026-10-08T01:30:00Z'))).toBe(false);
    expect(canStart(job(), new Date('2026-10-08T01:10:00Z'))).toBe(false);
  });

  it('an open job is gone once its deadline passed', () => {
    expect(stillOpen(job(), new Date('2026-10-07T18:59:00Z'))).toBe(true);
    expect(stillOpen(job(), new Date('2026-10-07T19:00:00Z'))).toBe(false);
  });

  it('home: his next booked ride first, else how many wait, else nothing', () => {
    const now = new Date('2026-10-07T16:00:00Z');
    expect(bookedHome({ online: true, mine: [job({ state: 'confirmed', scheduledFor: new Date('2026-10-08T05:00:00Z') }), job({ state: 'confirmed' })], open: [job()] }, now)).toEqual({ kind: 'mine', at: AT });
    expect(bookedHome({ online: true, mine: [], open: [job(), job({ tripId: 't2' })] }, now)).toEqual({ kind: 'open', n: 2 });
    expect(bookedHome({ online: true, mine: [], open: [job()] }, new Date('2026-10-07T19:30:00Z'))).toBeNull();
    expect(bookedHome(undefined, now)).toBeNull();
  });
});
