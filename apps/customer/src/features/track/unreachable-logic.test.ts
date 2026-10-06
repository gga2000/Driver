import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import { metresFromDoor, standingLine, unreachableLeftMs } from './unreachable-logic';

const t = createT('ar-IQ');
const DOOR = { lat: 32.9, lng: 45.07 };
/** About `m` metres north of the door. */
const north = (m: number) => ({ lat: DOOR.lat + m / 111_320, lng: DOOR.lng });

describe('unreachable: where he stands (f18, L-10)', () => {
  it('metres from the door, to the nearest 5, null without a fix or a door', () => {
    expect(metresFromDoor(north(42), DOOR)).toBe(40);
    expect(metresFromDoor(north(38), DOOR)).toBe(40);
    expect(metresFromDoor(null, DOOR)).toBeNull();
    expect(metresFromDoor(north(10), null)).toBeNull();
  });
  it('says how far, or "at your door" when he is right there', () => {
    expect(standingLine(t, 'حيدر', 40)).toBe('حيدر واقف هنا · 40 متر من بابك');
    expect(standingLine(t, 'حيدر', 10)).toBe('حيدر واقف عند بابك');
    expect(standingLine(t, null, null)).toBe('الدليفري واقف عند بابك');
  });
  it('time left runs to the (possibly extended) fail time, never below zero', () => {
    const fail = new Date('2026-10-06T12:07:00Z');
    expect(unreachableLeftMs(fail, fail.getTime() - 90_000)).toBe(90_000);
    expect(unreachableLeftMs(fail, fail.getTime() + 5_000)).toBe(0);
  });
});
