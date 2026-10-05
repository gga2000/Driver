import { describe, expect, it } from 'vitest';
import { isNear, momentsBetween, type MomentSnapshot } from './moments';

const snap = (phase: MomentSnapshot['phase'], near = false, orderId = 'o1'): MomentSnapshot => ({ orderId, phase, near });
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
  it('near: food, on the way, within 500 m of the door', () => {
    expect(isNear('on_the_way', north(450), DOOR, true)).toBe(true);
    expect(isNear('on_the_way', north(650), DOOR, true)).toBe(false);
    expect(isNear('to_pickup', north(100), DOOR, true)).toBe(false);
    expect(isNear('on_the_way', north(100), DOOR, false)).toBe(false);
    expect(isNear('on_the_way', null, DOOR, true)).toBe(false);
  });
});
