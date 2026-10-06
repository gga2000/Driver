import { describe, expect, it } from 'vitest';
import { ALMOST_THERE_ETA_MS, almostThere, isNear, momentsBetween, type MomentSnapshot } from './moments';

const snap = (phase: MomentSnapshot['phase'], near = false, orderId = 'o1', door = false): MomentSnapshot => ({ orderId, phase, near, door });
const DOOR = { lat: 32.9, lng: 45.07 };
/** About `m` metres north of the door. */
const north = (m: number) => ({ lat: DOOR.lat + m / 111_320, lng: DOOR.lng });

describe('tracking moments', () => {
  it('opening the screen is not a moment', () => {
    expect(momentsBetween(null, snap('on_the_way'))).toEqual([]);
    expect(momentsBetween(snap('preparing', false, 'other'), snap('on_the_way'))).toEqual([]);
  });
  it('accepted → picked up → near → delivered, each once', () => {
    expect(momentsBetween(snap('waiting_merchant'), snap('preparing'))).toEqual(['accepted']);
    expect(momentsBetween(snap('preparing'), snap('to_pickup'))).toEqual([]);
    expect(momentsBetween(snap('at_pickup'), snap('on_the_way'))).toEqual(['picked_up']);
    expect(momentsBetween(snap('on_the_way'), snap('on_the_way', true))).toEqual(['near']);
    expect(momentsBetween(snap('on_the_way', true), snap('on_the_way', true))).toEqual([]);
    expect(momentsBetween(snap('on_the_way', true), snap('arrived'))).toEqual(['delivered']);
    expect(momentsBetween(snap('arrived'), snap('done'))).toEqual([]);
  });
  it('a cancelled order has no moments', () => {
    expect(momentsBetween(snap('waiting_merchant'), snap('cancelled'))).toEqual([]);
  });
  it('at the door is its own moment, once, and a later "near" read does not fire after it', () => {
    expect(momentsBetween(snap('on_the_way', true), snap('on_the_way', true, 'o1', true))).toEqual(['at_door']);
    expect(momentsBetween(snap('on_the_way'), snap('on_the_way', false, 'o1', true))).toEqual(['at_door']);
    expect(momentsBetween(snap('on_the_way', false, 'o1', true), snap('on_the_way', true, 'o1', true))).toEqual([]);
  });
  it('near: food, on the way, within 300 m of the door (the spec line)', () => {
    expect(isNear('on_the_way', north(290), DOOR, true)).toBe(true);
    expect(isNear('on_the_way', north(350), DOOR, true)).toBe(false);
    expect(isNear('to_pickup', north(100), DOOR, true)).toBe(false);
    expect(isNear('on_the_way', north(100), DOOR, false)).toBe(false);
    expect(isNear('on_the_way', null, DOOR, true)).toBe(false);
  });

  describe('almost-there card (f3)', () => {
    const NOW = 1_790_000_000_000;
    const base = { phase: 'on_the_way' as const, food: true, atDoor: false, courier: north(900), door: DOOR, nearAt: null, eta: null, now: NOW };
    it('shows about two minutes out: the ETA, the server near fix, or the 300 m line, whichever is first', () => {
      expect(almostThere(base)).toBeNull();
      expect(almostThere({ ...base, eta: new Date(NOW + ALMOST_THERE_ETA_MS) })).toBe('near');
      expect(almostThere({ ...base, eta: new Date(NOW + ALMOST_THERE_ETA_MS + 1_000) })).toBeNull();
      expect(almostThere({ ...base, nearAt: new Date(NOW - 5_000) })).toBe('near');
      expect(almostThere({ ...base, courier: north(250) })).toBe('near');
    });
    it('at my door it becomes the door card, never "near" (no contradiction with the status line)', () => {
      expect(almostThere({ ...base, atDoor: true, courier: north(10), nearAt: new Date(NOW) })).toBe('door');
    });
    it('food only, and only once the food is on its way', () => {
      expect(almostThere({ ...base, food: false, nearAt: new Date(NOW) })).toBeNull();
      expect(almostThere({ ...base, phase: 'to_pickup', nearAt: new Date(NOW) })).toBeNull();
      expect(almostThere({ ...base, phase: 'arrived', atDoor: true })).toBeNull();
    });
  });
});
