import { describe, expect, it } from 'vitest';
import { passPhase } from './pass';

const now = new Date('2026-10-06T12:00:00Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000);
const pass = (state: Parameters<typeof passPhase>[0]['state'], depState: Parameters<typeof passPhase>[0]['departure']['state'], inMin: number) =>
  passPhase({ state, departure: { state: depState, departAt: at(inMin) } }, now);

describe('passPhase', () => {
  it('counts down before boarding opens (T−30)', () => {
    expect(pass('booked', 'scheduled', 45)).toBe('before');
  });
  it('is boarding from T−30 or when the driver opened boarding', () => {
    expect(pass('booked', 'scheduled', 20)).toBe('boarding');
    expect(pass('booked', 'boarding', 50)).toBe('boarding');
  });
  it('is on the road once checked in or once the car left', () => {
    expect(pass('checked_in', 'boarding', 5)).toBe('onboard');
    expect(pass('booked', 'departed', -5)).toBe('onboard');
  });
  it('keeps a stub after the trip and closes the rest', () => {
    expect(pass('completed', 'arrived', -90)).toBe('kept');
    expect(pass('cancelled_by_rider', 'scheduled', 40)).toBe('closed');
    expect(pass('no_show', 'departed', -10)).toBe('closed');
  });
});
