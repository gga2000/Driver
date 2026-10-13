import { describe, expect, it } from 'vitest';
import { markIftarOrder, takeIftarOrder } from './iftar-order';

describe('«على الفطور» from home', () => {
  it('is taken once, and only for the kitchen that was marked', () => {
    markIftarOrder('khalid');
    expect(takeIftarOrder('sham')).toBe(false);
    expect(takeIftarOrder('khalid')).toBe(true);
    expect(takeIftarOrder('khalid')).toBe(false);
  });

  it('a second dish from the same kitchen still leaves one mark', () => {
    markIftarOrder('musafir');
    markIftarOrder('musafir');
    expect(takeIftarOrder('musafir')).toBe(true);
    expect(takeIftarOrder('musafir')).toBe(false);
  });
});
