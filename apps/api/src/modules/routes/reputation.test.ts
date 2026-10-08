import { describe, expect, it } from 'vitest';
import type { RajaaRatingTag, TravellingAs } from '@driver/contracts';
import type { BookingRecord, DepartureRecord } from './model.js';
import { driverBadges, driverStats, firstTripAt, onTimeShare, publicReviews, qualityBars, reviewMonth, roundRating } from './reputation.js';

const T0 = Date.parse('2026-09-01T09:00:00Z');
const day = (n: number) => new Date(T0 + n * 86_400_000);

function run(id: string, n: number): DepartureRecord {
  return { id, departAt: day(n), arrivedAt: new Date(day(n).getTime() + 2 * 3600_000) } as DepartureRecord;
}

let seq = 0;
function rated(stars: number, tags: RajaaRatingTag[] = [], o: { as?: TravellingAs; text?: string; hidden?: boolean; n?: number } = {}): BookingRecord {
  const at = day(o.n ?? seq);
  seq += 1;
  return {
    id: `b${seq}`,
    departureId: 'dep',
    travellingAs: o.as ?? 'rijal',
    rating: { stars, tags, at },
    review: o.text ? { text: o.text, at, hiddenAt: o.hidden ? at : null, hiddenBy: o.hidden ? 'staff' : null, hiddenReason: o.hidden ? 'rude' : null } : null,
  } as BookingRecord;
}

const runs = (k: number) => Array.from({ length: k }, (_, i) => run(`r${i}`, i));
const noPromises = { noSmoking: false, bigBags: false };
const stats = (rs: BookingRecord[], o: { runs?: DepartureRecord[]; onTime?: (d: DepartureRecord) => boolean | null; viewerRides?: number } = {}) =>
  driverStats({ runs: o.runs ?? runs(rs.length), rated: rs, onTime: o.onTime ?? (() => true), viewerRides: o.viewerRides ?? 0, vehicle: noPromises });

describe('driver reputation (x12–x17): numbers only once enough riders stand behind them', () => {
  it('a new driver: trips and the rating count show, the average, chips and bars wait for 3 ratings', () => {
    const s = stats([rated(5, ['on_time']), rated(1, ['late'])], { runs: runs(2) });
    expect(s).toMatchObject({ trips: 2, ratingCount: 2, ratingAvg: null, topTags: [], onTimeShare: null, badges: [] });
    expect(qualityBars([rated(5, ['on_time'])])).toEqual([]);
  });

  it('average to one decimal; the two good chips riders tick most, ties in the chips\' order', () => {
    const s = stats([rated(5, ['respectful', 'clean_car']), rated(5, ['clean_car', 'respectful', 'calm_driving']), rated(4, ['late'])]);
    expect(s.ratingAvg).toBe(4.7);
    expect(s.topTags).toEqual(['clean_car', 'respectful']);
    expect(roundRating(4.849)).toBe(4.8);
    expect(roundRating(4.85)).toBe(4.9);
  });

  it('a chip ticked twice on one rating counts once', () => {
    const bars = qualityBars([rated(5, ['on_time', 'on_time']), rated(5, []), rated(5, [])]);
    expect(bars.map((b) => [b.tag, b.count, Math.round(b.share * 100)])).toEqual([
      ['on_time', 1, 33],
      ['calm_driving', 0, 0],
      ['clean_car', 0, 0],
      ['respectful', 0, 0],
    ]);
  });

  it('on-time share counts only runs that can be judged, from the third one', () => {
    const rs = runs(5);
    const judge = (d: DepartureRecord) => ({ r0: true, r1: false, r2: null, r3: true, r4: true })[d.id as 'r0'] ?? null;
    expect(onTimeShare(rs, judge)).toBe(0.75);
    expect(onTimeShare(rs.slice(0, 3), judge)).toBeNull();
  });

  it('«سايق مميز»: 20 ratings, 4.8 or more, on time 9 of 10 — each bar must be met', () => {
    const good = Array.from({ length: 20 }, () => rated(5, ['on_time']));
    expect(driverBadges(good, 0.9, noPromises)).toEqual(['top_driver']);
    expect(driverBadges(good.slice(1), 0.95, noPromises)).toEqual([]);
    expect(driverBadges(good, 0.89, noPromises)).toEqual([]);
    expect(driverBadges(good, null, noPromises)).toEqual([]);
    // 16×5 + 4×4 = 4.8 exactly: earned; one more 4 drops under.
    const edge = [...Array.from({ length: 16 }, () => rated(5)), ...Array.from({ length: 4 }, () => rated(4))];
    expect(driverBadges(edge, 1, noPromises)).toEqual(['top_driver']);
    expect(driverBadges([...edge.slice(1), rated(4)], 1, noPromises)).toEqual([]);
  });

  it('«العوائل ترتاحله»: 8 ratings from women or families at 4.8+, none saying fast driving; men\'s ratings don\'t count', () => {
    const fam = [...Array.from({ length: 4 }, () => rated(5, [], { as: 'aila' })), ...Array.from({ length: 4 }, () => rated(5, [], { as: 'nisa' }))];
    expect(driverBadges(fam, null, noPromises)).toEqual(['family_trusted']);
    expect(driverBadges([...fam.slice(1), rated(5, [], { as: 'rijal' })], null, noPromises)).toEqual([]);
    expect(driverBadges([...fam, rated(5, ['fast_driving'], { as: 'nisa' })], null, noPromises)).toEqual([]);
    expect(driverBadges([...fam, rated(2, [], { as: 'aila' })], null, noPromises)).toEqual([]);
  });

  it('«ما يدخن» and «جناط كبيرة» are the driver\'s word for this run', () => {
    expect(driverBadges([], null, { noSmoking: true, bigBags: true })).toEqual(['no_smoking', 'big_bags']);
  });

  it('«سافرت وياه قبل»: the viewer\'s trips with him pass through', () => {
    expect(stats([], { runs: [], viewerRides: 2 }).ridesWithYou).toBe(2);
  });

  it('reviews: shown ones only, newest first, no name, month only', () => {
    const list = [
      rated(5, [], { text: 'سايق محترم', n: 1 }),
      rated(2, [], { text: 'كلام مو زين', hidden: true, n: 2 }),
      rated(4, [], { n: 3 }),
      rated(4, [], { text: 'وصلنا بالوقت', n: 40 }),
    ];
    const { reviews, count } = publicReviews(list);
    expect(count).toBe(2);
    expect(reviews.map((r) => [r.stars, r.text])).toEqual([
      [4, 'وصلنا بالوقت'],
      [5, 'سايق محترم'],
    ]);
    expect(Object.keys(reviews[0]!).sort()).toEqual(['month', 'stars', 'text']);
    expect(publicReviews(list, 1).reviews).toHaveLength(1);
  });

  it('a review\'s month is the Baghdad month (late on the 31st UTC is already the 1st there)', () => {
    expect(reviewMonth(new Date('2026-10-31T22:30:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(reviewMonth(new Date('2026-10-15T08:00:00Z')).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('first trip: his earliest finished run', () => {
    expect(firstTripAt([])).toBeNull();
    expect(firstTripAt([run('b', 9), run('a', 2)])?.toISOString()).toBe(new Date(day(2).getTime() + 2 * 3600_000).toISOString());
  });
});
