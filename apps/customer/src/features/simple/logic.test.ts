import { describe, expect, it } from 'vitest';
import type { Spot } from '@/features/ride/logic';
import { goHomeStep, homeOf } from './logic';

const spot = (id: string, lat: number, lng: number, savedLabel?: Spot['savedLabel']): Spot => ({
  id,
  kind: savedLabel ? 'saved' : 'pin',
  title: id,
  zoneId: 'street_30',
  pin: { lat, lng },
  ...(savedLabel ? { savedLabel } : {}),
});
const home = spot('home', 32.9096, 45.0636, 'home');
// About 1.3 km north of home.
const market = spot('here', 32.9213, 45.0636);

describe('«رجعني للبيت» in simple mode (ride idea v2)', () => {
  it('asks for the home first when none is saved', () => {
    expect(goHomeStep(null, { spot: market, weak: false })).toEqual({ kind: 'set_home' });
    expect(goHomeStep(null, 'denied')).toEqual({ kind: 'set_home' });
  });

  it('a good fix away from home books from where he is, to home', () => {
    expect(goHomeStep(home, { spot: market, weak: false })).toEqual({
      kind: 'book',
      pickup: market,
      home,
    });
  });

  it('says he is home when the fix is at the house, even a weak one', () => {
    const door = spot('here', 32.9097, 45.0637);
    expect(goHomeStep(home, { spot: door, weak: false })).toEqual({ kind: 'at_home' });
    expect(goHomeStep(home, { spot: door, weak: true })).toEqual({ kind: 'at_home' });
  });

  it('no good fix: home is set and the pickup is asked', () => {
    for (const here of ['denied', 'none', 'outside'] as const)
      expect(goHomeStep(home, here)).toEqual({ kind: 'ask_pickup', home });
    expect(goHomeStep(home, { spot: market, weak: true })).toEqual({ kind: 'ask_pickup', home });
  });

  it('finds the saved home among the places', () => {
    expect(homeOf([spot('w', 1, 1, 'work'), home])).toBe(home);
    expect(homeOf([spot('w', 1, 1, 'work')])).toBeNull();
  });
});
