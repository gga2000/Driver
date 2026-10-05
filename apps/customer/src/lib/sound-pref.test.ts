import { describe, expect, it } from 'vitest';
import { SOUND_PREF_KEY, SoundPref } from './sound-pref';
import { createMemoryStorage } from './storage';

describe('tracking sounds switch', () => {
  it('is on by default and remembers being turned off', async () => {
    const store = createMemoryStorage();
    const pref = new SoundPref(store);
    await pref.load();
    expect(pref.enabled).toBe(true);
    const heard: boolean[] = [];
    pref.subscribe((on) => heard.push(on));
    await pref.set(false);
    expect(heard).toEqual([false]);
    expect(store.dump()[SOUND_PREF_KEY]).toBe('off');
    const again = new SoundPref(store);
    await again.load();
    expect(again.enabled).toBe(false);
  });
});
