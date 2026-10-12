import { Injectable } from '@nestjs/common';
import { CityPricingConfig, Vertical, type DispatchConfig } from '@driver/contracts';
import { deployEnvironmentFromEnv } from './boot-check.js';
import { aziziyah } from './cities/aziziyah.js';

/**
 * Local runs and CI only (never staging or production, where boot refuses it): the services every city
 * opens instead of its own `launchedVerticals`, e.g. `food,taxi,tuktuk,intercity,khat` so the end-to-end
 * flows on a real database can book seats. Comma-separated vertical names.
 */
export const TEST_LAUNCHED_VERTICALS_ENV = 'DRIVER_TEST_LAUNCHED_VERTICALS';

/** The override list from the environment, or null when unset or not a local run. */
export function testLaunchedVerticals(env: NodeJS.ProcessEnv = process.env): Vertical[] | null {
  const raw = env[TEST_LAUNCHED_VERTICALS_ENV]?.trim();
  if (!raw || deployEnvironmentFromEnv(env) !== 'local') return null;
  return raw.split(',').map((v) => Vertical.parse(v.trim()));
}

/**
 * City configuration registry. Cities are data: adding one is a new file under `cities/`
 * validated by the contracts schema at boot. Later milestones load from the `cities` table.
 */
@Injectable()
export class ConfigService {
  private readonly cities = new Map<string, CityPricingConfig>();

  constructor() {
    const open = testLaunchedVerticals();
    for (const raw of [aziziyah]) {
      const parsed = CityPricingConfig.parse(open ? { ...raw, launchedVerticals: open } : raw);
      this.cities.set(parsed.cityId, parsed);
    }
  }

  city(cityId: string): CityPricingConfig | undefined {
    return this.cities.get(cityId);
  }

  cityIds(): string[] {
    return [...this.cities.keys()];
  }

  /** The services open in this city (`launchedVerticals`, else every priced one); none for an unknown city. */
  launchedVerticals(cityId: string): Vertical[] {
    const c = this.city(cityId);
    if (!c) return [];
    return [...(c.launchedVerticals ?? c.verticals.map((v) => v.vertical))];
  }

  isLaunched(cityId: string, vertical: Vertical): boolean {
    return this.launchedVerticals(cityId).includes(vertical);
  }

  /**
   * Demo APIs and end-to-end tests only: open more (or fewer) services than the city file, so every
   * screen stays reachable in the studio. Production never calls it.
   */
  setLaunchedVerticals(cityId: string, verticals: readonly Vertical[]): void {
    const c = this.city(cityId);
    if (c) this.cities.set(cityId, { ...c, launchedVerticals: [...verticals] });
  }

  dispatchFor(cityId: string, vertical: Vertical): DispatchConfig | undefined {
    return this.city(cityId)?.dispatch[vertical];
  }

  /** Food carts are open to customers in this city (`foodCarts.launched`, off when absent). */
  foodCartsOpen(cityId: string): boolean {
    return this.city(cityId)?.foodCarts?.launched === true;
  }

  /** Demo APIs and end-to-end tests only: open or close food carts. Production never calls it. */
  setFoodCartsOpen(cityId: string, launched: boolean): void {
    const c = this.city(cityId);
    if (c) this.cities.set(cityId, { ...c, foodCarts: { launched } });
  }
}
