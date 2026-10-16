import type { MenuItem } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { leftToday, onlyLeft } from './whats-left';

const item = (id: string, over: Partial<MenuItem> = {}) => ({ id, available: true, unavailableReason: null, ...over }) as MenuItem;
const out = (id: string) => item(id, { available: false, unavailableReason: 'sold_out' });
const later = (id: string) => item(id, { available: false, unavailableReason: 'schedule' });

describe('what is left today', () => {
  const menu = [
    { id: 'grill', items: [item('kebab'), out('tikka'), out('liver')] },
    { id: 'breakfast', items: [later('geymar'), out('beans')] },
    { id: 'drinks', items: [item('tea'), out('laban')] },
  ];

  it('counts sold-out dishes apart from ones that are only not served at this hour', () => {
    expect(leftToday(menu)).toEqual({ soldOut: 4, left: 2 });
  });

  it('keeps only what can be ordered now and drops sections left empty', () => {
    const left = onlyLeft(menu);
    expect(left.map((c) => c.id)).toEqual(['grill', 'drinks']);
    expect(left.flatMap((c) => c.items.map((i) => i.id))).toEqual(['kebab', 'tea']);
  });
});
