import { describe, expect, it } from 'vitest';
import { joinPhase, joinPlacesMax, shareFriends, shareSlots } from './share-car';

let n = 0;
const m = (places: number, state: 'joined' | 'left' | 'released' | 'paid') => ({ id: `rqs_${++n}`, firstName: null, places, amountIqd: places * 27_500, state, boardedBy: null });

describe('step 6: sharing the car', () => {
  it('lays the people out: the booker first, friends holding places, then empty places', () => {
    expect(shareSlots({ people: 4, bookerPlaces: 1, members: [m(2, 'joined'), m(1, 'left')] })).toEqual(['me', 'friend', 'friend', 'empty']);
    expect(shareSlots({ people: 3, bookerPlaces: 2, members: [] })).toEqual(['me', 'me', 'empty']);
    expect(shareSlots({ people: 2, bookerPlaces: 1, members: [m(1, 'paid')] })).toEqual(['me', 'friend']);
  });

  it('lists only friends who hold or paid', () => {
    expect(shareFriends([m(1, 'joined'), m(1, 'left'), m(1, 'released'), m(2, 'paid')]).map((x) => x.places)).toEqual([1, 2]);
  });

  it('caps the places a friend can pick', () => {
    expect(joinPlacesMax({ placesLeft: 3 })).toBe(3);
    expect(joinPlacesMax({ placesLeft: 9 })).toBe(6);
    expect(joinPlacesMax({ placesLeft: 0 })).toBe(0);
  });

  it('says what the friend’s page shows', () => {
    const base = { state: 'matched' as const, open: true, placesLeft: 2, myState: null };
    expect(joinPhase(base)).toBe('join');
    expect(joinPhase({ ...base, placesLeft: 0 })).toBe('full');
    expect(joinPhase({ ...base, open: false })).toBe('closed');
    expect(joinPhase({ ...base, myState: 'joined' })).toBe('joined');
    expect(joinPhase({ ...base, myState: 'left' })).toBe('join');
    expect(joinPhase({ ...base, state: 'driver_arrived', open: false, myState: 'joined' })).toBe('joined');
    expect(joinPhase({ ...base, state: 'completed', myState: 'paid' })).toBe('done');
    expect(joinPhase({ ...base, state: 'cancelled', myState: 'released' })).toBe('ended');
    expect(joinPhase({ ...base, state: 'cancelled' })).toBe('ended');
  });
});
