import { describe, expect, it } from 'vitest';
import { createT } from '@driver/i18n';
import type { LandmarkNearView } from '@driver/contracts';
import { LANDMARK_NONE, landmarkChips, landmarkLeftBehind, landmarkName } from './landmark-chips';

const lm = (id: string, name_ar: string, name_en: string, distanceM: number): LandmarkNearView => ({
  id,
  name_ar,
  name_en,
  pin: { lat: 32.9098, lng: 45.0628 },
  zoneId: 'street_30',
  kind: 'meeting_point',
  category: 'other',
  aliases_ar: [],
  photoUrl: null,
  distanceM,
});

const NEAR = [lm('lm_mp_shari_30', 'تقاطع شارع ٣٠', 'Street 30 junction', 73), lm('lm_garage_bab2', 'كراج البوابة 2', 'Gate 2 garage', 144)];

describe('landmark chips — "قرب شنو؟" (maps program a2)', () => {
  it('reads «يم X» nearest first, Western digits, then "ولا وحدة"', () => {
    expect(landmarkChips(NEAR, 'ar-IQ', createT('ar-IQ')).map((c) => [c.id, c.label])).toEqual([
      ['lm_mp_shari_30', 'يم تقاطع شارع 30'],
      ['lm_garage_bab2', 'يم كراج البوابة 2'],
      [LANDMARK_NONE, 'ولا وحدة'],
    ]);
    expect(landmarkChips(NEAR, 'en', createT('en'))[0]!.label).toBe('By Street 30 junction');
    expect(landmarkName(NEAR[0]!, 'en')).toBe('Street 30 junction');
  });

  it('drops a choice only when the settled list for this pin no longer has it', () => {
    expect(landmarkLeftBehind('lm_mp_shari_30', NEAR, true)).toBe(false);
    expect(landmarkLeftBehind('lm_mp_jami_kabir', NEAR, true)).toBe(true);
    expect(landmarkLeftBehind('lm_mp_shari_30', [], true)).toBe(true);
    // Still loading the new pin's list, or nothing chosen: keep it.
    expect(landmarkLeftBehind('lm_mp_jami_kabir', NEAR, false)).toBe(false);
    expect(landmarkLeftBehind('lm_mp_jami_kabir', undefined, true)).toBe(false);
    expect(landmarkLeftBehind(null, NEAR, true)).toBe(false);
  });
});
