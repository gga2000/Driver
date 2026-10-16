import { RAJAA_REPUTATION_RULES, type RajaaDriverBadge, type RajaaDriverStats, type RajaaRatingTag } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { IconName, StatStripItem } from '@driver/ui';
import type { TFn } from '@/lib/i18n';
import { countKey } from '@/lib/plural';

/**
 * How a الرجعة driver's record reads (ideas x12–x17, Ali 2026-10-07): the same words on the board
 * tile, the seat sheet, the boarding pass and his profile. Every number comes from the server, which
 * leaves it null until enough riders stand behind it; here null reads as «جديد», never as a dash.
 */

/** "4.9": one decimal always, so 5 reads "5.0" like every rating riders know. */
export function ratingValue(avg: number): string {
  return avg.toFixed(1);
}

/** "95%" (StatStrip and MeterBar isolate their values, so the sign stays after the number in Arabic). */
export function percentLabel(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The board tile's line: the rating beside a star icon (the font has no ★), then the trips, or
 * «سايق جديد» before his first trip. The star is drawn by the tile, so the rating comes apart.
 */
export function compactRecord(t: TFn, s: RajaaDriverStats): { rating: string | null; text: string } {
  const trips = s.trips > 0 ? t(countKey('rajaa.record_trips', s.trips), { n: s.trips }) : null;
  return { rating: s.ratingAvg !== null ? ratingValue(s.ratingAvg) : null, text: trips ?? t('rajaa.record_new_driver') };
}

/** The strip under his name: rating (or «جديد»), trips, and the on-time share once it can be judged. */
export function recordFacts(t: TFn, s: RajaaDriverStats, testID = 'driver-record'): StatStripItem[] {
  const rating: StatStripItem =
    s.ratingAvg !== null
      ? {
          value: ratingValue(s.ratingAvg),
          icon: 'star',
          iconFilled: true,
          label: t(countKey('rajaa.record_ratings', s.ratingCount), { n: s.ratingCount }),
          accessibilityLabel: t('rajaa.record_rating_a11y', { rating: ratingValue(s.ratingAvg), n: s.ratingCount }),
          testID: `${testID}-rating`,
        }
      : { value: t('rajaa.record_new'), label: t('rajaa.record_few_ratings'), testID: `${testID}-rating` };
  const items: StatStripItem[] = [rating, { value: String(s.trips), label: t('rajaa.record_trips_label'), testID: `${testID}-trips` }];
  if (s.onTimeShare !== null) items.push({ value: percentLabel(s.onTimeShare), label: t('rajaa.record_on_time'), testID: `${testID}-on-time` });
  return items;
}

export function tagLabel(t: TFn, tag: RajaaRatingTag): string {
  return t(`rajaa.rate_tag.${tag}` as MessageKey);
}

/** «الركاب يگولون: على الوقت، سيارة نظيفة», or null before there is anything to say. */
export function peopleSay(t: TFn, s: RajaaDriverStats): string | null {
  return s.topTags.length ? t('rajaa.record_people_say', { tags: s.topTags.map((x) => tagLabel(t, x)).join('، ') }) : null;
}

/** «سافرت وياه قبل» (x17), with the count from the second trip on; null when never. */
export function rodeBefore(t: TFn, n: number): string | null {
  return n > 0 ? t(countKey('rajaa.rode_before', n), { n }) : null;
}

export const BADGE_ICON: Record<RajaaDriverBadge, IconName> = {
  top_driver: 'award',
  family_trusted: 'family',
  no_smoking: 'no-smoking',
  big_bags: 'suitcase',
};

/** The badge's name and the one line that says how it was earned (the rule's own numbers). */
export function badgeCopy(t: TFn, badge: RajaaDriverBadge): { title: string; body: string } {
  const R = RAJAA_REPUTATION_RULES;
  switch (badge) {
    case 'top_driver':
      return {
        title: t('rajaa.badge.top_driver'),
        body: t('rajaa.badge.top_driver_body', { rating: ratingValue(R.topDriver.minAverage), n: R.topDriver.minRatings, onTime: Math.round(R.topDriver.minOnTimeShare * 10) }),
      };
    case 'family_trusted':
      return { title: t('rajaa.badge.family_trusted'), body: t('rajaa.badge.family_trusted_body', { rating: ratingValue(R.familyTrusted.minAverage) }) };
    case 'no_smoking':
      return { title: t('rajaa.badge.no_smoking'), body: t('rajaa.badge.no_smoking_body') };
    case 'big_bags':
      return { title: t('rajaa.badge.big_bags'), body: t('rajaa.badge.big_bags_body') };
  }
}

/** First day of a Baghdad month from the server → «أيلول 2026». */
export function monthYear(t: TFn, at: Date): string {
  const baghdad = new Date(at.getTime() + 3 * 3600_000);
  return t('month.label', { month: t(`time.month_${baghdad.getUTCMonth() + 1}` as MessageKey), year: baghdad.getUTCFullYear() });
}
