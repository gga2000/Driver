import type { Timetable } from '@driver/contracts';

/** Where a city's prayer times are computed: its centre, in degrees. */
export interface PrayerPlace {
  lat: number;
  lng: number;
}

/**
 * Season rules (customer joy J6). Every number here is a local religious or service choice the
 * local panel («مجلس الذوق», research 6 Appendix A) should confirm; the ones marked VERIFY LOCALLY
 * are flagged for Ali before Ramadan 2027 (≈ 8 Feb).
 */
export const SEASON_RULES = {
  /** City centres for the solar times; unknown cities use Aziziyah. */
  places: { aziziyah: { lat: 32.91, lng: 45.06 } } as Record<string, PrayerPlace>,
  defaultPlace: { lat: 32.91, lng: 45.06 } satisfies PrayerPlace,
  /**
   * Minutes after astronomical sunset at which each timetable's maghrib (iftar) falls.
   * Sunni maghrib is at sunset. Shia maghrib waits for the eastern redness to pass, commonly
   * 10–15 minutes later; 15 is the cautious end. VERIFY LOCALLY against the timetable Aziziyah's
   * Shia mosques print; ops can also set it per Ramadan period and override any single day.
   */
  maghribOffsetMin: { sunni: 0, shia: 15 } satisfies Record<Timetable, number>,
  /**
   * Sun depression for fajr (the end of suhoor), per timetable. 18° (Muslim World League) gives
   * the earlier, safer fajr for both. VERIFY LOCALLY: some Shia timetables use 16° (later fajr)
   * and many print an imsak about 10 minutes before fajr.
   */
  fajrAngleDeg: { sunni: 18, shia: 18 } satisfies Record<Timetable, number>,
  /** The «على الفطور» slot: the food arrives this long before the adhan. */
  iftarSlotLeadMin: 10,
  /** No offer is pushed from this long before the earliest iftar until the latest one. */
  promoHoldBeforeIftarMin: 20,
} as const;

export type SeasonRules = typeof SEASON_RULES;
