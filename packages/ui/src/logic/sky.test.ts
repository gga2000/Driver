import { describe, expect, it } from 'vitest';
import { decor } from '@driver/design-tokens';
import { skyHour, stageOf } from './sky';

describe('the hour’s sky on home', () => {
  it('dawn in the morning, noon blue, sunset rose, lilac late', () => {
    expect([5, 10, 11, 15, 16, 18, 19, 23, 0, 3].map(skyHour)).toEqual(['dawn', 'dawn', 'noon', 'noon', 'sunset', 'sunset', 'late', 'late', 'late', 'late']);
  });
});

describe('dish plates', () => {
  it('the same id always gets the same plate, from the theme’s set', () => {
    const stages = decor.istikan.stages;
    expect(stageOf('khalid_kebab', stages)).toBe(stageOf('khalid_kebab', stages));
    expect(stages).toContain(stageOf('x', stages));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => stageOf(id, stages))).size).toBeGreaterThan(2);
  });
});
