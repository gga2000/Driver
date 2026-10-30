import { describe, expect, it } from 'vitest';
import { doorOpen, tileLaunched } from './launched';

describe('tileLaunched', () => {
  it('hides Baghdad/Kut and الرجعة while intercity is not launched', () => {
    const launch = ['food', 'taxi', 'tuktuk'] as const;
    expect(tileLaunched('trips', launch)).toBe(false);
    expect(tileLaunched('rajaa', launch)).toBe(false);
    expect(tileLaunched('food', launch)).toBe(true);
    expect(tileLaunched('taxi', launch)).toBe(true);
    expect(tileLaunched('tuktuk', launch)).toBe(true);
  });

  it('shows them once the city lists intercity', () => {
    expect(tileLaunched('trips', ['food', 'intercity'])).toBe(true);
    expect(tileLaunched('rajaa', ['food', 'intercity'])).toBe(true);
  });

  it('keeps them hidden until the server has said', () => {
    expect(tileLaunched('trips', undefined)).toBe(false);
    expect(tileLaunched('food', undefined)).toBe(true);
  });
});

describe('doorOpen', () => {
  it('opens the «طرود» door (and takes its chip out of «جاي قريب») once the city lists parcels', () => {
    expect(doorOpen('parcel', ['food', 'parcel'])).toBe(true);
    expect(doorOpen('parcel', ['food', 'taxi'])).toBe(false);
    expect(doorOpen('parcel', undefined)).toBe(false);
  });

  it('leaves the services with no door yet in «جاي قريب»', () => {
    expect(doorOpen('grocery', ['grocery'])).toBe(false);
    expect(doorOpen('khat', ['khat'])).toBe(false);
  });
});
