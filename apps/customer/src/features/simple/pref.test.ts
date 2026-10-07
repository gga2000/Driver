import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@/lib/storage';
import { createSimpleModeStore, SIMPLE_MODE_KEY } from './pref';

describe('«الوضع البسيط» switch (ride idea v2)', () => {
  it('off until turned on; the choice is kept on the device', async () => {
    const store = createMemoryStorage();
    const pref = createSimpleModeStore(store);
    expect(pref.getSnapshot()).toEqual({ loaded: false, on: false });
    await pref.load();
    expect(pref.getSnapshot()).toEqual({ loaded: true, on: false });
    await pref.set(true);
    expect(store.dump()[SIMPLE_MODE_KEY]).toBe('on');
    const again = createSimpleModeStore(store);
    await again.load();
    expect(again.getSnapshot().on).toBe(true);
  });

  it('tells listeners at once, and a broken store leaves it off', async () => {
    const pref = createSimpleModeStore(createMemoryStorage());
    const seen: boolean[] = [];
    pref.subscribe(() => seen.push(pref.getSnapshot().on));
    await pref.set(true);
    await pref.set(false);
    expect(seen).toEqual([true, false]);
    const broken = createSimpleModeStore({
      getItem: () => Promise.reject(new Error('no')),
      setItem: () => Promise.reject(new Error('no')),
      removeItem: async () => undefined,
    });
    await broken.load();
    expect(broken.getSnapshot()).toEqual({ loaded: true, on: false });
    await broken.set(true);
    expect(broken.getSnapshot().on).toBe(true);
  });

  it('reads anything but "on" as off', async () => {
    const pref = createSimpleModeStore(createMemoryStorage({ [SIMPLE_MODE_KEY]: 'yes' }));
    await pref.load();
    expect(pref.getSnapshot().on).toBe(false);
  });
});
