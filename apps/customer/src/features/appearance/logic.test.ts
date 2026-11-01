import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '@/lib/storage';
import { parseAppearance, pickTheme } from './logic';
import { APPEARANCE_KEY, createAppearanceStore } from './pref';

describe('which colours the customer app wears (home redesign step 2)', () => {
  it('keeps today\'s istikan look while the new home is off, whatever the setting or the phone says', () => {
    for (const choice of ['auto', 'light', 'dark'] as const) {
      for (const phone of ['light', 'dark', null] as const) {
        expect(pickTheme({ newHome: false, choice, phone })).toBe('istikan');
      }
    }
  });

  it('with the new home on, تلقائي follows the phone: dark phone → emerald night, light or unknown → sage', () => {
    expect(pickTheme({ newHome: true, choice: 'auto', phone: 'dark' })).toBe('emeraldNight');
    expect(pickTheme({ newHome: true, choice: 'auto', phone: 'light' })).toBe('sage');
    expect(pickTheme({ newHome: true, choice: 'auto', phone: null })).toBe('sage');
  });

  it('فاتح and غامق override the phone', () => {
    expect(pickTheme({ newHome: true, choice: 'light', phone: 'dark' })).toBe('sage');
    expect(pickTheme({ newHome: true, choice: 'dark', phone: 'light' })).toBe('emeraldNight');
    expect(pickTheme({ newHome: true, choice: 'dark', phone: null })).toBe('emeraldNight');
  });

  it('reads anything it doesn\'t know as تلقائي', () => {
    expect(parseAppearance(null)).toBe('auto');
    expect(parseAppearance('night')).toBe('auto');
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('light')).toBe('light');
  });
});

describe('the حسابي choice is kept on this device', () => {
  it('تلقائي until chosen; the choice survives a restart; listeners hear it at once', async () => {
    const store = createMemoryStorage();
    const pref = createAppearanceStore(store);
    expect(pref.getSnapshot()).toEqual({ loaded: false, choice: 'auto' });
    const seen: string[] = [];
    pref.subscribe(() => seen.push(pref.getSnapshot().choice));
    await pref.load();
    await pref.set('dark');
    expect(store.dump()[APPEARANCE_KEY]).toBe('dark');
    expect(seen).toEqual(['auto', 'dark']);
    const again = createAppearanceStore(store);
    await again.load();
    expect(again.getSnapshot().choice).toBe('dark');
  });

  it('a broken store leaves it on تلقائي and the choice still applies for now', async () => {
    const broken = createAppearanceStore({
      getItem: () => Promise.reject(new Error('no')),
      setItem: () => Promise.reject(new Error('no')),
      removeItem: async () => undefined,
    });
    await broken.load();
    expect(broken.getSnapshot()).toEqual({ loaded: true, choice: 'auto' });
    await broken.set('light');
    expect(broken.getSnapshot().choice).toBe('light');
  });
});
