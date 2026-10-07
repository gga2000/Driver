import { describe, expect, it } from 'vitest';
import type { MenuItem, MenuModifierGroup } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import { createTasteStore, learnTaste, tasteKindOf, withTaste } from './taste';

const group = (id: string, name: string, options: string[], required = false): MenuModifierGroup => ({
  id,
  name,
  required,
  min: required ? 1 : 0,
  max: 1,
  variant: false,
  modifiers: options.map((o, i) => ({ id: `${id}${i}`, name: o, priceIqd: 0, available: true })),
});
const coffee: Pick<MenuItem, 'modifierGroups'> = { modifierGroups: [group('s', 'السكر', ['سادة', 'وسط', 'حلو']), group('h', 'الهيل', ['بالهيل', 'بلا هيل'])] };

describe('«مثل آخر مرة» (q2)', () => {
  it('knows the choices it remembers by their names', () => {
    expect(tasteKindOf('السكر')).toBe('sugar');
    expect(tasteKindOf('الهيل')).toBe('cardamom');
    expect(tasteKindOf('الثلج')).toBe('ice');
    expect(tasteKindOf('الحجم')).toBeNull();
  });

  it('learns what was picked and fills it in next time, on any café with the same choice', () => {
    const taste = learnTaste(coffee, { s: ['s0'], h: ['h1'] }, {});
    expect(taste).toEqual({ sugar: 'ساده', cardamom: 'بلا هيل' });
    const other = { modifierGroups: [group('x', 'سكر', ['حلو', 'سادة'])] };
    expect(withTaste(other, {}, taste)).toEqual({ selection: { x: ['x1'] }, filled: ['x'] });
  });

  it('never fills a required choice, a picked one, or an option the shop does not have', () => {
    const taste = { sugar: 'ساده' };
    expect(withTaste({ modifierGroups: [group('r', 'السكر', ['سادة'], true)] }, {}, taste).filled).toEqual([]);
    expect(withTaste(coffee, { s: ['s2'] }, taste).selection.s).toEqual(['s2']);
    expect(withTaste({ modifierGroups: [group('y', 'السكر', ['وسط', 'حلو'])] }, {}, taste).filled).toEqual([]);
  });

  it('is kept on the phone and forgotten on reset', async () => {
    const storage = createMemoryStorage();
    const store = createTasteStore(storage);
    await store.load();
    store.learn(coffee, { s: ['s1'] });
    const again = createTasteStore(storage);
    await again.load();
    expect(again.getSnapshot()).toEqual({ sugar: 'وسط' });
    again.reset();
    expect(again.getSnapshot()).toEqual({});
  });
});
