import { Logger } from '@nestjs/common';
import { ETA_LEARNING_RULES, type LatLng } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { EtaCorrection, EtaLegQuery } from '../routing/index.js';
import type { EtaCorrectionsRepository } from './eta-corrections.repository.js';
import { cellId, hourBucketOf, lookupChain, pickFactor, type EtaCell, type EtaLearningRules } from './eta-learning.js';

/** Pin → zone, the same way for learning and for quoting, so a learned cell is the cell a quote reads. */
export interface ZoneLocator {
  /** The city whose service area holds `pin`, and its zone there; null outside every city. */
  locate(pin: LatLng): { cityId: string; zoneId: string } | null;
  /** The zone holding `pin` in `cityId`; null outside its service area. */
  zoneIn(cityId: string, pin: LatLng): string | null;
}

export const ETA_ZONES = Symbol('ETA_ZONES');

/**
 * A `ZoneLocator` over the places module's `ZoneResolver` (verified polygons first, else the nearest
 * seed centroid) and the configured cities, tried in order: a pin belongs to the first city that
 * claims it.
 */
export function zoneLocator(resolver: { resolve(cityId: string, pin: LatLng): string | null }, cityIds: () => readonly string[]): ZoneLocator {
  return {
    locate(pin) {
      for (const cityId of cityIds()) {
        const zoneId = resolver.resolve(cityId, pin);
        if (zoneId) return { cityId, zoneId };
      }
      return null;
    },
    zoneIn: (cityId, pin) => resolver.resolve(cityId, pin),
  };
}

/**
 * The learned correction the one ETA multiplies each leg by (maps program f7). Reads a city's cells
 * once per `cacheMs` — every live position update asks for a factor, so a database read per call
 * would be the hottest query in the API. A leg outside the zones, or a store that cannot be read,
 * gets 1: the router's own estimate, never a failed ETA.
 */
export class LearnedEtaCorrection implements EtaCorrection {
  private readonly logger = new Logger(LearnedEtaCorrection.name);
  private readonly cache = new Map<string, { readAt: number; cells: Map<string, EtaCell> }>();

  constructor(
    private readonly repo: EtaCorrectionsRepository,
    private readonly zones: ZoneLocator,
    private readonly clock: Clock,
    private readonly rules: EtaLearningRules = ETA_LEARNING_RULES,
  ) {}

  async factor(leg: EtaLegQuery): Promise<number> {
    const from = this.zones.locate(leg.from);
    if (!from) return 1;
    const toZone = this.zones.zoneIn(from.cityId, leg.to);
    if (!toZone) return 1;
    const now = this.clock.now();
    const cells = await this.cellsOf(from.cityId, now);
    if (!cells) return 1;
    const chain = lookupChain({ cityId: from.cityId, fromZone: from.zoneId, toZone, hourBucket: hourBucketOf(leg.at ?? now, this.rules), vehicleClass: leg.vehicle, basis: leg.basis });
    return pickFactor(chain, (k) => cells.get(cellId(k)), this.rules);
  }

  /** Drops the city's cached cells, so a leg this instance just learned shows in its next quote. */
  forget(cityId: string): void {
    this.cache.delete(cityId);
  }

  private async cellsOf(cityId: string, now: Date): Promise<Map<string, EtaCell> | null> {
    const hit = this.cache.get(cityId);
    if (hit && now.getTime() - hit.readAt < this.rules.cacheMs) return hit.cells;
    try {
      const cells = new Map((await this.repo.cells(cityId)).map((c) => [cellId(c), c]));
      this.cache.set(cityId, { readAt: now.getTime(), cells });
      return cells;
    } catch (err) {
      // An ETA is still worth showing uncorrected; the next quote tries the store again.
      this.logger.warn(`eta corrections for ${cityId} unreadable, quoting uncorrected: ${(err as Error).message}`);
      return null;
    }
  }
}
