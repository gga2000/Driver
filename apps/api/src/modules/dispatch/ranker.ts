import { FAMILY_PREFERENCE_RULES, type VehicleFeature } from '@driver/contracts';
import type { DriverCandidate } from './policy.js';

/**
 * Spec §3 ranking: distance 40 %, tier/score 30 %, load 20 %, vehicle fit 10 %. Each term is
 * normalised to 0..1 and multiplied by its weight, so a perfect candidate scores 100.
 */
export interface RankWeights {
  distance: number;
  tier: number;
  load: number;
  vehicleFit: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { distance: 40, tier: 30, load: 20, vehicleFit: 10 };

/** Distance at which the distance term reaches 0. */
export const DISTANCE_HORIZON_KM = 5;
/** Load at which the load term reaches 0 (the largest batch, a tuktuk's 3). */
export const LOAD_HORIZON = 3;

export const TIER_SCORE: Record<DriverCandidate['tier'], number> = { bronze: 0, silver: 0.5, gold: 1 };

/**
 * Anti-camping (review J112, "fifteen tuktuks parked at مطعم خالد"): the distance advantage of a
 * driver idling in one zone decays after a grace period, down to a floor. Only the distance term
 * decays — a camper is "close" because they camp, and that is the advantage being taken away;
 * tier, load and fit are untouched.
 */
export interface CampingDecay {
  graceMin: number;
  /** Minutes in zone at which the floor is reached. */
  fullDecayMin: number;
  floor: number;
}

export const DEFAULT_DECAY: CampingDecay = { graceMin: 15, fullDecayMin: 60, floor: 0.5 };

export function campingFactor(minutesInZone: number, decay: CampingDecay = DEFAULT_DECAY): number {
  if (minutesInZone <= decay.graceMin) return 1;
  if (minutesInZone >= decay.fullDecayMin) return decay.floor;
  const t = (minutesInZone - decay.graceMin) / (decay.fullDecayMin - decay.graceMin);
  return 1 - t * (1 - decay.floor);
}

export interface RankedDriver extends DriverCandidate {
  score: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Scores candidates: higher is better. Pure and deterministic; ties break on driverId so the same
 * input always gives the same wave order.
 */
export class DriverRanker {
  constructor(
    private readonly weights: RankWeights = DEFAULT_WEIGHTS,
    private readonly decay: CampingDecay = DEFAULT_DECAY,
  ) {}

  /** Same ranker with the city's weights (config `rankWeights`). */
  withWeights(weights: RankWeights): DriverRanker {
    return new DriverRanker(weights, this.decay);
  }

  terms(d: DriverCandidate): { distance: number; tier: number; load: number; vehicleFit: number } {
    const closeness = Math.max(0, 1 - d.distanceKm / DISTANCE_HORIZON_KM);
    return {
      distance: closeness * campingFactor(d.minutesInZone ?? 0, this.decay),
      tier: TIER_SCORE[d.tier],
      load: Math.max(0, 1 - d.activeTrips / LOAD_HORIZON),
      vehicleFit: d.vehicleFit ?? 1,
    };
  }

  score(d: DriverCandidate): number {
    const t = this.terms(d);
    const w = this.weights;
    return round2(w.distance * t.distance + w.tier * t.tier + w.load * t.load + w.vehicleFit * t.vehicleFit);
  }

  rank(candidates: readonly DriverCandidate[]): RankedDriver[] {
    return candidates
      .map((d) => ({ ...d, score: this.score(d) }))
      .sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
  }
}

/**
 * Stable partition: the drivers `first` picks go before everyone else, each group keeping its rank
 * order. Used after scoring, so the weights above stay what the city configured (ride step 3).
 */
export function preferFirst<T extends { driverId: string }>(ranked: readonly T[], first: (driverId: string) => boolean): T[] {
  return [...ranked.filter((d) => first(d.driverId)), ...ranked.filter((d) => !first(d.driverId))];
}

/** n6: on a hot day cars with AC, on a cold one cars with heating are offered rides first; no price change. */
export function climateFeature(climate: 'hot' | 'cold' | null): VehicleFeature | null {
  if (climate === 'hot') return 'ac';
  if (climate === 'cold') return 'heating';
  return null;
}

const DAY_MS = 86_400_000;

/**
 * s6 «عوائل»: the car carries the confirmed family tag, he has driven here `minDriverDays` or more, and
 * his public rating is at least `minRating` (no rating yet = not yet).
 */
export function familyFit(d: { features: readonly VehicleFeature[]; rating: number | null; driverSince: Date | null }, now: Date): boolean {
  if (!d.features.includes('family')) return false;
  if (d.rating === null || d.rating < FAMILY_PREFERENCE_RULES.minRating) return false;
  return d.driverSince !== null && now.getTime() - d.driverSince.getTime() >= FAMILY_PREFERENCE_RULES.minDriverDays * DAY_MS;
}
