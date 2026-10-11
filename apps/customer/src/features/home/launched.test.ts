import { describe, expect, it } from 'vitest';
import { tileLaunched } from './launched';

describe('tileLaunched', () => {
  it('hides Baghdad/Kut and الرجعة while intercity is not launched', () => {
    const launch = ['food', 'taxi', 'tuktuk'] as const;
    expect(tileLaunched('trips', launch)).toBe(false);
    expect(tileLaunched('rajaa', launch)).toBe(false);
    expect(tileLaunched('food', launch)).toBe(true);
    expect(tileLaunched('taxi', launch)).toBe(true);
    expect(tileLaunched('tuktuk', launch)).toBe(true);
  });

  it('shows them once the city lists intercity', () => {
    expect(tileLaunched('trips', ['food', 'intercity'])).toBe(true);
    expect(tileLaunched('rajaa', ['food', 'intercity'])).toBe(true);
  });

  it('keeps them hidden until the server has said', () => {
    expect(tileLaunched('trips', undefined)).toBe(false);
    expect(tileLaunched('food', undefined)).toBe(true);
  });
});
