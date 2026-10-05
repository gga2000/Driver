import { describe, expect, it } from 'vitest';
import type { DeviceFix, LatLng } from '@driver/contracts';
import { assessFix } from './position-guard.js';

const NOW = new Date('2026-10-05T10:00:00Z');
const A: LatLng = { lat: 32.905, lng: 45.06 };
/** About `m` metres north of A. */
const north = (m: number): LatLng => ({ lat: A.lat + m / 111_195, lng: A.lng });
const fix = (over: Partial<DeviceFix> = {}): DeviceFix => ({ pin: A, at: NOW, ...over });
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('assessFix', () => {
  it('first fix: accepted and live', () => {
    expect(assessFix(fix(), null, NOW)).toEqual({ kind: 'accept', at: NOW, live: true, jump: false });
  });
  it('refuses fake-GPS and inaccurate fixes', () => {
    expect(assessFix(fix({ mocked: true }), null, NOW)).toEqual({ kind: 'reject', reason: 'mocked' });
    expect(assessFix(fix({ accuracyM: 80 }), null, NOW)).toEqual({ kind: 'reject', reason: 'inaccurate' });
    expect(assessFix(fix({ accuracyM: 75 }), null, NOW)).toMatchObject({ kind: 'accept' });
  });
  it('clamps a device clock running ahead to server time', () => {
    expect(assessFix(fix({ at: new Date(NOW.getTime() + 60_000) }), null, NOW)).toMatchObject({ kind: 'accept', at: NOW });
    const slight = new Date(NOW.getTime() + 3_000);
    expect(assessFix(fix({ at: slight }), null, NOW)).toMatchObject({ kind: 'accept', at: slight });
  });
  it('refuses fixes not newer than the last stored one', () => {
    expect(assessFix(fix({ at: ago(5_000) }), { at: ago(5_000), pin: A }, NOW)).toEqual({ kind: 'reject', reason: 'out_of_order' });
    expect(assessFix(fix({ at: ago(10_000) }), { at: ago(5_000), pin: A }, NOW)).toEqual({ kind: 'reject', reason: 'out_of_order' });
  });
  it('an offline replay older than 2 minutes is trail only', () => {
    expect(assessFix(fix({ at: ago(180_000) }), null, NOW)).toMatchObject({ kind: 'accept', live: false });
  });
  it('flags jumps that no vehicle can make, never small or slow ones', () => {
    expect(assessFix(fix({ pin: north(1_000) }), { at: ago(10_000), pin: A }, NOW)).toMatchObject({ kind: 'accept', jump: true });
    expect(assessFix(fix({ pin: north(250) }), { at: ago(1_000), pin: A }, NOW)).toMatchObject({ kind: 'accept', jump: false });
    expect(assessFix(fix({ pin: north(1_000) }), { at: ago(60_000), pin: A }, NOW)).toMatchObject({ kind: 'accept', jump: false });
  });
});
