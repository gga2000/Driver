import { describe, expect, it } from 'vitest';
import { DOOR_RULES, type DoorSample } from '@driver/contracts';
import { doorPoint, withSample } from './door-point.js';
import { distanceM } from './zones.js';

const PIN = { lat: 32.887, lng: 45.0765 };
/** ~10 m steps north of the pin's door (1e-4 lat ≈ 11 m). */
const DOOR = { lat: 32.8872, lng: 45.0766 };
let n = 0;
const sample = (lat: number, lng: number, accuracyM = 10): DoorSample => ({ stopId: `s${++n}`, lat, lng, accuracyM, at: new Date(Date.UTC(2026, 9, 1, 12, n)) });

describe('doorPoint (maps program a3)', () => {
  it('needs three agreeing arrivals; then the median of the agreeing ones', () => {
    const two = [sample(DOOR.lat, DOOR.lng), sample(DOOR.lat + 0.00005, DOOR.lng)];
    expect(doorPoint(two, PIN)).toBeNull();
    const three = [...two, sample(DOOR.lat - 0.00005, DOOR.lng + 0.00002)];
    const door = doorPoint(three, PIN)!;
    expect(distanceM(door, DOOR)).toBeLessThan(5);
  });

  it('a tap from the corner or a GPS jump does not move the door', () => {
    const agreeing = [sample(DOOR.lat, DOOR.lng), sample(DOOR.lat + 0.00003, DOOR.lng), sample(DOOR.lat, DOOR.lng + 0.00003)];
    const corner = sample(DOOR.lat + 0.0009, DOOR.lng); // ~100 m away
    const door = doorPoint([...agreeing, corner], PIN)!;
    expect(distanceM(door, DOOR)).toBeLessThan(5);
  });

  it('ignores inaccurate fixes and fixes far from the current pin', () => {
    const blurry = [sample(DOOR.lat, DOOR.lng, 45), sample(DOOR.lat, DOOR.lng, 50), sample(DOOR.lat, DOOR.lng, DOOR_RULES.maxAccuracyM + 1)];
    expect(doorPoint(blurry, PIN)).toBeNull();
    const agreeing = [sample(DOOR.lat, DOOR.lng), sample(DOOR.lat, DOOR.lng), sample(DOOR.lat, DOOR.lng)];
    // The customer moved the pin across town: the old arrivals no longer count.
    expect(doorPoint(agreeing, { lat: 32.9095, lng: 45.0635 })).toBeNull();
  });

  it('scattered arrivals with no three together give no door', () => {
    const spread = [sample(DOOR.lat, DOOR.lng), sample(DOOR.lat + 0.0007, DOOR.lng), sample(DOOR.lat - 0.0007, DOOR.lng), sample(DOOR.lat, DOOR.lng + 0.0009)];
    expect(doorPoint(spread, PIN)).toBeNull();
  });
});

describe('withSample', () => {
  it('keeps the newest ones, one per drop-off', () => {
    let kept: DoorSample[] = [];
    const first = sample(DOOR.lat, DOOR.lng);
    kept = withSample(kept, first);
    expect(withSample(kept, first)).toHaveLength(1);
    for (let i = 0; i < DOOR_RULES.keep + 3; i++) kept = withSample(kept, sample(DOOR.lat, DOOR.lng));
    expect(kept).toHaveLength(DOOR_RULES.keep);
    expect(kept.some((s) => s.stopId === first.stopId)).toBe(false);
  });
});
