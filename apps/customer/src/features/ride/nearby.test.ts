import { describe, expect, it } from 'vitest';
import { matchVehicles, NEARBY_MATCH_M, type NearbySlot } from './nearby';

const at = (dLatM: number, dLngM = 0) => ({ lat: 32.9 + dLatM / 111_320, lng: 45.06 + dLngM / 93_400, heading: null });
const keys = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('matchVehicles — the same vehicle across refreshes without ids', () => {
  it('keeps the key of a vehicle that moved a little; new ones get new keys', () => {
    const prev: NearbySlot[] = [
      { ...at(0), key: 'a' },
      { ...at(1000), key: 'b' },
    ];
    const next = [at(40), at(1030), at(2500)];
    expect(matchVehicles(prev, next, keys()).map((s) => s.key)).toEqual(['a', 'b', 'n1']);
  });

  it('closest pairs win, and an old vehicle is used once', () => {
    const prev: NearbySlot[] = [{ ...at(0), key: 'a' }];
    // Both are near "a"; the closer one keeps its key, the other is new.
    expect(matchVehicles(prev, [at(120), at(20)], keys()).map((s) => s.key)).toEqual(['n1', 'a']);
  });

  it('too far to be the same one: a new key (the old one fades out)', () => {
    const prev: NearbySlot[] = [{ ...at(0), key: 'a' }];
    expect(matchVehicles(prev, [at(NEARBY_MATCH_M + 50)], keys())[0]!.key).toBe('n1');
    expect(matchVehicles([], [], keys())).toEqual([]);
  });
});
