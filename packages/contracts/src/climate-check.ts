import { z } from 'zod';
import { AZIZIYAH_GUARANTEE_SHIFTS } from './ledger-rules.js';
import { peakWindowAt } from './shift-guarantee.js';
import { climateAt } from './vehicle-features.js';

/**
 * «المكيّفة شغالة اليوم؟» (ride idea x1, cold car in summer): on a hot day a car driver whose AC ops
 * confirmed says once a shift whether it works today; on a cold day the same for heating. A «لا» takes
 * the tag off for the rest of that shift: riders don't see it and dispatch does not count him as an AC
 * (heated) car. No answer yet = the car check stands. No weather feed: `climateAt` is Aziziyah's
 * calendar and clock.
 */

/** The two features the weather asks about: AC on hot days, heating on cold ones. */
export const ClimateFeature = z.enum(['ac', 'heating']);
export type ClimateFeature = z.infer<typeof ClimateFeature>;

export const CLIMATE_CHECK_RULES = {
  /** A shift is one of Aziziyah's two (Ali, 2026-10-06): 06:00–15:00 and 15:00–02:00 Baghdad time. */
  shifts: AZIZIYAH_GUARANTEE_SHIFTS,
  offsetMin: 180,
} as const;

const HOUR_MS = 3_600_000;

/** One shift with hot (cold) hours still ahead: the question to ask, and how long its answer holds. */
export interface ClimateShift {
  /** `2026-07-14:day` — the shift the answer belongs to (the same ids as the shift guarantee's). */
  shiftId: string;
  climate: 'hot' | 'cold';
  feature: ClimateFeature;
  endsAt: Date;
}

export function climateFeatureOf(climate: 'hot' | 'cold'): ClimateFeature {
  return climate === 'hot' ? 'ac' : 'heating';
}

/**
 * The shift `at` falls in, when it still has a hot or cold hour ahead (06:30 on a July morning is
 * asked: the afternoon heat is coming in the same shift); null between shifts (02:00–06:00) and on mild
 * shifts. `climateAt` turns on whole Baghdad hours, so checking now and each coming hour is exact.
 */
export function climateShiftAt(at: Date): ClimateShift | null {
  const shift = peakWindowAt(at, CLIMATE_CHECK_RULES.shifts, CLIMATE_CHECK_RULES.offsetMin);
  if (!shift) return null;
  for (let t = at.getTime(); t < shift.to.getTime(); t = (Math.floor(t / HOUR_MS) + 1) * HOUR_MS) {
    const climate = climateAt(new Date(t));
    if (climate) return { shiftId: shift.id, climate, feature: climateFeatureOf(climate), endsAt: shift.to };
  }
  return null;
}

/** The shift a stored answer counts for right now (any shift, mild or not); null between shifts. */
export function shiftIdAt(at: Date): string | null {
  return peakWindowAt(at, CLIMATE_CHECK_RULES.shifts, CLIMATE_CHECK_RULES.offsetMin)?.id ?? null;
}

/**
 * `partner.status.climateCheck`: the question on the home screen while he is online on a hot (cold)
 * shift with confirmed AC (heating) on a car that drives rides. `working`: his answer this shift, null
 * until he gives one.
 */
export const PartnerClimateCheck = z.object({
  feature: ClimateFeature,
  climate: z.enum(['hot', 'cold']),
  shiftId: z.string(),
  endsAt: z.coerce.date(),
  working: z.boolean().nullable(),
});
export type PartnerClimateCheck = z.infer<typeof PartnerClimateCheck>;

/** `partner.answerClimateCheck`: نعم / لا. He may change it within the shift (it broke, it is fixed). */
export const AnswerClimateCheckInput = z.object({ working: z.boolean() });
export type AnswerClimateCheckInput = z.infer<typeof AnswerClimateCheckInput>;
