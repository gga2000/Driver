import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { canBatch, departureTime, type BatchOrder, type BatchRules } from './batching.js';
import { north } from './test-harness.js';

const T0 = new Date('2026-10-03T12:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const rules: BatchRules = { maxBatch: 2, maxDetourMin: 4, maxHotWaitMin: 10 };
/** Travel = 1 min per 100 m of latitude offset, to keep the arithmetic obvious. */
const travelMin = (a: LatLng, b: LatLng) => Math.round(Math.abs(a.lat - b.lat) * ((6371 * Math.PI) / 180) * 10 * 100) / 100;
const adjacent = new Set(['centre|street_30', 'street_30|centre']);
const ctx = { now: T0, courierAt: north(0), travelMin, isAdjacent: (a: string, b: string) => a === b || adjacent.has(`${a}|${b}`) };

const order = (tripId: string, p: Partial<BatchOrder> = {}): BatchOrder => ({
  tripId,
  pickup: north(0),
  dropoffZoneId: 'centre',
  readyAt: at(0),
  hot: true,
  ...p,
});

describe('batching rules (spec §3)', () => {
  it('rule 1: at most 2 per bike, 3 per tuktuk', () => {
    expect(canBatch([order('a')], order('b'), rules, ctx).ok).toBe(true);
    expect(canBatch([order('a'), order('b')], order('c'), rules, ctx)).toEqual({ ok: false, reason: 'batch_full', detail: '2/2' });
    expect(canBatch([order('a'), order('b')], order('c'), { ...rules, maxBatch: 3 }, ctx).ok).toBe(true);
  });

  it('rule 2: drop-offs in the same or an adjacent zone only', () => {
    expect(canBatch([order('a')], order('b', { dropoffZoneId: 'street_30' }), rules, ctx).ok).toBe(true);
    expect(canBatch([order('a')], order('b', { dropoffZoneId: 'khamas' }), rules, ctx)).toMatchObject({ ok: false, reason: 'zone_mismatch' });
  });

  it('rule 3: the second pickup may add at most 4 minutes', () => {
    // Second restaurant 0.4 km on: +4 min exactly → allowed; 0.5 km → +5 → refused.
    expect(canBatch([order('a')], order('b', { pickup: north(0.4) }), rules, ctx)).toMatchObject({ ok: true, addedMin: 4 });
    expect(canBatch([order('a')], order('b', { pickup: north(0.5) }), rules, ctx)).toMatchObject({ ok: false, reason: 'detour_too_long' });
    // Waiting for a later ready time counts as added time too.
    expect(canBatch([order('a')], order('b', { readyAt: at(6) }), rules, ctx)).toMatchObject({ ok: false, reason: 'detour_too_long' });
  });

  it('rule 4: hot items never wait more than 10 min from ready', () => {
    // a was ready 8 min ago; adding b (+3 min) means a leaves 11 min after ready.
    const stale = order('a', { readyAt: at(-8) });
    expect(canBatch([stale], order('b', { pickup: north(0.3) }), rules, ctx)).toMatchObject({ ok: false, reason: 'hot_wait_too_long' });
    // The same order not hot may wait.
    expect(canBatch([{ ...stale, hot: false }], order('b', { pickup: north(0.3), hot: false }), rules, ctx).ok).toBe(true);
    // Already in the bag still counts: the food waits in the bag.
    expect(canBatch([{ ...stale, pickedUp: true }], order('b', { pickup: north(0.3) }), rules, ctx)).toMatchObject({ ok: false, reason: 'hot_wait_too_long' });
  });

  it('returns the honest batched departure time the customer sees', () => {
    // Courier 0.2 km from a (2 min), a ready at +3 → leaves a at +3, b 0.2 km on (+2) → +5.
    const courierAway = { ...ctx, courierAt: north(-0.2) };
    expect(departureTime([order('a', { readyAt: at(3) })], courierAway)).toEqual(at(3));
    const verdict = canBatch([order('a', { readyAt: at(3) })], order('b', { pickup: north(0.2), readyAt: at(4) }), rules, courierAway);
    expect(verdict).toEqual({ ok: true, departAt: at(5), addedMin: 2 });
  });
});
