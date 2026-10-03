import { describe, expect, it } from 'vitest';
import { TripState, type StopState, type StopType } from '@driver/contracts';
import { GEOFENCE_RADIUS_M, evaluateArrival, haversineMeters, offsetNorth, withinGeofence } from './geofence.js';
import { STOP_TRANSITIONS, canStopTransition, childHandover } from './stops.js';
import { TRIP_TRANSITIONS, canTransition, deriveTripState, transition, tripEventType } from './trip.machine.js';
import { canFail, unreachableStatus } from './unreachable.js';

const ALL = TripState.options;

describe('trip machine — full transition table (domain §2)', () => {
  it('covers every TripState and only targets known states', () => {
    expect(Object.keys(TRIP_TRANSITIONS).sort()).toEqual([...ALL].sort());
    for (const tos of Object.values(TRIP_TRANSITIONS)) for (const to of tos) expect(ALL).toContain(to);
  });

  it('matches the table exactly for every (from, to) pair', () => {
    const expected: Record<string, string[]> = {
      created: ['offered', 'customer_cancelled', 'platform_cancelled'],
      offered: ['accepted', 'declined', 'timed_out', 'customer_cancelled', 'platform_cancelled'],
      declined: ['offered', 'customer_cancelled', 'platform_cancelled'],
      timed_out: ['offered', 'customer_cancelled', 'platform_cancelled'],
      accepted: ['en_route_to_pickup', 'arrived_pickup', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled'],
      en_route_to_pickup: ['arrived_pickup', 'arrived_dropoff', 'completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled'],
      arrived_pickup: ['en_route_to_pickup', 'in_transit', 'arrived_dropoff', 'completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed'],
      in_transit: ['arrived_pickup', 'arrived_dropoff', 'completed', 'driver_cancelled', 'platform_cancelled', 'failed'],
      arrived_dropoff: ['en_route_to_pickup', 'arrived_pickup', 'in_transit', 'completed', 'driver_cancelled', 'platform_cancelled', 'failed'],
      completed: [],
      driver_cancelled: [],
      customer_cancelled: [],
      platform_cancelled: [],
      failed: [],
    };
    for (const from of ALL) for (const to of ALL) expect(canTransition(from, to), `${from} → ${to}`).toBe(expected[from]!.includes(to));
  });

  it('declined and timed_out go back to offered; terminal states are final', () => {
    expect(transition('declined', 'offered')).toBe('offered');
    expect(transition('timed_out', 'offered')).toBe('offered');
    for (const t of ['completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed'] as const) expect(TRIP_TRANSITIONS[t]).toEqual([]);
    expect(() => transition('completed', 'offered')).toThrow(/illegal trip transition/);
  });

  it('a customer cannot cancel once the rider/food is aboard', () => {
    expect(canTransition('in_transit', 'customer_cancelled')).toBe(false);
    expect(canTransition('arrived_dropoff', 'customer_cancelled')).toBe(false);
  });

  it('maps states to the domain §6 event names', () => {
    expect(tripEventType('en_route_to_pickup')).toBe('trip.en_route');
    expect(tripEventType('driver_cancelled')).toBe('trip.cancelled');
    expect(tripEventType('timed_out')).toBe('trip.timed_out');
    expect(tripEventType('in_transit')).toBe('trip.progressed');
  });
});

describe('deriveTripState — state from stops', () => {
  const s = (seq: number, type: StopType, state: StopState) => ({ seq, type, state });

  it('single delivery walks the happy path', () => {
    expect(deriveTripState('en_route_to_pickup', [s(0, 'pickup', 'pending'), s(1, 'dropoff', 'pending')])).toBe('en_route_to_pickup');
    expect(deriveTripState('en_route_to_pickup', [s(0, 'pickup', 'arrived'), s(1, 'dropoff', 'pending')])).toBe('arrived_pickup');
    expect(deriveTripState('arrived_pickup', [s(0, 'pickup', 'completed'), s(1, 'dropoff', 'pending')])).toBe('in_transit');
    expect(deriveTripState('in_transit', [s(0, 'pickup', 'completed'), s(1, 'dropoff', 'arrived')])).toBe('arrived_dropoff');
    expect(deriveTripState('arrived_dropoff', [s(0, 'pickup', 'completed'), s(1, 'dropoff', 'completed')])).toBe('completed');
  });

  it('batched trip: second pickup while carrying, then dropoffs one by one', () => {
    const stops = [s(0, 'pickup', 'completed'), s(1, 'pickup', 'arrived'), s(2, 'dropoff', 'pending'), s(3, 'dropoff', 'pending')];
    expect(deriveTripState('in_transit', stops)).toBe('arrived_pickup');
    const later = [s(0, 'pickup', 'completed'), s(1, 'pickup', 'completed'), s(2, 'dropoff', 'completed'), s(3, 'dropoff', 'pending')];
    expect(deriveTripState('arrived_dropoff', later)).toBe('in_transit');
  });

  it('a wait stop with the rider aboard stays in transit', () => {
    expect(deriveTripState('in_transit', [s(0, 'pickup', 'completed'), s(1, 'wait', 'arrived'), s(2, 'dropoff', 'pending')])).toBe('in_transit');
  });

  it('only progress states derive; all-skipped leaves the state for the caller', () => {
    expect(deriveTripState('offered', [s(0, 'pickup', 'completed')])).toBe('offered');
    expect(deriveTripState('in_transit', [s(0, 'pickup', 'skipped'), s(1, 'dropoff', 'skipped')])).toBe('in_transit');
  });
});

describe('stop machine', () => {
  it('pending → arrived → completed | skipped; nothing leaves a finished stop', () => {
    expect(STOP_TRANSITIONS).toEqual({ pending: ['arrived', 'skipped'], arrived: ['completed', 'skipped'], completed: [], skipped: [] });
    expect(canStopTransition('pending', 'completed')).toBe(false);
  });

  it('khat stops need the per-child tap (edge-case §5)', () => {
    expect(childHandover({ vertical: 'khat', childRef: 'chref_1', type: 'dropoff' })).toEqual({ ok: false });
    expect(childHandover({ vertical: 'khat', childRef: 'chref_1', type: 'dropoff', childTap: 'in' })).toEqual({ ok: false });
    expect(childHandover({ vertical: 'khat', childRef: 'chref_1', type: 'dropoff', childTap: 'out' })).toEqual({ ok: true, tap: 'out' });
    expect(childHandover({ vertical: 'food', childRef: null, type: 'dropoff' })).toEqual({ ok: true, tap: null });
  });
});

describe('geofence (60 m)', () => {
  const base = { lat: 32.9185, lng: 45.0712 };

  it('haversine matches known distances', () => {
    // 0.001° of latitude ≈ 111.2 m
    expect(haversineMeters(base, { lat: base.lat + 0.001, lng: base.lng })).toBeCloseTo(111.2, 0);
    expect(haversineMeters(base, offsetNorth(base, 50))).toBeCloseTo(50, 3);
  });

  it('arms at 50 m, not at 70 m', () => {
    expect(GEOFENCE_RADIUS_M).toBe(60);
    expect(withinGeofence(offsetNorth(base, 50), base)).toBe(true);
    expect(withinGeofence(offsetNorth(base, 70), base)).toBe(false);
  });

  it('arrival outside is flagged with its distance, unknown positions are not', () => {
    expect(evaluateArrival(offsetNorth(base, 140), base)).toEqual({ distanceM: 140, outside: true });
    expect(evaluateArrival(offsetNorth(base, 20), base)).toEqual({ distanceM: 20, outside: false });
    expect(evaluateArrival(null, base)).toEqual({ distanceM: null, outside: false });
  });
});

describe('unreachable timing rules', () => {
  const t0 = new Date('2026-10-03T12:00:00Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it('driver may fail from 5:00, dispatcher from 3:00, nobody before the protocol', () => {
    expect(canFail(t0, at(299), 'driver')).toBe(false);
    expect(canFail(t0, at(300), 'driver')).toBe(true);
    expect(canFail(t0, at(179), 'dispatcher')).toBe(false);
    expect(canFail(t0, at(180), 'dispatcher')).toBe(true);
    expect(canFail(null, at(900), 'dispatcher')).toBe(false);
  });

  it('status exposes the 3:00 and 5:00 marks', () => {
    const st = unreachableStatus({ stopId: 's1', startedAt: t0, escalatedAt: null })!;
    expect(st.escalateAt).toEqual(at(180));
    expect(st.failAllowedAt).toEqual(at(300));
  });
});
