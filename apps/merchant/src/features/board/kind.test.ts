import { describe, expect, it, vi } from 'vitest';
import { lineLook, packApart } from './kind';

// The dish rules are pure; only their picture module pulls React Native, so stand it in for Node.
vi.mock('../../../../../packages/ui/src/art/dishes', () => ({ DISH_LOOKS: 3 }));

describe('lineLook (j6 / k4)', () => {
  it('reads drinks with their temperature', () => {
    expect(lineLook('چاي')).toEqual({ kind: 'drink', temp: 'hot' });
    expect(lineLook('عصير برتقال')).toEqual({ kind: 'drink', temp: 'cold' });
    expect(lineLook('آيس لاتيه')).toEqual({ kind: 'drink', temp: 'cold' });
  });

  it('reads sweets, and ice cream travels cold', () => {
    expect(lineLook('كنافة')).toEqual({ kind: 'sweet', temp: null });
    expect(lineLook('آيس كريم فانيلا')).toEqual({ kind: 'sweet', temp: 'cold' });
  });

  it('everything else is the kitchen', () => {
    expect(lineLook('لفة كباب')).toEqual({ kind: 'kitchen', temp: null });
    expect(lineLook('شي جديد')).toEqual({ kind: 'kitchen', temp: null });
  });
});

describe('packApart (k4)', () => {
  it('counts cold and hot pieces when an order has both', () => {
    expect(packApart([{ name: 'لفة كباب', qty: 2 }, { name: 'عصير رمان', qty: 1 }, { name: 'بيبسي', qty: 2 }])).toEqual({ cold: 3, hot: 2 });
  });

  it('says nothing when the bag is all hot, all cold, or only cool food', () => {
    expect(packApart([{ name: 'لفة كباب', qty: 2 }, { name: 'چاي', qty: 1 }])).toBeNull();
    expect(packApart([{ name: 'عصير برتقال', qty: 1 }, { name: 'سلطة', qty: 1 }])).toBeNull();
  });

  it('skips lines that will not go in the bag', () => {
    expect(packApart([{ name: 'لفة كباب', qty: 1 }, { name: 'عصير', qty: 1, availability: 'unavailable' }])).toBeNull();
  });
});
