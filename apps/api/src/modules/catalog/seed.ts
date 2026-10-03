import { AZIZIYAH_RESTAURANTS, type SeedRestaurant } from '@driver/contracts/seeds';
import type { OrgsService } from '../orgs/index.js';
import type { CatalogService } from './catalog.service.js';

export interface SeededStorefront {
  /** The org id this process gave the restaurant (in-memory orgs number their own ids). */
  orgId: string;
  seed: SeedRestaurant;
  /** Seed item key → catalog item id. */
  itemIds: Map<string, string>;
}

/**
 * The in-memory twin of `pnpm db:seed` for the launch restaurants (M3): creates each restaurant org
 * with its kitchen location and prep time, its storefront, and its sectioned menu. Used by the demo
 * API, tests and local runs without a database (with one, the seed has already written all of it).
 */
export async function seedStorefronts(
  orgs: Pick<OrgsService, 'create' | 'setMerchantSettings'>,
  catalog: Pick<CatalogService, 'saveStorefront' | 'addItem'>,
  restaurants: readonly SeedRestaurant[] = AZIZIYAH_RESTAURANTS,
  ownerId = 'seed-owner',
): Promise<SeededStorefront[]> {
  const out: SeededStorefront[] = [];
  for (const r of restaurants) {
    const org = await orgs.create({ type: 'restaurant', name: r.nameAr, cityId: r.cityId, ownerId });
    await orgs.setMerchantSettings(org.id, { location: { zoneKey: r.zoneKey, pin: r.pin }, defaultPrepMin: r.prepMin, commissionTier: 'base' });
    await catalog.saveStorefront({
      orgId: org.id,
      cityId: r.cityId,
      nameAr: r.nameAr,
      cuisineAr: r.cuisineAr,
      tags: r.tags,
      minOrderIqd: r.minOrderIqd,
      prepMin: r.prepMin,
      hours: r.hours,
      ratingPlaceholder: r.ratingPlaceholder,
    });
    const itemIds = new Map<string, string>();
    let sortOrder = 0;
    for (const category of r.categories) {
      for (const item of category.items) {
        const created = await catalog.addItem({
          id: `${org.id}_${item.key}`,
          orgId: org.id,
          nameAr: item.nameAr,
          nameEn: item.nameEn,
          description: item.descriptionAr ?? null,
          priceIqd: item.priceIqd,
          prepTimeMin: item.prepTimeMin,
          categoryAr: category.nameAr,
          sortOrder: sortOrder++,
          modifierGroups: (item.modifierGroups ?? []).map((g) => ({
            nameAr: g.nameAr,
            nameEn: g.nameEn,
            required: g.required,
            minSelect: g.min ?? (g.required ? 1 : 0),
            maxSelect: g.max,
            modifiers: g.options.map((o) => ({ nameAr: o.nameAr, nameEn: o.nameEn, priceIqd: o.priceIqd })),
          })),
        });
        itemIds.set(item.key, created.id);
      }
    }
    out.push({ orgId: org.id, seed: r, itemIds });
  }
  return out;
}
