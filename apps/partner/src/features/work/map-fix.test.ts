import { describe, expect, it } from 'vitest';
import { askedKey, mapFixFailed, mapFixKinds, pickupAskDistance } from './map-fix';

const PIN = { lat: 32.9093, lng: 45.0636 };
/** About 55 m north of the pin. */
const NEAR = { lat: 32.9098, lng: 45.0636 };

describe('«صلّح الخريطة»', () => {
  it('asks after a pickup 40–400 m from the pin, with a good fix only', () => {
    expect(pickupAskDistance(PIN, { ...NEAR, accuracyM: 8 })).toBe(56);
    expect(pickupAskDistance(PIN, { lat: 32.9095, lng: 45.0636, accuracyM: 8 })).toBeNull();
    expect(pickupAskDistance(PIN, { ...NEAR, accuracyM: 60 })).toBeNull();
    expect(pickupAskDistance(PIN, { lat: 32.92, lng: 45.0636 })).toBeNull();
    expect(pickupAskDistance(null, NEAR)).toBeNull();
    expect(pickupAskDistance(PIN, null)).toBeNull();
  });

  it('offers the kitchen choices only when the stop names one of ours', () => {
    expect(mapFixKinds(true)).toEqual(['moved', 'wrong_name', 'closed', 'new_place']);
    expect(mapFixKinds(false)).toEqual(['new_place']);
  });

  it('keeps one key per kitchen that the phone store accepts', () => {
    expect(askedKey('org_k1')).toBe('driver.partner.mapfix.asked.org_k1');
    expect(askedKey('a/b c')).toMatch(/^[\w.-]+$/);
  });

  it('tells him why a report did not go', () => {
    expect(mapFixFailed('map_reports_limit', true)).toBe('partner.mapfix_limit');
    expect(mapFixFailed('outside_zone', true)).toBe('partner.mapfix_outside');
    expect(mapFixFailed(null, false)).toBe('partner.mapfix_offline');
    expect(mapFixFailed('boom', true)).toBe('partner.mapfix_error');
  });
});
