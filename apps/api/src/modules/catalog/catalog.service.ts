import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { nextLocalMidnight } from '../../shared/local-time.js';
import {
  CATALOG_REPOSITORY,
  type CatalogItemPatch,
  type CatalogItemRecord,
  type CatalogRepository,
  type ImportedItemRecord,
  type MenuImportJobRecord,
  type NewCatalogItem,
  type NewModifierGroup,
  type NewStorefront,
  type PriceChangeRecord,
  type StorefrontRecord,
  type UnmetSearchRecord,
} from './catalog.repository.js';

/** True when customers can order the item right now: the toggle, "sold out today" and stock. */
export function itemOnSale(item: CatalogItemRecord, now: Date): boolean {
  if (!item.available) return false;
  if (item.stock === 0) return false;
  return !(item.soldOutUntil && item.soldOutUntil.getTime() > now.getTime());
}

/**
 * Merchant menus: items with their price, availability (flag, stock, weekly windows, per-branch
 * overrides, "sold out today") and modifier groups. The orders module prices every line from here
 * (review C2): a client-sent price is never trusted. Wave 2 adds the merchant's own menu admin.
 */
@Injectable()
export class CatalogService {
  private readonly busy = new Set<string>();
  private readonly clock: Clock;

  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  addItem(input: NewCatalogItem): Promise<CatalogItemRecord> {
    return this.repo.createItem(input);
  }

  setAvailable(id: string, available: boolean): Promise<void> {
    return this.repo.setAvailable(id, available);
  }

  /** Customer-facing menu: an item sold out today reads as unavailable until the next local midnight. */
  async menu(orgId: string): Promise<CatalogItemRecord[]> {
    return this.withSoldOut(await this.repo.menu(orgId));
  }

  /** M3 customer storefront of a merchant's main menu (cuisine line, minimum, hours…). */
  saveStorefront(input: NewStorefront): Promise<StorefrontRecord> {
    return this.repo.saveStorefront(input);
  }

  /** Joy h4: one anonymous «nobody serves this yet» search. */
  addUnmetSearch(input: Omit<UnmetSearchRecord, 'id'>): Promise<void> {
    return this.repo.addUnmetSearch(input);
  }

  unmetSearches(cityId: string, since: Date): Promise<UnmetSearchRecord[]> {
    return this.repo.unmetSearches(cityId, since);
  }

  storefronts(cityId: string): Promise<StorefrontRecord[]> {
    return this.repo.storefronts(cityId);
  }

  storefront(orgId: string): Promise<StorefrontRecord | null> {
    return this.repo.storefront(orgId);
  }

  /** The orders module's pricing read (`CatalogPort`): only `orgId`'s own items, unknown ids omitted. */
  async itemsOf(orgId: string, itemIds: readonly string[]): Promise<CatalogItemRecord[]> {
    return this.withSoldOut(await this.repo.itemsByIds(orgId, itemIds));
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

  private withSoldOut(items: CatalogItemRecord[]): CatalogItemRecord[] {
    const now = this.clock.now();
    return items.map((i) => (i.soldOutUntil && i.soldOutUntil.getTime() > now.getTime() ? { ...i, available: false } : i));
  }

  // ───────────────────────── wave 2: merchant menu admin ─────────────────────────

  /** The merchant's own view: raw toggles, with an expired "sold out today" already cleared. */
  async adminMenu(orgId: string): Promise<CatalogItemRecord[]> {
    const now = this.clock.now();
    return (await this.repo.menu(orgId)).map((i) => clearExpired(i, now));
  }

  /** One item of `orgId` (another merchant's id reads as not found). */
  async adminItem(orgId: string, itemId: string, tx?: Tx): Promise<CatalogItemRecord> {
    const item = await this.repo.item(itemId, tx);
    if (!item || item.orgId !== orgId) throw new DriverError('menu_item_not_found');
    return clearExpired(item, this.clock.now());
  }

  /** The merchant's toggle; turning an item back on also ends "sold out today". */
  async setAvailability(orgId: string, itemId: string, available: boolean, tx?: Tx): Promise<CatalogItemRecord> {
    await this.adminItem(orgId, itemId, tx);
    return this.repo.updateItem(itemId, { available, ...(available ? { soldOutUntil: null } : {}) }, tx);
  }

  /** "خلص اليوم": off sale until the next Baghdad midnight, then back by itself. */
  async soldOutToday(orgId: string, itemId: string, tx?: Tx): Promise<CatalogItemRecord> {
    await this.adminItem(orgId, itemId, tx);
    return this.repo.updateItem(itemId, { soldOutUntil: nextLocalMidnight(this.clock.now()) }, tx);
  }

  /** New price plus a history row (no row when the price did not change). */
  async updatePrice(orgId: string, itemId: string, priceIqd: number, actorId: string, tx?: Tx): Promise<{ item: CatalogItemRecord; changed: boolean }> {
    const before = await this.adminItem(orgId, itemId, tx);
    if (before.priceIqd === priceIqd) return { item: before, changed: false };
    const item = await this.repo.updateItem(itemId, { priceIqd }, tx);
    await this.repo.addPriceChange({ itemId, orgId, oldPriceIqd: before.priceIqd, newPriceIqd: priceIqd, changedById: actorId, at: this.clock.now() }, tx);
    return { item, changed: true };
  }

  async priceHistory(orgId: string, itemId: string, tx?: Tx): Promise<PriceChangeRecord[]> {
    await this.adminItem(orgId, itemId, tx);
    return this.repo.priceChanges(itemId, tx);
  }

  async replacePhoto(orgId: string, itemId: string, photoUrl: string, tx?: Tx): Promise<CatalogItemRecord> {
    await this.adminItem(orgId, itemId, tx);
    return this.repo.updateItem(itemId, { photoUrl }, tx);
  }

  /** Creates (no `itemId`) or edits an item; a price edit goes through `updatePrice` for its history row. */
  async upsertItem(
    orgId: string,
    input: { itemId?: string | undefined; patch: CatalogItemPatch },
    actorId: string,
    tx?: Tx,
  ): Promise<{ item: CatalogItemRecord; created: boolean; priceChanged: boolean }> {
    const { priceIqd, ...rest } = input.patch;
    if (!input.itemId) {
      if (priceIqd === undefined || !rest.nameAr) throw new DriverError('invalid_input');
      const item = await this.repo.createItem(
        {
          orgId,
          nameAr: rest.nameAr,
          nameEn: rest.nameEn ?? null,
          description: rest.description ?? null,
          priceIqd,
          categoryAr: rest.categoryAr ?? null,
          sortOrder: rest.sortOrder ?? 0,
          ...(rest.prepTimeMin !== undefined ? { prepTimeMin: rest.prepTimeMin } : {}),
          available: rest.available ?? true,
          servesMin: rest.servesMin ?? null,
          servesMax: rest.servesMax ?? null,
          labels: [...(rest.labels ?? [])],
        },
        tx,
      );
      await this.repo.addPriceChange({ itemId: item.id, orgId, oldPriceIqd: 0, newPriceIqd: priceIqd, changedById: actorId, at: this.clock.now() }, tx);
      return { item, created: true, priceChanged: true };
    }
    await this.adminItem(orgId, input.itemId, tx);
    if (Object.values(rest).some((v) => v !== undefined)) await this.repo.updateItem(input.itemId, rest, tx);
    let priceChanged = false;
    if (priceIqd !== undefined) priceChanged = (await this.updatePrice(orgId, input.itemId, priceIqd, actorId, tx)).changed;
    return { item: await this.adminItem(orgId, input.itemId, tx), created: false, priceChanged };
  }

  /**
   * Sections are the items' `categoryAr`: `renameFrom` moves every item of that section; `itemIds`
   * places those items in this section in that order (sort orders 0, 10, 20…).
   */
  async upsertCategory(orgId: string, input: { nameAr: string; renameFrom?: string | undefined; itemIds?: readonly string[] | undefined }, tx?: Tx): Promise<number> {
    let touched = 0;
    if (input.renameFrom && input.renameFrom !== input.nameAr) {
      for (const i of await this.repo.menu(orgId)) {
        if (i.categoryAr !== input.renameFrom) continue;
        await this.repo.updateItem(i.id, { categoryAr: input.nameAr }, tx);
        touched += 1;
      }
    }
    for (const [n, itemId] of (input.itemIds ?? []).entries()) {
      await this.adminItem(orgId, itemId, tx);
      await this.repo.updateItem(itemId, { categoryAr: input.nameAr, sortOrder: n * 10 }, tx);
      touched += 1;
    }
    return touched;
  }

  /**
   * Section order: named sections in `order` first, the rest after them in their current order, the
   * unnamed section last. Items keep their order inside a section; sort orders become
   * section × 100 + position, so the customer menu (sections in first-item order) follows.
   */
  async reorderCategories(orgId: string, order: readonly string[], tx?: Tx): Promise<number> {
    const items = await this.repo.menu(orgId);
    const sections = new Map<string | null, CatalogItemRecord[]>();
    for (const i of items) sections.set(i.categoryAr, [...(sections.get(i.categoryAr) ?? []), i]);
    const wanted = [...new Set(order)].filter((name) => sections.has(name));
    const rest = [...sections.keys()].filter((k): k is string => k !== null && !wanted.includes(k));
    const names: Array<string | null> = [...wanted, ...rest, ...(sections.has(null) ? [null] : [])];
    let touched = 0;
    for (const [s, name] of names.entries()) {
      for (const [n, item] of (sections.get(name) ?? []).entries()) {
        const sortOrder = s * 100 + n;
        if (item.sortOrder === sortOrder) continue;
        await this.repo.updateItem(item.id, { sortOrder }, tx);
        touched += 1;
      }
    }
    return touched;
  }

  async setModifiers(orgId: string, itemId: string, groups: readonly NewModifierGroup[], tx?: Tx): Promise<CatalogItemRecord> {
    await this.adminItem(orgId, itemId, tx);
    for (const g of groups) if ((g.minSelect ?? 0) > (g.maxSelect ?? 1)) throw new DriverError('invalid_input');
    // «يشبّع» (joy o3): a range the kitchen typed must read low to high.
    for (const g of groups) for (const m of g.modifiers) if (m.servesMin != null && m.servesMax != null && m.servesMin > m.servesMax) throw new DriverError('invalid_input');
    return this.repo.replaceModifierGroups(itemId, groups, tx);
  }

  /** Photo import: OCR is stubbed, so the draft starts with no rows and staff type them in. */
  createImportJob(orgId: string, photoRefs: readonly string[], actorId: string, tx?: Tx): Promise<MenuImportJobRecord> {
    return this.repo.createImportJob(
      { orgId, photoRefs: [...photoRefs], state: 'draft', items: [], ocr: 'stub', createdById: actorId, createdAt: this.clock.now(), appliedAt: null, appliedCount: 0 },
      tx,
    );
  }

  async importJob(orgId: string, jobId: string, tx?: Tx): Promise<MenuImportJobRecord> {
    const job = await this.repo.importJob(jobId, tx);
    if (!job || job.orgId !== orgId) throw new DriverError('import_job_not_found');
    return job;
  }

  /** Applies the staff-corrected rows: one item each (with a first price-history row). */
  async applyImport(orgId: string, jobId: string, items: readonly ImportedItemRecord[], actorId: string, tx?: Tx): Promise<MenuImportJobRecord> {
    const job = await this.importJob(orgId, jobId, tx);
    if (job.state !== 'draft') throw new DriverError('import_state_conflict');
    // Claim first (conditional draft → applied): a second apply racing this one gets the conflict
    // instead of creating every item again (review 2026-10-04 #12).
    if (!(await this.repo.claimImportJob(jobId, this.clock.now(), tx))) throw new DriverError('import_state_conflict');
    const existing = await this.repo.menu(orgId);
    let order = existing.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    for (const row of items) {
      order += 10;
      await this.upsertItem(orgId, { patch: { nameAr: row.nameAr, priceIqd: row.priceIqd, categoryAr: row.categoryAr ?? null, description: row.description ?? null, sortOrder: order } }, actorId, tx);
    }
    return this.repo.updateImportJob(jobId, { state: 'applied', items: [...items], appliedAt: this.clock.now(), appliedCount: items.length }, tx);
  }
}

function clearExpired(item: CatalogItemRecord, now: Date): CatalogItemRecord {
  return item.soldOutUntil && item.soldOutUntil.getTime() <= now.getTime() ? { ...item, soldOutUntil: null } : item;
}
