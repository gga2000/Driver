import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '@/lib/storage';
import { createViewedStore, pushViewed } from './viewed';

const memory = (seed: Record<string, string> = {}): KeyValueStorage => {
  const m = new Map(Object.entries(seed));
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };
};

describe('«فتحتها قبل» (D-24)', () => {
  it('keeps the last three kitchens, newest first, each once', () => {
    let list = pushViewed([], { id: 'a', name: 'خالد' });
    list = pushViewed(list, { id: 'b', name: 'الشام' });
    list = pushViewed(list, { id: 'a', name: 'خالد' });
    list = pushViewed(list, { id: 'c', name: 'المسافر' });
    list = pushViewed(list, { id: 'd', name: 'كريم' });
    expect(list.map((r) => r.id)).toEqual(['d', 'c', 'a']);
  });

  it('survives a restart and ignores a broken entry', async () => {
    const store = memory({ 'driver.customer.search.viewed': JSON.stringify([{ id: 'x', name: 'خالد' }, { nope: 1 }]) });
    const s = createViewedStore(store);
    await s.load();
    expect(s.getSnapshot()).toEqual([{ id: 'x', name: 'خالد' }]);
    s.add({ id: 'y', name: 'الشام' });
    const again = createViewedStore(store);
    await again.load();
    expect(again.getSnapshot().map((r) => r.id)).toEqual(['y', 'x']);
    const broken = createViewedStore(memory({ 'driver.customer.search.viewed': '{oops' }));
    await broken.load();
    expect(broken.getSnapshot()).toEqual([]);
  });
});
