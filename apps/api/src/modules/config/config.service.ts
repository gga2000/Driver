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

  dispatchFor(cityId: string, vertical: Vertical): DispatchConfig | undefined {
    return this.city(cityId)?.dispatch[vertical];
  }
}
