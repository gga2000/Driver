import { describe, expect, it } from 'vitest';
import { colourRequired, featuresChanged, featureState, featuresSummary, hasFeatures, isModelValid, modelRequired, normalizeModel, offeredFeatures, toggleFeature } from './logic';

describe('«مميزات سيارتك»', () => {
  it('offers a car everything (AC and heating first), a tuktuk only the quiet ones, a bike nothing', () => {
    expect(offeredFeatures('car')).toEqual({ loud: ['ac', 'heating'], quiet: ['family', 'no_smoking', 'big_boot', 'child_seat'] });
    expect(offeredFeatures('tuktuk')).toEqual({ loud: [], quiet: ['family', 'no_smoking', 'child_seat'] });
    expect(hasFeatures('bike')).toBe(false);
    expect(hasFeatures('tuktuk')).toBe(true);
  });

  it('says where each saved feature stands', () => {
    const v = { features: ['ac' as const, 'family' as const], featuresConfirmed: ['ac' as const] };
    expect(featureState(v, 'ac')).toBe('confirmed');
    expect(featureState(v, 'family')).toBe('pending');
    expect(featureState(v, 'heating')).toBe('off');
    expect(featuresSummary(v)).toEqual({ confirmed: ['ac'], pending: ['family'] });
  });

  it('toggles in display order and notices a change only when the set differs', () => {
    expect(toggleFeature(['family'], 'ac')).toEqual(['ac', 'family']);
    expect(toggleFeature(['ac', 'family'], 'ac')).toEqual(['family']);
    expect(featuresChanged(['ac', 'family'], ['family', 'ac'])).toBe(false);
    expect(featuresChanged(['ac'], ['ac', 'heating'])).toBe(true);
  });
});

describe('a new vehicle’s model and colour', () => {
  it('a car needs its model and colour; a tuktuk its colour; a bike neither', () => {
    expect([modelRequired('car'), colourRequired('car')]).toEqual([true, true]);
    expect([modelRequired('tuktuk'), colourRequired('tuktuk')]).toEqual([false, true]);
    expect([modelRequired('bike'), colourRequired('bike')]).toEqual([false, false]);
  });

  it('cleans the model and checks its length', () => {
    expect(normalizeModel('  تويوتا   كورولا ')).toBe('تويوتا كورولا');
    expect(isModelValid('', 'car')).toBe(false);
    expect(isModelValid('', 'tuktuk')).toBe(true);
    expect(isModelValid('ك', 'tuktuk')).toBe(false);
    expect(isModelValid('كيا سيراتو', 'car')).toBe(true);
    expect(isModelValid('x'.repeat(41), 'car')).toBe(false);
  });
});
