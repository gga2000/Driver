import { describe, expect, it } from 'vitest';
import { firstToOpen, nightHome } from './night';

const k = (id: string, open: boolean, opensInMin?: number, opensAt?: string) => ({ id, name: id, cuisine: 'كباب · تكة', open, ...(opensInMin !== undefined ? { opensInMin } : {}), ...(opensAt ? { opensAt } : {}) });

describe('night home (f12, UI/UX audit D-03)', () => {
  it('the first kitchen to open is the closed one with the fewest minutes to opening', () => {
    expect(firstToOpen([k('a', false, 300, '11:00'), k('b', false, 120, '9:00'), k('c', false)])?.id).toBe('b');
    expect(firstToOpen([k('a', false), k('c', false)])).toBeNull();
    // A kitchen without an opening time on file is never "first".
    expect(firstToOpen([k('a', false, 300, '11:00'), k('c', false, 10)])?.id).toBe('a');
  });

  it('night only when there are kitchens and none is open', () => {
    expect(nightHome([k('a', false, 60, '5:00')])).toMatchObject({ night: true, first: { id: 'a' } });
    expect(nightHome([k('a', true), k('b', false, 60, '5:00')])).toEqual({ night: false, first: null });
    expect(nightHome([])).toEqual({ night: false, first: null });
  });
});
