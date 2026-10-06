import { describe, expect, it } from 'vitest';
import { sheetCta, type GroupProblem } from './modifiers';

const bread: GroupProblem = { groupId: 'g1', name: 'الخبز', problem: 'too_few' };
const sauce: GroupProblem = { groupId: 'g2', name: 'الصوص', problem: 'too_few' };

describe('sheetCta: the greyed button explains itself (o4)', () => {
  it('adds when nothing is missing', () => {
    expect(sheetCta([], true)).toEqual({ kind: 'add' });
  });
  it('a missing required choice: «اختار الخبز», pointing at the first such group', () => {
    expect(sheetCta([bread, sauce], true)).toEqual({ kind: 'choose', groupId: 'g1', name: 'الخبز' });
  });
  it('too many picked, or not orderable: blocked', () => {
    expect(sheetCta([{ ...bread, problem: 'too_many' }], true)).toEqual({ kind: 'blocked' });
    expect(sheetCta([bread], false)).toEqual({ kind: 'blocked' });
    expect(sheetCta([], false)).toEqual({ kind: 'blocked' });
  });
});
