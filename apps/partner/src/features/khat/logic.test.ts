import { describe, expect, it } from 'vitest';
import type { KhatRunTrip, KhatStopView } from '@driver/contracts';
import { activeRunIndex, canReportAbsent, childAction, deliveredShare, groupPlaces, runFinished, runStart } from './logic';

const T = (min: number) => new Date(Date.UTC(2026, 9, 4, 4, min));

function stop(seq: number, type: 'pickup' | 'dropoff', zoneKey: string, ref: string, over: Partial<KhatStopView> = {}): KhatStopView {
  return { stopId: `s${seq}`, seq, type, state: 'pending', zoneKey, windowStart: T(seq * 5), windowEnd: T(seq * 5 + 5), child: { childRef: ref, firstName: ref }, tappedInAt: null, tappedOutAt: null, absent: false, ...over };
}

function trip(stops: KhatStopView[], over: Partial<KhatRunTrip> = {}): KhatRunTrip {
  return { tripId: 't1', state: 'accepted', stops, childrenTotal: 4, onBoard: 0, delivered: 0, absent: 0, ...over };
}

describe('khat run', () => {
  const run = trip([
    stop(0, 'pickup', 'hashimi', 'zainab', { state: 'completed', tappedInAt: T(1) }),
    stop(1, 'pickup', 'hashimi', 'hasan', { state: 'completed', tappedInAt: T(2) }),
    stop(2, 'pickup', 'shukri', 'maryam'),
    stop(3, 'pickup', 'shukri', 'ali', { state: 'skipped', absent: true }),
    stop(4, 'dropoff', 'centre', 'zainab'),
    stop(5, 'dropoff', 'centre', 'hasan'),
    stop(6, 'dropoff', 'centre', 'maryam'),
    stop(7, 'dropoff', 'centre', 'ali', { state: 'skipped', absent: true }),
  ]);

  it('groups consecutive stops by place and marks done / current / upcoming', () => {
    const places = groupPlaces(run);
    expect(places.map((p) => [p.type, p.zoneKey, p.stops.length, p.status])).toEqual([
      ['pickup', 'hashimi', 2, 'done'],
      ['pickup', 'shukri', 2, 'current'],
      ['dropoff', 'centre', 4, 'upcoming'],
    ]);
    expect(places[0]!.windowEnd).toEqual(T(10));
  });

  it('offers "صعد" at pickups, "نزل" only once the child is on board, absence over everything', () => {
    expect(childAction(run, run.stops[0]!)).toBe('tapped_in');
    expect(childAction(run, run.stops[2]!)).toBe('tap_in');
    expect(childAction(run, run.stops[3]!)).toBe('absent');
    expect(childAction(run, run.stops[4]!)).toBe('tap_out');
    expect(childAction(run, run.stops[6]!)).toBe('not_on_board');
    expect(childAction(run, { ...run.stops[4]!, tappedOutAt: T(40), state: 'completed' })).toBe('tapped_out');
  });

  it('absence can be reported until the child is tapped in', () => {
    expect(canReportAbsent(run, 'maryam')).toBe(true);
    expect(canReportAbsent(run, 'zainab')).toBe(false);
    expect(canReportAbsent(run, 'ali')).toBe(false);
    expect(canReportAbsent(run, 'nobody')).toBe(false);
  });

  it('finished when every child stop is settled; opens on the first unfinished run', () => {
    expect(runFinished(run)).toBe(false);
    const done = trip(run.stops.map((s) => ({ ...s, state: s.absent ? 'skipped' : 'completed' })), { tripId: 't0' });
    expect(runFinished(done)).toBe(true);
    expect(activeRunIndex([done, run])).toBe(1);
    expect(activeRunIndex([done])).toBe(0);
    expect(runStart(run)).toEqual(T(0));
  });

  it('progress counts delivered against children travelling today', () => {
    expect(deliveredShare({ childrenTotal: 4, delivered: 3, absent: 1 })).toBe(1);
    expect(deliveredShare({ childrenTotal: 4, delivered: 1, absent: 0 })).toBe(0.25);
    expect(deliveredShare({ childrenTotal: 1, delivered: 0, absent: 1 })).toBe(1);
  });
});
