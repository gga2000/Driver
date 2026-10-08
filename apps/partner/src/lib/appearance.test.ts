import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './storage';
import { APPEARANCE_KEY, loadAppearancePref, nightFor, saveAppearancePref } from './appearance';

describe('night look choice (n2)', () => {
  it('auto follows the sky; day and night are fixed', () => {
    expect(nightFor('auto', true)).toBe(true);
    expect(nightFor('auto', false)).toBe(false);
    expect(nightFor('day', true)).toBe(false);
    expect(nightFor('night', false)).toBe(true);
  });

  it('keeps his choice on the phone and reads anything else as auto', async () => {
    const store = createMemoryStorage();
    await saveAppearancePref('night', store);
    expect(store.dump()[APPEARANCE_KEY]).toBe('night');
    expect(await loadAppearancePref(store)).toBe('night');
    expect(await loadAppearancePref(createMemoryStorage({ [APPEARANCE_KEY]: 'purple' }))).toBe('auto');
  });
});
