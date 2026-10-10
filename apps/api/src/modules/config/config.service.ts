import { Injectable } from '@nestjs/common';
import { CityPricingConfig, type DispatchConfig, type Vertical } from '@driver/contracts';
import { aziziyah } from './cities/aziziyah.js';

/**
 * City configuration registry. Cities are data: adding one is a new file under `cities/`
 * validated by the contracts schema at boot. Later milestones load from the `cities` table.
 */
@Injectable()
export class ConfigService {
  private readonly cities = new Map<string, CityPricingConfig>();

  constructor() {
    for (const raw of [aziziyah]) {
      const parsed = CityPricingConfig.parse(raw);
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
}
