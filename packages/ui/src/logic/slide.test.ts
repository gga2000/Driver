import { describe, expect, it } from 'vitest';
import {
  SLIDE_CONFIRM_AT,
  SLIDE_FLING_VELOCITY,
  SLIDE_INSET,
  SLIDE_THUMB_SIZE,
  slideLabelOpacity,
  slideMode,
  slideOffset,
  slideProgress,
  slideRelease,
  slideTickCrossed,
  slideTravel,
} from './slide';

describe('slide to confirm', () => {
  it('travel is the track minus the thumb and both insets, never negative', () => {
    expect(slideTravel(358)).toBe(358 - SLIDE_THUMB_SIZE - 2 * SLIDE_INSET);
    expect(slideTravel(40)).toBe(0);
  });

  it('RTL: dragging left is forward, right is clamped at the start', () => {
    expect(slideProgress(-150, 300, true)).toBeCloseTo(0.5);
    expect(slideProgress(150, 300, true)).toBe(0);
    expect(slideProgress(-900, 300, true)).toBe(1);
  });

  it('LTR: dragging right is forward', () => {
    expect(slideProgress(150, 300, false)).toBeCloseTo(0.5);
    expect(slideProgress(-150, 300, false)).toBe(0);
  });

  it('no track yet means no progress', () => {
    expect(slideProgress(-100, 0, true)).toBe(0);
  });

  it('the thumb moves left in RTL and right in LTR', () => {
    expect(slideOffset(1, 280, true)).toBe(-280);
    expect(slideOffset(0.5, 280, false)).toBe(140);
    expect(slideOffset(2, 280, false)).toBe(280);
  });

  it('confirms past 85 %, springs back short of it', () => {
    expect(slideRelease(SLIDE_CONFIRM_AT, 0, true)).toBe('confirm');
    expect(slideRelease(0.84, 0, true)).toBe('reset');
    expect(slideRelease(0.2, 0, false)).toBe('reset');
  });

  it('a forward flick from half way confirms; a backward one or one from too early does not', () => {
    expect(slideRelease(0.55, -SLIDE_FLING_VELOCITY, true)).toBe('confirm');
    expect(slideRelease(0.55, SLIDE_FLING_VELOCITY, true)).toBe('reset');
    expect(slideRelease(0.55, SLIDE_FLING_VELOCITY, false)).toBe('confirm');
    expect(slideRelease(0.3, -3000, true)).toBe('reset');
  });

  it('haptic ticks fire once, going forward only', () => {
    expect(slideTickCrossed(0.2, 0.3)).toBe(0);
    expect(slideTickCrossed(0.3, 0.4)).toBe(-1);
    expect(slideTickCrossed(0.49, 0.5)).toBe(1);
    expect(slideTickCrossed(0.8, 0.7)).toBe(-1);
  });

  it('the label fades as the thumb covers it', () => {
    expect(slideLabelOpacity(0)).toBe(1);
    expect(slideLabelOpacity(0.3)).toBeCloseTo(0.5);
    expect(slideLabelOpacity(0.9)).toBe(0);
  });

  it('reduced motion turns the slide into press-and-hold', () => {
    expect(slideMode('auto', true)).toBe('hold');
    expect(slideMode('auto', false)).toBe('slide');
    expect(slideMode('slide', true)).toBe('slide');
    expect(slideMode('hold', false)).toBe('hold');
  });
});
