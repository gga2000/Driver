import { describe, expect, it } from 'vitest';
import { motion } from '@driver/design-tokens';
import { digitRoll, fadeIn, hop, panelIn, pop, sheetIn, staggerDelay } from './presets';

describe('motion presets', () => {
  it('appear without motion when the phone asks for reduced motion', () => {
    for (const make of [fadeIn, panelIn, sheetIn, pop]) expect(make({ reduceMotion: true })).toBeUndefined();
    expect(hop({ reduceMotion: true })).toBe(0);
    expect(digitRoll(42, { reduceMotion: true })).toBe(42);
  });

  it('build entering animations on the tokens', () => {
    const f = fadeIn({ reduceMotion: false, delay: 80 });
    expect(f?.getDuration()).toBe(motion.duration.base);
    expect(f?.getDelay()).toBe(80);
    for (const make of [panelIn, sheetIn, pop]) expect(make({ reduceMotion: false })).toBeDefined();
  });

  it('animates values when motion is allowed', () => {
    expect(typeof hop({ reduceMotion: false })).not.toBe('number');
    expect(digitRoll(5, { reduceMotion: false })).not.toBe(5);
  });

  it('staggers only the first three items', () => {
    expect([0, 1, 2, 3, 9].map((i) => staggerDelay(i))).toEqual([0, motion.stagger, motion.stagger * 2, motion.stagger * 2, motion.stagger * 2]);
    expect(staggerDelay(-1)).toBe(0);
  });
});
