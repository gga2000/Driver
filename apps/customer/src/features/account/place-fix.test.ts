import { describe, expect, it } from 'vitest';
import { judgeHereFix, PLACE_FIX_RULES } from './place-fix';

const home = { lat: 32.912, lng: 45.065 };

describe('«موقعي هنا» fix (HUNT-04, FLOW-21)', () => {
  it('a rough or unknown accuracy is never taken as the door', () => {
    expect(judgeHereFix({ pin: home, accuracyM: PLACE_FIX_RULES.maxAccuracyM + 1 }, home)).toEqual({ kind: 'rough', accuracyM: 41 });
    expect(judgeHereFix({ pin: home, accuracyM: null }, home)).toEqual({ kind: 'rough', accuracyM: null });
  });

  it('a good fix near the saved pin is fine; one far away asks first', () => {
    expect(judgeHereFix({ pin: { lat: 32.9125, lng: 45.065 }, accuracyM: 12 }, home)).toEqual({ kind: 'ok' });
    const far = judgeHereFix({ pin: { lat: 32.92, lng: 45.065 }, accuracyM: 12 }, home);
    expect(far.kind).toBe('far');
    expect(far.kind === 'far' && far.distanceM).toBeGreaterThan(800);
  });
});
