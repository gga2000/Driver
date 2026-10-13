import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '../../shared/db/unit-of-work.js';
import {
  SHOP_ITEMS_REPOSITORY,
  type ShopItemRecord,
  type ShopItemsRepository,
} from './shop-items.repository.js';

/**
 * How shop items sell (2026-10-11), kept apart from the shopping module so the orders module can ask
 * which lines are weighed without depending on shopping (which places «صمون كل يوم» through orders).
 */
@Injectable()
export class ShopItemsService {
  constructor(@Inject(SHOP_ITEMS_REPOSITORY) private readonly repo: ShopItemsRepository) {}

  saveItem(item: ShopItemRecord, tx?: Tx): Promise<ShopItemRecord> {
    return this.repo.saveItem(item, tx);
  }

  itemsOf(orgId: string, tx?: Tx): Promise<ShopItemRecord[]> {
    return this.repo.itemsOf(orgId, tx);
  }

  itemsByIds(orgId: string, itemIds: readonly string[], tx?: Tx): Promise<ShopItemRecord[]> {
    return this.repo.itemsByIds(orgId, itemIds, tx);
  }

  /** The kilo-sold items of `orgId` among `itemIds`: the only ones an order may weigh. */
  async weighedItemIds(orgId: string, itemIds: readonly string[], tx?: Tx): Promise<Set<string>> {
    return new Set(
      (await this.repo.itemsByIds(orgId, itemIds, tx))
        .filter((i) => i.soldBy === 'kg')
        .map((i) => i.itemId),
    );
  }
}
