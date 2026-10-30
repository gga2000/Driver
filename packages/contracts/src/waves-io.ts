import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { CityId } from './common.js';

/**
 * Customer waves (plan W5, decision D-24): more people want to order than the kitchens can cook, so
 * customers are let in per zone, in waves. Sign-up stays open and anyone may browse; a person past
 * their zone's open places waits («نبلّغك من يصير دورك») and cannot place a food order until they are
 * let in, then gets one message. A zone with no wave set is open to everyone — that is the default,
 * so nothing changes until ops sets a number.
 */
export const WAVE_RULES = {
  /** How often waiting people are let in when places open (a raised number, or a zone opened). */
  sweepEveryMs: 60_000,
  /** At most this many people are let in per zone in one sweep (the rest follow on the next). */
  admitPerSweep: 200,
  /** The largest number of places ops may set for one zone. */
  maxSlots: 100_000,
} as const;

/**
 * - `open`: let in (or the zone has no wave) — order as usual.
 * - `waiting`: on the zone's waitlist; `ahead` people joined before them.
 * - `needs_place`: waves are on in this city and the person has no saved place yet, so we don't know
 *   their zone: saving a place puts them in line.
 */
export const AccessState = z.enum(['open', 'waiting', 'needs_place']);
export type AccessState = z.infer<typeof AccessState>;

export const AccessView = z.object({
  state: AccessState,
  zoneKey: z.string().nullable(),
  /** Zone name for the waiting screen («حي الحسين»); null when unknown. */
  zoneNameAr: z.string().nullable(),
  /** People in the same zone who joined earlier and are still waiting (waiting only). */
  ahead: z.number().int().nullable(),
  /** When they joined the waitlist (waiting only). */
  waitingSince: z.coerce.date().nullable(),
});
export type AccessView = z.infer<typeof AccessView>;

export const ZoneWaveView = z.object({
  zoneKey: z.string(),
  name_ar: z.string(),
  /** Customers this zone lets in; null = no wave (open to everyone). */
  openSlots: z.number().int().nullable(),
  /** People let in so far in this zone (they keep their place even if the number goes down). */
  admitted: z.number().int(),
  waiting: z.number().int(),
  setAt: z.coerce.date().nullable(),
});
export type ZoneWaveView = z.infer<typeof ZoneWaveView>;

export const WavesView = z.object({
  cityId: z.string(),
  at: z.coerce.date(),
  zones: z.array(ZoneWaveView),
  /** Waiting with no saved place yet (no zone). */
  waitingWithoutZone: z.number().int(),
});
export type WavesView = z.infer<typeof WavesView>;

export const WavesInput = z.object({ cityId: CityId.default('aziziyah') });
export type WavesInput = z.input<typeof WavesInput>;

export const SetWaveSlotsInput = z.object({
  cityId: CityId.default('aziziyah'),
  zoneKey: z.string().trim().min(1).max(60),
  /** null switches the zone's wave off: everyone waiting there is let in. 0 = waitlist only. */
  openSlots: z.number().int().min(0).max(WAVE_RULES.maxSlots).nullable(),
});
export type SetWaveSlotsInput = z.input<typeof SetWaveSlotsInput>;

export interface AccessPort {
  /** The caller's place in line; the first call decides it (let in now, or wait). */
  status(actor: Actor): Promise<AccessView>;
  /** Console › الإطلاق: every zone's wave, let in and waiting. */
  waves(input: z.infer<typeof WavesInput>): Promise<WavesView>;
  /** Sets a zone's open places (audited); people waiting there are let in on the next sweep. */
  setSlots(actor: Actor, input: z.infer<typeof SetWaveSlotsInput>): Promise<ZoneWaveView>;
}
