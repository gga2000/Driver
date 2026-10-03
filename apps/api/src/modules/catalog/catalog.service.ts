import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_REPOSITORY, type CatalogItemRecord, type CatalogRepository, type NewCatalogItem } from './catalog.repository.js';

/**
 * Merchant menus: items with their price, availability (flag, stock, weekly windows, per-branch
 * overrides) and modifier groups. The orders module prices every line from here (review C2): a
 * client-sent price is never trusted.
 */
@Injectable()
export class CatalogService {
  private readonly busy = new Set<string>();

  constructor(@Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository) {}

  addItem(input: NewCatalogItem): Promise<CatalogItemRecord> {
    return this.repo.createItem(input);
  }

  setAvailable(id: string, available: boolean): Promise<void> {
    return this.repo.setAvailable(id, available);
  }

  menu(orgId: string): Promise<CatalogItemRecord[]> {
    return this.repo.menu(orgId);
  }

  /** The orders module's pricing read (`CatalogPort`): only `orgId`'s own items, unknown ids omitted. */
  itemsOf(orgId: string, itemIds: readonly string[]): Promise<CatalogItemRecord[]> {
    return this.repo.itemsByIds(orgId, itemIds);
  }

  setBusy(orgId: string, busy: boolean): void {
    if (busy) this.busy.add(orgId);
    else this.busy.delete(orgId);
  }

  isBusy(orgId: string): boolean {
    return this.busy.has(orgId);
  }

  /** Busy mode adds a buffer to every prep time estimate. */
  async prepTime(orgId: string, itemIds: string[], busyBufferMin = 10): Promise<number> {
    const items = await this.repo.itemsByIds(orgId, itemIds);
    const max = Math.max(0, ...items.map((i) => i.prepTimeMin));
    return max + (this.isBusy(orgId) ? busyBufferMin : 0);
  }
}
