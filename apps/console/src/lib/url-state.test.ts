import { describe, expect, it } from 'vitest';
import { readParams, writeParams } from './url-state';

const defaults = { view: 'all', zone: '', docs: '' };

describe('filters in the link', () => {
  it('writes only what differs from the defaults and keeps other params', () => {
    expect(writeParams('', { view: 'all', zone: '', docs: '' }, defaults)).toBe('');
    expect(writeParams('?x=1', { view: 'late', zone: 'z3', docs: '1' }, defaults)).toBe('?x=1&view=late&zone=z3&docs=1');
    expect(writeParams('?view=late&zone=z3', { view: 'all', zone: '', docs: '' }, defaults)).toBe('');
  });
  it('reads only known keys and known values', () => {
    expect(readParams('?view=late&zone=z3&q=0770&docs=1', defaults, { view: ['all', 'late'] })).toEqual({ view: 'late', zone: 'z3', docs: '1' });
    expect(readParams('?view=hack', defaults, { view: ['all', 'late'] })).toEqual({});
  });
});
