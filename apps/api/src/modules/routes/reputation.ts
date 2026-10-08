import {
  RAJAA_GOOD_TAGS,
  RAJAA_REPUTATION_RULES as R,
  type RajaaDriverBadge,
  type RajaaDriverStats,
  type RajaaPublicReview,
  type RajaaQualityBar,
  type RajaaRatingTag,
} from '@driver/contracts';
import type { BookingRecord, DepartureRecord } from './model.js';

/**
 * A الرجعة driver's record as riders see it (ideas x12–x17, Ali 2026-10-07). Pure: the caller passes
 * his finished runs, the rated bookings on them and how to judge a run's punctuality. A number shows
 * only once enough riders stand behind it (`RAJAA_REPUTATION_RULES`); below that it is null or empty,
 * never a misleading 5.0 from one rider.
 */

export interface ReputationInput {
  /** His finished runs (arrived or closed). */
  runs: readonly DepartureRecord[];
  /** Rated bookings on those runs. */
  rated: readonly BookingRecord[];
  /** The run was on time (garage meter within grace); null when it can't be judged. */
  onTime: (run: DepartureRecord) => boolean | null;
  /** Finished trips the viewer took with him. */
  viewerRides: number;
  /** The run being looked at: the driver's own word for the car. */
  vehicle: { noSmoking: boolean; bigBags: boolean };
}

const FAMILY_SIDE = new Set(['nisa', 'aila']);

function average(stars: readonly number[]): number | null {
  return stars.length === 0 ? null : stars.reduce((a, b) => a + b, 0) / stars.length;
}

/** One decimal, the way riders read a rating (4.86 → 4.9). */
export function roundRating(avg: number): number {
  return Math.round(avg * 10) / 10;
}

function tagCounts(rated: readonly BookingRecord[]): Map<RajaaRatingTag, number> {
  const counts = new Map<RajaaRatingTag, number>();
  for (const b of rated) for (const tag of new Set(b.rating!.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return counts;
}

/** Share of judged runs that were on time; null under `minRunsForOnTime` judged runs. */
export function onTimeShare(runs: readonly DepartureRecord[], onTime: ReputationInput['onTime']): number | null {
  const judged = runs.map(onTime).filter((x): x is boolean => x !== null);
  if (judged.length < R.minRunsForOnTime) return null;
  return judged.filter(Boolean).length / judged.length;
}

/** The earned badges plus the two the driver declares for the run. Raw averages, not rounded ones, decide. */
export function driverBadges(
  rated: readonly BookingRecord[],
  share: number | null,
  vehicle: ReputationInput['vehicle'],
): RajaaDriverBadge[] {
  const badges: RajaaDriverBadge[] = [];
  const avg = average(rated.map((b) => b.rating!.stars));
  const top = R.topDriver;
  if (rated.length >= top.minRatings && avg !== null && avg >= top.minAverage && share !== null && share >= top.minOnTimeShare) badges.push('top_driver');
  const fam = R.familyTrusted;
  const family = rated.filter((b) => FAMILY_SIDE.has(b.travellingAs));
  const familyAvg = average(family.map((b) => b.rating!.stars));
  if (family.length >= fam.minRatings && familyAvg !== null && familyAvg >= fam.minAverage && !family.some((b) => b.rating!.tags.includes(fam.noTag)))
    badges.push('family_trusted');
  if (vehicle.noSmoking) badges.push('no_smoking');
  if (vehicle.bigBags) badges.push('big_bags');
  return badges;
}

export function driverStats(i: ReputationInput): RajaaDriverStats {
  const ratingCount = i.rated.length;
  const enough = ratingCount >= R.minRatings;
  const avg = average(i.rated.map((b) => b.rating!.stars));
  const share = onTimeShare(i.runs, i.onTime);
  const counts = tagCounts(i.rated);
  const topTags = enough
    ? RAJAA_GOOD_TAGS.filter((t) => (counts.get(t) ?? 0) > 0)
        // Most ticked first; ties keep the chips' own order (stable sort).
        .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
        .slice(0, 2)
    : [];
  return {
    trips: i.runs.length,
    ratingAvg: enough && avg !== null ? roundRating(avg) : null,
    ratingCount,
    onTimeShare: share,
    topTags,
    badges: driverBadges(i.rated, share, i.vehicle),
    ridesWithYou: i.viewerRides,
  };
}

/** One bar per good chip (x13), in the chips' order; empty under `minRatings`. */
export function qualityBars(rated: readonly BookingRecord[]): RajaaQualityBar[] {
  if (rated.length < R.minRatings) return [];
  const counts = tagCounts(rated);
  return RAJAA_GOOD_TAGS.map((tag) => {
    const count = counts.get(tag) ?? 0;
    return { tag, count, share: count / rated.length };
  });
}

/** First day of the review's month in Baghdad (UTC+3), as a UTC instant. */
export function reviewMonth(at: Date): Date {
  const baghdad = new Date(at.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(baghdad.getUTCFullYear(), baghdad.getUTCMonth(), 1) - 3 * 3600_000);
}

/** Shown reviews, newest first: stars, the line and its month — no name, no booking, no day. */
export function publicReviews(rated: readonly BookingRecord[], limit: number = R.reviewsShown): { reviews: RajaaPublicReview[]; count: number } {
  const shown = rated
    .filter((b) => b.review && !b.review.hiddenAt)
    .sort((a, b) => b.review!.at.getTime() - a.review!.at.getTime());
  return {
    reviews: shown.slice(0, limit).map((b) => ({ stars: b.rating!.stars, text: b.review!.text, month: reviewMonth(b.review!.at) })),
    count: shown.length,
  };
}

/** His first finished run, or null. */
export function firstTripAt(runs: readonly DepartureRecord[]): Date | null {
  const times = runs.map((d) => (d.arrivedAt ?? d.departAt).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}
