import { describe, expect, it } from 'vitest';
import { columnOf, driversFromBoard, groupBoard, isRedCard, policyMode, rightNow, setPolicyInput } from './board';
import { card, offer, trip } from './fixtures';

describe('board grouping', () => {
  it('puts each status in its queue column', () => {
    expect(columnOf(card({ tripId: 'a', status: 'searching' }))).toBe('searching');
    expect(columnOf(card({ tripId: 'b', status: 'scheduled' }))).toBe('searching');
    expect(columnOf(card({ tripId: 'c', status: 'searching', offers: [offer({ driverId: 'd1' })] }))).toBe('offered');
    expect(columnOf(card({ tripId: 'd', status: 'rebroadcast', offers: [offer({ driverId: 'd1', state: 'seen' })] }))).toBe('offered');
    expect(columnOf(card({ tripId: 'e', status: 'searching', offers: [offer({ driverId: 'd1', state: 'timed_out' })] }))).toBe('searching');
    expect(columnOf(card({ tripId: 'f', status: 'assigned', assignedDriverId: 'd1' }))).toBe('assigned');
    expect(columnOf(card({ tripId: 'g', status: 'needs_dispatcher' }))).toBe('needs_dispatcher');
    expect(columnOf(card({ tripId: 'h', status: 'awaiting_dispatcher' }))).toBe('needs_dispatcher');
    expect(columnOf(card({ tripId: 'i', status: 'cancelled' }))).toBeNull();
  });

  it('sorts red first, then the longest-waiting', () => {
    const g = groupBoard([
      card({ tripId: 'young', elapsedSec: 5 }),
      card({ tripId: 'old', elapsedSec: 90 }),
      card({ tripId: 'red', elapsedSec: 1, red: true }),
      card({ tripId: 'gone', status: 'cancelled' }),
    ]);
    expect(g.searching.map((c) => c.tripId)).toEqual(['red', 'old', 'young']);
    expect(g.offered).toEqual([]);
    expect(Object.values(g).flat()).toHaveLength(3);
  });

  it('marks needs-dispatcher cards red', () => {
    expect(isRedCard(card({ tripId: 'x', status: 'needs_dispatcher' }))).toBe(true);
    expect(isRedCard(card({ tripId: 'y', red: true }))).toBe(true);
    expect(isRedCard(card({ tripId: 'z' }))).toBe(false);
  });
});

describe('right-now bar', () => {
  it('counts the board', () => {
    const now = rightNow([
      card({ tripId: 'a', elapsedSec: 30 }),
      card({ tripId: 'b', elapsedSec: 90, offers: [offer({ driverId: 'd1' })], compensationLabel_ar: '+500 تعويض', red: true }),
      card({ tripId: 'c', status: 'assigned', assignedDriverId: 'd2', elapsedSec: 400 }),
      card({ tripId: 'd', status: 'needs_dispatcher', elapsedSec: 180 }),
      card({ tripId: 'e', status: 'cancelled', assignedDriverId: 'd9' }),
    ]);
    expect(now).toEqual({
      searching: 1,
      offered: 1,
      assigned: 1,
      needsDispatcher: 1,
      red: 2,
      avgWaitSec: 100,
      activeDrivers: 2,
      compensated: 1,
    });
  });
  it('has no average when nothing waits', () => {
    expect(rightNow([]).avgWaitSec).toBeNull();
  });
});

describe('policy switches', () => {
  it('reads the switch position', () => {
    expect(policyMode({ policy: 'smart_broadcast', suggestOnly: false })).toBe('broadcast');
    expect(policyMode({ policy: 'auto_assign', suggestOnly: false })).toBe('auto');
    expect(policyMode({ policy: 'auto_assign', suggestOnly: true })).toBe('suggest');
    expect(policyMode({ policy: 'scheduled', suggestOnly: false })).toBe('fixed');
  });
  it('builds the setPolicy input', () => {
    expect(setPolicyInput('aziziyah', 'food', 'broadcast')).toEqual({ cityId: 'aziziyah', vertical: 'food', policy: 'smart_broadcast', suggestOnly: false });
    expect(setPolicyInput('aziziyah', 'taxi', 'auto')).toEqual({ cityId: 'aziziyah', vertical: 'taxi', policy: 'auto_assign', suggestOnly: false });
    expect(setPolicyInput('aziziyah', 'food', 'suggest')).toEqual({ cityId: 'aziziyah', vertical: 'food', suggestOnly: true });
  });
});

describe('drivers from the board', () => {
  it('merges trips, assignments, offers and suggestions with the busiest state', () => {
    const list = driversFromBoard(
      {
        cards: [
          card({ tripId: 't1', offers: [offer({ driverId: 'd1' }), offer({ driverId: 'd2', state: 'declined' })], suggestion: ['d3', 'd1'] }),
          card({ tripId: 't2', status: 'assigned', assignedDriverId: 'd4' }),
        ],
      },
      [trip({ id: 't3', courierId: 'd1' })],
    );
    expect(list).toEqual([
      { driverId: 'd1', state: 'on_job', tripIds: ['t3', 't1'] },
      { driverId: 'd4', state: 'on_job', tripIds: ['t2'] },
      { driverId: 'd3', state: 'suggested', tripIds: ['t1'] },
    ]);
  });
  it('is empty without data', () => {
    expect(driversFromBoard(undefined)).toEqual([]);
  });
});
