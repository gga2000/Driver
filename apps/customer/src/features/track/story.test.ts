import { describe, expect, it } from 'vitest';
import { CLOSE_IN_M, LOOK_AHEAD, LOOK_BEHIND, storyShot } from './story';

const K = { lat: 32.906, lng: 45.061 };
const D = { lat: 32.896, lng: 45.071 };
const C = { lat: 32.9, lng: 45.065 };
const base = { ride: false, courier: null, kitchen: K, door: D, ahead: [K, D], toDoorM: null };

describe('story camera', () => {
  it('the kitchen close up while it cooks and nobody has the order', () => {
    expect(storyShot({ ...base, phase: 'preparing' })).toEqual({ points: [K], zoom: [15.8, 16.4] });
  });
  it('courier and kitchen while he goes to collect; courier and door on the way', () => {
    expect(storyShot({ ...base, phase: 'to_pickup', courier: C }).points).toEqual([C, K]);
    expect(storyShot({ ...base, phase: 'on_the_way', courier: C, toDoorM: 300 })).toEqual({ points: [C, D], zoom: [15.5, 17] });
  });
  it('on the way and still far: frames him with room ahead toward the door, not courier and door at opposite edges (f19)', () => {
    const shot = storyShot({ ...base, phase: 'on_the_way', courier: C, toDoorM: 900 });
    expect(shot.zoom).toEqual([12.5, 16.5]);
    expect(shot.points[0]).toEqual(C);
    const ahead = shot.points[1]!;
    expect(ahead.lat).toBeCloseTo(C.lat + (D.lat - C.lat) * LOOK_AHEAD, 9);
    expect(ahead.lng).toBeCloseTo(C.lng + (D.lng - C.lng) * LOOK_AHEAD, 9);
    // A little room behind him too, so he sits near the middle with more road ahead than behind.
    const behind = shot.points[2]!;
    expect(behind.lat).toBeCloseTo(C.lat - (D.lat - C.lat) * LOOK_BEHIND, 9);
    expect(LOOK_BEHIND).toBeLessThan(LOOK_AHEAD);
  });

  it('tightens on the door when he is close, and stays on it once delivered', () => {
    expect(storyShot({ ...base, phase: 'on_the_way', courier: C, toDoorM: CLOSE_IN_M - 1 }).zoom).toEqual([15.5, 17]);
    expect(storyShot({ ...base, phase: 'arrived' }).points).toEqual([D]);
  });
  it('rides frame everything still ahead', () => {
    expect(storyShot({ ...base, ride: true, phase: 'to_pickup', courier: C }).points).toEqual([C, K, D]);
  });
});
