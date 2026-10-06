import { describe, expect, it } from 'vitest';
import type { BookingView } from '@driver/contracts';
import { sectionByDay } from '@/features/orders/history';
import { pastTrips, upcomingTrips, withTrips } from './trips';

const NOW = new Date('2026-10-06T12:00:00Z'); // 15:00 Baghdad, Tuesday
const h = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const trip = (id: string, state: BookingView['state'], departAt: Date, heldUntil: Date | null = null) =>
  ({ id, state, heldUntil, departure: { departAt } }) as unknown as BookingView;
const order = (id: string, placedAt: Date, state = 'closed') => ({ order: { id, state, placedAt } }) as never;

describe('upcomingTrips / pastTrips', () => {
  it('pins booked and boarding seats (and a running hold) soonest first', () => {
    const list = [trip('later', 'booked', h(5)), trip('soon', 'checked_in', h(1)), trip('hold', 'held', h(3), h(0.1)), trip('lapsed', 'held', h(3), h(-1)), trip('done', 'completed', h(-20))];
    expect(upcomingTrips(list, NOW).map((b) => b.id)).toEqual(['soon', 'hold', 'later']);
    expect(pastTrips(list).map((b) => b.id)).toEqual(['done']);
  });
  it('leaves out moved bookings and lapsed holds from the past', () => {
    expect(pastTrips([trip('m', 'moved', h(-30)), trip('e', 'expired', h(-30)), trip('n', 'no_show', h(-30))]).map((b) => b.id)).toEqual(['n']);
  });
});

describe('withTrips', () => {
  it('puts a past seat under its day next to the orders, newest first, and gives a trip-only day its own section', () => {
    const sections = sectionByDay([order('o_today', h(-1)), order('o_3days', h(-72))], NOW);
    const merged = withTrips(sections, [trip('t_today', 'completed', h(-3)), trip('t_yday', 'completed', h(-26))], NOW);
    expect(merged.map((s) => [s.day?.kind ?? 'running', s.rows.map((r) => (r.kind === 'order' ? (r.row as { order: { id: string } }).order.id : r.booking.id))])).toEqual([
      ['today', ['o_today', 't_today']],
      ['yesterday', ['t_yday']],
      ['date', ['o_3days']],
    ]);
  });
  it('keeps the running section first', () => {
    const sections = sectionByDay([order('live', h(-0.2), 'preparing')], NOW);
    const merged = withTrips(sections, [trip('t', 'completed', h(-1))], NOW);
    expect(merged.map((s) => s.running)).toEqual([true, false]);
  });
});
