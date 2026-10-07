import { describe, expect, it } from 'vitest';
import type { PublicSeason } from '@driver/contracts';
import { ALMOST_THERE_ETA_MS, almostThere, isNear, momentFeedback, momentsBetween, REVEAL_FRESH_MS, revealPlays, revealSeenKey, rideMatchedFresh, type MomentSnapshot } from './moments';

const snap = (phase: MomentSnapshot['phase'], near = false, orderId = 'o1', door = false): MomentSnapshot => ({ orderId, phase, near, door });
const ride = (phase: MomentSnapshot['phase'], orderId = 'r1'): MomentSnapshot => ({ orderId, phase, near: false, door: false, ride: true });
const LOUD: PublicSeason = { quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null, kind: 'ordinary', accent: true, ramadan: null, homeCard: null };
const QUIET: PublicSeason = { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: null, kind: 'quiet', accent: false, ramadan: null, homeCard: null };
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
  it('ride: matched when a driver takes it, driver_here at the pickup, picked_up when the trip starts', () => {
    expect(momentsBetween(ride('searching'), ride('to_pickup'))).toEqual(['matched']);
    expect(momentsBetween(ride('searching'), ride('at_pickup'))).toEqual(['matched', 'driver_here']);
    expect(momentsBetween(ride('to_pickup'), ride('at_pickup'))).toEqual(['driver_here']);
    expect(momentsBetween(ride('at_pickup'), ride('at_pickup'))).toEqual([]);
    expect(momentsBetween(ride('at_pickup'), ride('on_the_way'))).toEqual(['picked_up']);
    expect(momentsBetween(ride('reassigning'), ride('to_pickup'))).toEqual(['matched']);
    expect(momentsBetween(null, ride('at_pickup'))).toEqual([]);
    expect(momentsBetween(ride('searching'), ride('cancelled'))).toEqual([]);
  });
  it('a food order never gets ride moments', () => {
    expect(momentsBetween(snap('preparing'), snap('at_pickup'))).toEqual([]);
    expect(momentsBetween(snap('preparing'), snap('to_pickup'))).toEqual([]);
  });
  it('feedback: matched buzzes success with the accepted cue; quiet days drop the cue and the celebration', () => {
    expect(momentFeedback('matched', LOUD)).toEqual({ haptics: ['success'], cue: 'accepted' });
    expect(momentFeedback('matched', QUIET)).toEqual({ haptics: ['medium'], cue: null });
    expect(momentFeedback('driver_here', LOUD)).toEqual({ haptics: ['heavy', 'heavy'], cue: 'near' });
    expect(momentFeedback('driver_here', QUIET)).toEqual({ haptics: ['heavy', 'heavy'], cue: null });
    expect(momentFeedback('near', QUIET)).toEqual({ haptics: ['medium'], cue: null });
    expect(momentFeedback('accepted', LOUD)).toEqual({ haptics: ['light'], cue: 'accepted' });
    expect(momentFeedback('delivered', LOUD)).toEqual({ haptics: [], cue: 'delivered' });
    expect(momentFeedback('at_door', LOUD)).toEqual({ haptics: ['medium'], cue: null });
  });
  it('matched is fresh for 4 s from the server accept', () => {
    expect(rideMatchedFresh(new Date(10_000), 13_999)).toBe(true);
    expect(rideMatchedFresh(new Date(10_000), 14_000)).toBe(false);
    expect(rideMatchedFresh(null, 0)).toBe(false);
  });
});

describe('the driver reveal (joy l2)', () => {
  const food = (phase: MomentSnapshot['phase'], courier: boolean): MomentSnapshot => ({ orderId: 'o1', phase, near: false, door: false, courier });
  it('a courier taking my food order is a moment; rides keep their own "matched"', () => {
    expect(momentsBetween(food('preparing', false), food('to_pickup', true))).toEqual(['courier_assigned']);
    expect(momentsBetween(food('preparing', false), food('preparing', true))).toEqual(['courier_assigned']);
    expect(momentsBetween(food('preparing', true), food('to_pickup', true))).toEqual([]);
    expect(momentsBetween(ride('searching'), ride('to_pickup'))).toEqual(['matched']);
  });
  it('not on the first read, not when the snapshot says nothing about the courier, not once he has the food', () => {
    expect(momentsBetween(null, food('to_pickup', true))).toEqual([]);
    expect(momentsBetween({ orderId: 'o1', phase: 'preparing', near: false, door: false }, food('to_pickup', true))).toEqual([]);
    expect(momentsBetween(food('preparing', false), food('on_the_way', true))).toEqual(['picked_up']);
  });
  it('food reveal is a light buzz with no sound (the kitchen already chimed); the same on a quiet day', () => {
    expect(momentFeedback('courier_assigned', LOUD)).toEqual({ haptics: ['light'], cue: null });
    expect(momentFeedback('courier_assigned', QUIET)).toEqual({ haptics: ['light'], cue: null });
    expect(momentFeedback('matched', QUIET)).toEqual({ haptics: ['medium'], cue: null });
  });
  it('plays once per order: live, or opened within a minute of the accept', () => {
    const now = Date.parse('2026-10-07T15:00:00Z');
    const ago = (ms: number) => new Date(now - ms);
    expect(revealPlays({ seen: false, liveTransition: true, acceptedAt: ago(5 * 60_000), now })).toBe(true);
    expect(revealPlays({ seen: false, liveTransition: false, acceptedAt: ago(20_000), now })).toBe(true);
    expect(revealPlays({ seen: false, liveTransition: false, acceptedAt: ago(REVEAL_FRESH_MS + 1), now })).toBe(false);
    expect(revealPlays({ seen: false, liveTransition: false, acceptedAt: null, now })).toBe(false);
    expect(revealPlays({ seen: true, liveTransition: true, acceptedAt: ago(1000), now })).toBe(false);
    expect(revealSeenKey('ord/1')).toBe('driver.customer.reveal-seen.ord_1');
  });
});
