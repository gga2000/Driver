import { describe, expect, it } from 'vitest';
import type { KhatRunTrip, KhatStopView } from '@driver/contracts';
import { activeRunIndex, canReportAbsent, childAction, deliveredShare, groupPlaces, lookPauseLeft, minutesUntil, needsSweep, nextChild, nextStopAt, runChips, runFinished, runStart, runUnderway } from './logic';

const T = (min: number) => new Date(Date.UTC(2026, 9, 4, 4, min));

function stop(seq: number, type: 'pickup' | 'dropoff', zoneKey: string, ref: string, over: Partial<KhatStopView> = {}): KhatStopView {
  return { stopId: `s${seq}`, seq, type, state: 'pending', zoneKey, windowStart: T(seq * 5), windowEnd: T(seq * 5 + 5), landmark: null, child: { childRef: ref, firstName: ref, photoUrl: null }, tappedInAt: null, tappedOutAt: null, absent: false, ...over };
}

function trip(stops: KhatStopView[], over: Partial<KhatRunTrip> = {}): KhatRunTrip {
  return { tripId: 't1', state: 'accepted', stops, childrenTotal: 4, onBoard: 0, delivered: 0, absent: 0, emptyCarCheckedAt: null, ...over };
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

  it('offers "صعود" at pickups, "نزول" only once the child is on board, absence over everything', () => {
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
    // A finished run whose car was checked steps aside for the next one…
    const swept = { ...done, emptyCarCheckedAt: T(40) };
    expect(activeRunIndex([swept, run])).toBe(1);
    expect(activeRunIndex([swept])).toBe(0);
    // …but one still waiting for the sweep opens first (app restart, the reminder push).
    expect(activeRunIndex([done, run])).toBe(0);
    expect(activeRunIndex([run, done])).toBe(1);
    expect(runStart(run)).toEqual(T(0));
  });

  it('progress counts delivered against children travelling today', () => {
    expect(deliveredShare({ childrenTotal: 4, delivered: 3, absent: 1 })).toBe(1);
    expect(deliveredShare({ childrenTotal: 4, delivered: 1, absent: 0 })).toBe(0.25);
    expect(deliveredShare({ childrenTotal: 1, delivered: 0, absent: 1 })).toBe(1);
  });
});

describe('child-safe run (partner S-6)', () => {
  const fresh = trip([stop(0, 'pickup', 'hashimi', 'zainab'), stop(1, 'dropoff', 'centre', 'zainab')], { childrenTotal: 5, absent: 1 });

  it('header chips: in the car, arrived of travelling, absent', () => {
    expect(runChips({ childrenTotal: 5, onBoard: 2, delivered: 0, absent: 1 })).toEqual({ onBoard: 2, delivered: 0, total: 4, absent: 1 });
  });

  it('a run is under way from the first tap until the car is confirmed empty (offers stay hidden meanwhile)', () => {
    expect(runUnderway(fresh)).toBe(false);
    const boarded = { ...fresh, onBoard: 1, stops: [{ ...fresh.stops[0]!, tappedInAt: T(1), state: 'completed' as const }, fresh.stops[1]!] };
    expect(runUnderway(boarded)).toBe(true);
    const dropped = { ...boarded, onBoard: 0, delivered: 1, stops: [boarded.stops[0]!, { ...fresh.stops[1]!, tappedOutAt: T(20), state: 'completed' as const }] };
    expect(runUnderway(dropped)).toBe(true);
    expect(needsSweep(dropped)).toBe(true);
    const swept = { ...dropped, emptyCarCheckedAt: T(22) };
    expect(runUnderway(swept)).toBe(false);
    expect(needsSweep(swept)).toBe(false);
    expect(needsSweep(boarded)).toBe(false);
  });

  it('the next time on the run is the current place window', () => {
    expect(nextStopAt(groupPlaces(fresh))).toEqual(T(0));
    expect(nextStopAt(groupPlaces({ stops: [{ ...fresh.stops[0]!, tappedInAt: T(1), state: 'completed' }, fresh.stops[1]!] }))).toEqual(T(5));
    expect(nextStopAt([])).toBeNull();
  });
});

describe('lookPauseLeft (sweep step 1 forced pause)', () => {
  it('counts 3 → 2 → 1 → 0 over the pause and stays at 0 after it', () => {
    const shown = 1_000_000;
    expect(lookPauseLeft(shown, shown, 3)).toBe(3);
    expect(lookPauseLeft(shown, shown + 1, 3)).toBe(3);
    expect(lookPauseLeft(shown, shown + 1_000, 3)).toBe(2);
    expect(lookPauseLeft(shown, shown + 2_500, 3)).toBe(1);
    expect(lookPauseLeft(shown, shown + 2_999, 3)).toBe(1);
    expect(lookPauseLeft(shown, shown + 3_000, 3)).toBe(0);
    expect(lookPauseLeft(shown, shown + 60_000, 3)).toBe(0);
  });

  it('a clock that steps back never lengthens the wait', () => {
    expect(lookPauseLeft(5_000, 4_000, 3)).toBe(3);
  });
});

describe('partner redesign k2: the next child', () => {
  const at = new Date('2026-10-08T05:00:00Z');
  const st = (o: Partial<KhatStopView> & Pick<KhatStopView, 'stopId' | 'seq' | 'type' | 'zoneKey'>, name: string | null): KhatStopView => ({
    state: 'pending',
    windowStart: at,
    windowEnd: null,
    landmark: null,
    child: name ? { childRef: `c-${name}`, firstName: name, photoUrl: null } : null,
    tappedInAt: null,
    tappedOutAt: null,
    absent: false,
    ...o,
  });

  it('is the first child at the current place who still needs a tap, with the others waiting there', () => {
    const trip = {
      stops: [
        st({ stopId: 'a', seq: 1, type: 'pickup', zoneKey: 'hashimi', tappedInAt: at, state: 'completed' }, 'زينب'),
        st({ stopId: 'b', seq: 2, type: 'pickup', zoneKey: 'shukri', absent: true }, 'علي'),
        st({ stopId: 'c', seq: 3, type: 'pickup', zoneKey: 'shukri' }, 'مريم'),
        st({ stopId: 'd', seq: 4, type: 'pickup', zoneKey: 'shukri' }, 'سجى'),
        st({ stopId: 'e', seq: 5, type: 'dropoff', zoneKey: 'centre' }, 'زينب'),
      ],
    };
    const n = nextChild(trip, groupPlaces(trip));
    expect(n?.stop.stopId).toBe('c');
    expect(n?.alsoHere).toEqual(['سجى']);
  });

  it('at the school it is the first child to drop; none when the run is done', () => {
    const trip = {
      stops: [
        st({ stopId: 'a', seq: 1, type: 'pickup', zoneKey: 'hashimi', tappedInAt: at, state: 'completed' }, 'زينب'),
        st({ stopId: 'e', seq: 2, type: 'dropoff', zoneKey: 'centre' }, 'زينب'),
      ],
    };
    expect(nextChild(trip, groupPlaces(trip))?.stop.stopId).toBe('e');
    const done = { stops: trip.stops.map((s) => ({ ...s, state: 'completed' as const, tappedOutAt: s.type === 'dropoff' ? at : null })) };
    expect(nextChild(done, groupPlaces(done))).toBeNull();
  });

  it('counts whole minutes up to the stop time, 0 once due, null without a time', () => {
    expect(minutesUntil(at, at.getTime() - 5 * 60_000 - 100)).toBe(6);
    expect(minutesUntil(at, at.getTime() - 60_000)).toBe(1);
    expect(minutesUntil(at, at.getTime() + 1)).toBe(0);
    expect(minutesUntil(null, 0)).toBeNull();
  });
});
