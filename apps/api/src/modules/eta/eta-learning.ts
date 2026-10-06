import { ETA_LEARNING_RULES, type EtaBasis, type VehicleClass } from '@driver/contracts';
import { localHour } from '../../shared/local-time.js';

/** The rules as numbers (tests pass their own); `ETA_LEARNING_RULES` in production. */
export interface EtaLearningRules {
  readonly alpha: number;
  readonly minFactor: number;
  readonly maxFactor: number;
  readonly hourBuckets: readonly number[];
  readonly minSamples: number;
  readonly minRatio: number;
  readonly maxRatio: number;
  readonly minPredictedMin: number;
  readonly firstFixMaxDelayMs: number;
  readonly maxTapDelayMs: number;
  readonly cacheMs: number;
}

/** `from_zone` / `to_zone` of a city-level cell: any zone. */
export const ANY_ZONE = '*';
/** `hour_bucket` of an all-day cell. */
export const ALL_DAY = -1;

/** Where a correction factor is kept: zone pair (or the city), time bucket (or all day), vehicle, basis. */
export interface EtaCellKey {
  cityId: string;
  fromZone: string;
  toZone: string;
  hourBucket: number;
  vehicleClass: VehicleClass;
  basis: EtaBasis;
}

/** A cell as stored: the learned (unclamped) EWMA of actual ÷ predicted and how many legs fed it. */
export interface EtaCell extends EtaCellKey {
  factor: number;
  samples: number;
  lastSampleAt: Date;
}

export const cellId = (k: EtaCellKey): string => [k.cityId, k.fromZone, k.toZone, k.hourBucket, k.vehicleClass, k.basis].join('|');

/** The bucket (its Baghdad start hour) that contains `at`; buckets are the city's traffic regimes, not clock hours. */
export function hourBucketOf(at: Date, rules: Pick<EtaLearningRules, 'hourBuckets'> = ETA_LEARNING_RULES): number {
  const h = localHour(at);
  let bucket = rules.hourBuckets[0] ?? 0;
  for (const start of rules.hourBuckets) if (start <= h) bucket = start;
  return bucket;
}

/**
 * The next EWMA after one more leg. The first leg seeds the cell with its own ratio rather than with
 * 1.0, so a cell is not dragged towards the router it is there to correct; `minSamples` keeps such a
 * young cell from being used at all.
 */
export function nextEwma(prev: Pick<EtaCell, 'factor' | 'samples'> | null, ratio: number, alpha: number): { factor: number; samples: number } {
  if (!prev || prev.samples <= 0) return { factor: ratio, samples: 1 };
  return { factor: prev.factor + alpha * (ratio - prev.factor), samples: prev.samples + 1 };
}

/** What a stored factor may do to a leg (spec §5.4: 0.7–1.6). */
export function clampFactor(factor: number, rules: Pick<EtaLearningRules, 'minFactor' | 'maxFactor'> = ETA_LEARNING_RULES): number {
  return Math.min(rules.maxFactor, Math.max(rules.minFactor, factor));
}

export type LegVerdict = { ok: true; ratio: number } | { ok: false; reason: 'too_short' | 'outlier' };

/**
 * Whether a finished leg may teach: long enough that tap timing does not decide its ratio, and a ratio
 * that is traffic rather than a GPS gap, a forgotten tap or a lunch stop.
 */
export function judgeLeg(actualMin: number, predictedMin: number, rules: Pick<EtaLearningRules, 'minPredictedMin' | 'minRatio' | 'maxRatio'> = ETA_LEARNING_RULES): LegVerdict {
  if (!(predictedMin >= rules.minPredictedMin)) return { ok: false, reason: 'too_short' };
  const ratio = actualMin / predictedMin;
  if (!Number.isFinite(ratio) || ratio < rules.minRatio || ratio > rules.maxRatio) return { ok: false, reason: 'outlier' };
  return { ok: true, ratio };
}

/**
 * The cells one leg feeds, most specific first — the same order `lookupChain` reads them in: the zone
 * pair in this bucket, the zone pair all day, the city in this bucket, the city all day.
 */
export function lookupChain(leg: { cityId: string; fromZone: string; toZone: string; hourBucket: number; vehicleClass: VehicleClass; basis: EtaBasis }): EtaCellKey[] {
  const base = { cityId: leg.cityId, vehicleClass: leg.vehicleClass, basis: leg.basis };
  return [
    { ...base, fromZone: leg.fromZone, toZone: leg.toZone, hourBucket: leg.hourBucket },
    { ...base, fromZone: leg.fromZone, toZone: leg.toZone, hourBucket: ALL_DAY },
    { ...base, fromZone: ANY_ZONE, toZone: ANY_ZONE, hourBucket: leg.hourBucket },
    { ...base, fromZone: ANY_ZONE, toZone: ANY_ZONE, hourBucket: ALL_DAY },
  ];
}

/**
 * The factor for a leg: the first cell along the chain with `minSamples` legs, clamped; 1 when none
 * has — before the city has learned anything, every ETA is the router's.
 */
export function pickFactor(
  chain: readonly EtaCellKey[],
  cell: (key: EtaCellKey) => Pick<EtaCell, 'factor' | 'samples'> | undefined,
  rules: Pick<EtaLearningRules, 'minSamples' | 'minFactor' | 'maxFactor'> = ETA_LEARNING_RULES,
): number {
  for (const key of chain) {
    const c = cell(key);
    if (c && c.samples >= rules.minSamples && Number.isFinite(c.factor)) return clampFactor(c.factor, rules);
  }
  return 1;
}
