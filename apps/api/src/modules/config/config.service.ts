import { Injectable } from '@nestjs/common';
import { CityPricingConfig, Vertical, type DispatchConfig, type ZoneTier } from '@driver/contracts';
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

  /** أكل بيت: home kitchens are open to customers in this city (`homeKitchens.launched`, off when absent). */
  homeKitchensOpen(cityId: string): boolean {
    return this.city(cityId)?.homeKitchens?.launched === true;
  }

  /** Demo APIs and end-to-end tests only: open or close home kitchens. Production never calls it. */
  setHomeKitchensOpen(cityId: string, launched: boolean): void {
    const c = this.city(cityId);
    if (c) this.cities.set(cityId, { ...c, homeKitchens: { launched } });
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

  /**
   * The groups the Console set (Ali, 2026-10-20: «قريب / متوسط / بعيد» are his to move). Each area keeps
   * its names; only its tier follows the saved one, so tier-pair fares price it from the next quote on.
   * An area added in the Console joins the list. Areas not named keep their tier.
   */
  applyZoneTiers(cityId: string, areas: readonly { key: string; tier: ZoneTier; name_ar: string; name_en: string }[]): void {
    const c = this.city(cityId);
    if (!c) return;
    const byKey = new Map(areas.map((a) => [a.key, a]));
    const zones = c.zones.map((z) => (byKey.has(z.id) ? { ...z, tier: byKey.get(z.id)!.tier } : z));
    const known = new Set(zones.map((z) => z.id));
    for (const a of areas) if (!known.has(a.key)) zones.push({ id: a.key, name_ar: a.name_ar, name_en: a.name_en, tier: a.tier });
    this.cities.set(cityId, { ...c, zones });
  }
}
