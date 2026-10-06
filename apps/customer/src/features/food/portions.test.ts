import { describe, expect, it } from 'vitest';
import type { MenuItem } from '@driver/contracts';
import { servesChosen, servesCopy } from './portions';

const RLI = '⁧';
const PDI = '⁩';

describe('servesCopy: «يشبّع» in the kitchen’s own numbers', () => {
  it('one person, a fixed number, a range low to high', () => {
    expect(servesCopy({ min: 1, max: 1 })).toEqual({ key: 'item.serves_one' });
    expect(servesCopy({ min: 2, max: 2 })).toEqual({ key: 'item.serves_n', params: { n: 2 } });
    expect(servesCopy({ min: 2, max: 3 })).toEqual({ key: 'item.serves_range', params: { range: `${RLI}2–3${PDI}` } });
  });
  it('nothing said, nothing shown', () => {
    expect(servesCopy(null)).toBeNull();
    expect(servesCopy(undefined)).toBeNull();
  });
});

describe('servesChosen', () => {
  const kilo: Pick<MenuItem, 'serves' | 'modifierGroups'> = {
    serves: null,
    modifierGroups: [
      {
        id: 'g',
        name: 'الكمية',
        required: true,
        min: 1,
        max: 1,
        variant: true,
        modifiers: [
          { id: 'half', name: 'نص كيلو', priceIqd: 0, available: true, serves: { min: 2, max: 3 } },
          { id: 'kilo', name: 'كيلو', priceIqd: 11000, available: true, serves: { min: 4, max: 5 } },
        ],
      },
    ],
  };
  it('the picked version says it', () => {
    expect(servesChosen(kilo, { g: ['kilo'] })).toEqual({ min: 4, max: 5 });
    expect(servesChosen(kilo, { g: ['half'] })).toEqual({ min: 2, max: 3 });
  });
  it('otherwise the dish, otherwise nothing', () => {
    expect(servesChosen({ ...kilo, serves: { min: 2, max: 2 } }, {})).toEqual({ min: 2, max: 2 });
    expect(servesChosen(kilo, {})).toBeNull();
  });
});
