import { describe, expect, it } from 'vitest';
import type { RestaurantCard } from '@driver/contracts';
import { bubbleIds, fastest, filterPins, framePoints, headline, homeOf, kindOf, livePins, minutesLeft, MINUTES_CHIP, orderStep, showsOnLiveMap, TOWN_CENTRE, tourPlan } from './logic';

const card = (id: string, o: Partial<RestaurantCard> = {}): RestaurantCard =>
  ({ id, cuisine: 'مشويات', tags: [], photoUrl: null, open: true, etaMinMinutes: 20, pickup: { zoneKey: 'z', pin: { lat: 32.91, lng: 45.06 } }, ...o }) as RestaurantCard;

describe('the customer live map', () => {
  it('tells food, tea and coffee, and bakeries apart', () => {
    expect(kindOf({ cuisine: 'مقهى', tags: [] })).toBe('coffee');
    expect(kindOf({ cuisine: 'أكلات', tags: ['شاي ومعجنات'] })).toBe('bakery');
    expect(kindOf({ cuisine: 'Grill', tags: ['rice'] })).toBe('food');
  });

  it('marks shops cooking from the town picture, only open ones, and leaves pinless shops off', () => {
    const pins = livePins([card('a'), card('b', { open: false }), card('c', { pickup: null })], { cooking: [{ id: 'a', at: { lat: 0, lng: 0 } }, { id: 'b', at: { lat: 0, lng: 0 } }] });
    expect(pins.map((p) => [p.id, p.cooking, p.minutes])).toEqual([
      ['a', true, 20],
      ['b', false, null],
    ]);
    expect(pins[0]!.at).toEqual([45.06, 32.91]);
  });

  it('the 25-minute chip keeps open shops that make it, with the kind chip on top', () => {
    const pins = livePins([card('fast', { etaMinMinutes: MINUTES_CHIP }), card('slow', { etaMinMinutes: 40 }), card('cafe', { cuisine: 'قهوة', etaMinMinutes: 10 }), card('shut', { open: false })], null);
    expect(filterPins(pins, 'all', true).map((p) => p.id)).toEqual(['fast', 'cafe']);
    expect(filterPins(pins, 'coffee', false).map((p) => p.id)).toEqual(['cafe']);
    expect(filterPins(pins, 'food', false).map((p) => p.id)).toEqual(['fast', 'slow', 'shut']);
  });

  it('bubbles go to cooking shops first, then the soonest; closed shops stay dots', () => {
    const pins = livePins([card('a', { etaMinMinutes: 10 }), card('b', { etaMinMinutes: 30 }), card('c', { etaMinMinutes: 5 }), card('x', { open: false })], { cooking: [{ id: 'b', at: { lat: 0, lng: 0 } }] });
    expect([...bubbleIds(pins, 2)]).toEqual(['b', 'c']);
    expect(bubbleIds(pins).has('x')).toBe(false);
  });

  it('the rail is open shops soonest first', () => {
    const pins = livePins([card('a', { etaMinMinutes: 30 }), card('b', { etaMinMinutes: 12 }), card('c', { open: false }), card('d', { etaMinMinutes: null })], null);
    expect(fastest(pins).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('the top line counts cooking shops and the drivers around', () => {
    const pins = livePins([card('a'), card('b')], { cooking: [{ id: 'a', at: { lat: 0, lng: 0 } }] });
    expect(headline(pins, { drivers: [{ at: { lat: 0, lng: 0 }, n: 3 }, { at: { lat: 0, lng: 0 }, n: 4 }] })).toEqual({ cooking: 1, drivers: 7 });
    expect(headline(pins, null).drivers).toBe(0);
  });

  it('the tour picks cooking shops with photos first, five at most, never closed ones', () => {
    const cards = [card('plain', { etaMinMinutes: 5 }), card('photo', { photoUrl: 'x' }), card('cook'), card('both', { photoUrl: 'x' }), card('shut', { open: false, photoUrl: 'x' })];
    const plan = tourPlan(livePins(cards, { cooking: ['cook', 'both'].map((id) => ({ id, at: { lat: 0, lng: 0 } })) }));
    expect(plan.map((p) => p.id)).toEqual(['both', 'cook', 'photo', 'plain']);
  });

  it('opens on their place, or the town centre when they have none', () => {
    expect(homeOf({ lat: 1, lng: 2 })).toEqual({ at: { lat: 1, lng: 2 }, isHome: true });
    expect(homeOf(null)).toEqual({ at: TOWN_CENTRE, isHome: false });
  });
});

describe('your order on the live map', () => {
  it('maps the tracking phase to the four steps', () => {
    expect(['waiting_merchant', 'preparing', 'to_pickup', 'on_the_way', 'arrived'].map(orderStep)).toEqual([0, 1, 1, 2, 3]);
  });

  it('only food orders show, and minutes never drop under one', () => {
    expect(showsOnLiveMap({ type: 'food' })).toBe(true);
    expect(showsOnLiveMap({ type: 'ride' })).toBe(false);
    expect(showsOnLiveMap(null)).toBe(false);
    expect(minutesLeft(new Date(10 * 60_000 + 1), 0)).toBe(11);
    expect(minutesLeft(new Date(0), 60_000)).toBe(1);
    expect(minutesLeft(null, 0)).toBeNull();
  });
});

describe('the camera', () => {
  it('frames their place with the named shops, or the order end to end', () => {
    const pins = livePins([card('a'), card('b', { open: false })], null);
    expect(framePoints([45.061, 32.911], pins, new Set(['a']), null)).toEqual([[45.061, 32.911], [45.06, 32.91]]);
    // A named shop across town stays out of the first frame.
    expect(framePoints([45.2, 32.91], pins, new Set(['a']), null)).toEqual([[45.2, 32.91]]);
    const order = { id: 'o', kitchen: { at: [2, 2] as [number, number], name: 'k' }, courier: null, route: null, door: null, cooking: true };
    expect(framePoints([1, 1], pins, new Set(['a']), order)).toEqual([[2, 2], [1, 1]]);
  });
});
