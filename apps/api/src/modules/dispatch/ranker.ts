import type { DriverCandidate } from './policy.js';

export interface RankWeights {
  /** Penalty per km from the pickup. */
  distance: number;
  /** Penalty per active trip. */
  load: number;
  /** Bonus by tier: Gold drivers get offer priority (spec §9). */
  tier: Record<DriverCandidate['tier'], number>;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  distance: 10,
  load: 25,
  tier: { bronze: 0, silver: 10, gold: 20 },
};

export interface RankedDriver extends DriverCandidate {
  score: number;
}

/**
 * Scores candidates: higher is better. Pure and deterministic; ties break on driverId so
 * the same input always gives the same wave order.
 */
export class DriverRanker {
  constructor(private readonly weights: RankWeights = DEFAULT_WEIGHTS) {}

  score(d: DriverCandidate): number {
    const { distance, load, tier } = this.weights;
    return Math.round((tier[d.tier] - d.distanceKm * distance - d.activeTrips * load) * 100) / 100;
  }

  rank(candidates: readonly DriverCandidate[]): RankedDriver[] {
    return candidates
      .map((d) => ({ ...d, score: this.score(d) }))
      .sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
  }
}
