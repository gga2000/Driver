import { describe, expect, it } from 'vitest';
import { distanceWords } from './street-route';

describe('distanceWords', () => {
  it('says metres under a kilometre, kilometres above', () => {
    expect(distanceWords(30)).toEqual({ value: '50', unit: 'm' });
    expect(distanceWords(420)).toEqual({ value: '400', unit: 'm' });
    expect(distanceWords(2_437)).toEqual({ value: '2.4', unit: 'km' });
  });
});
