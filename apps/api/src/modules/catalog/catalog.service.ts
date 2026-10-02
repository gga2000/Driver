import { Injectable } from '@nestjs/common';

export interface CatalogItem {
  id: string;
  orgId: string;
  name_ar: string;
  name_en?: string;
  priceIqd: number;
  available: boolean;
  prepTimeMin: number;
}

@Injectable()
export class CatalogService {
  private readonly items = new Map<string, CatalogItem>();
  private readonly busy = new Set<string>();
  private seq = 0;

  add(input: Omit<CatalogItem, 'id'>): CatalogItem {
    if (!Number.isInteger(input.priceIqd) || input.priceIqd < 0) throw new Error('priceIqd must be a non-negative integer');
    this.seq += 1;
    const item: CatalogItem = { ...input, id: `ci_${this.seq}` };
    this.items.set(item.id, item);
    return item;
  }

  setAvailable(id: string, available: boolean): void {
    const item = this.items.get(id);
    if (item) this.items.set(id, { ...item, available });
  }

  setBusy(orgId: string, busy: boolean): void {
    if (busy) this.busy.add(orgId);
    else this.busy.delete(orgId);
  }

  isBusy(orgId: string): boolean {
    return this.busy.has(orgId);
  }

  menu(orgId: string): CatalogItem[] {
    return [...this.items.values()].filter((i) => i.orgId === orgId);
  }

  /** Busy mode adds a buffer to every prep time estimate. */
  prepTime(orgId: string, itemIds: string[], busyBufferMin = 10): number {
    const max = Math.max(0, ...itemIds.map((id) => this.items.get(id)?.prepTimeMin ?? 0));
    return max + (this.isBusy(orgId) ? busyBufferMin : 0);
  }
}
