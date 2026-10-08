import { describe, expect, it, vi } from 'vitest';

const set = vi.fn();
vi.mock('@driver/ui', () => ({ setDataSaverPref: (p: string) => set(p) }));
vi.mock('./storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined } }));

const { DATA_SAVER_KEY, liteHintFor, loadDataSaverPref, saveDataSaverPref } = await import('./data-saver-pref');
const memory = (seed: Record<string, string> = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k), m };
};

describe('low-data preference (maps program q2)', () => {
  it('auto until the customer chooses; the choice is kept on the device', async () => {
    const store = memory();
    expect(await loadDataSaverPref(store)).toBe('auto');
    await saveDataSaverPref('on', store);
    expect(store.m.get(DATA_SAVER_KEY)).toBe('on');
    expect(await loadDataSaverPref(store)).toBe('on');
    expect(await loadDataSaverPref(memory({ [DATA_SAVER_KEY]: 'garbage' }))).toBe('auto');
    expect(set).toHaveBeenLastCalledWith('auto');
  });

  it('the slow-network hint (g4) shows once, and never when low-data is already on', () => {
    expect(liteHintFor('auto', true, false)).toBe('auto');
    expect(liteHintFor('off', true, false)).toBe('off');
    expect(liteHintFor('on', true, false)).toBeNull();
    expect(liteHintFor('auto', false, false)).toBeNull();
    expect(liteHintFor('auto', true, true)).toBeNull();
  });
});
