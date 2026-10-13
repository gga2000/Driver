import { DriverError, priceForWeight, type HomeSale, type OrderLineInput } from '@driver/contracts';
import type { z } from 'zod';
import { DEFAULT_TIMEZONE } from './orders.config.js';
import type { NewLine } from './orders.repository.js';
import { activePauseWindow, type PauseWindow } from './pause.js';

/**
 * What orders needs from a merchant's menu to price a line (review C2). Bound to the catalog
 * module's `CatalogService` (Prisma or in-memory); structurally typed so orders never imports
 * catalog internals.
 */
export interface CatalogModifierView {
  id: string;
  nameAr: string;
  priceIqd: number;
  available: boolean;
}

export interface CatalogModifierGroupView {
  id: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifiers: CatalogModifierView[];
}

export interface CatalogItemView {
  id: string;
  orgId: string;
  priceIqd: number;
  available: boolean;
  stock: number | null;
  /** Weekly windows when the item can be ordered; empty = always. */
  availability: PauseWindow[];
  branchOverrides: Record<string, { priceIqd?: number; available?: boolean }>;
  pointsEligible: boolean;
  modifierGroups: CatalogModifierGroupView[];
  /** أكل بيت: how a home dish sells (ready today or by reservation); absent for restaurant dishes. */
  homeSale?: HomeSale | null;
}

/** The customer storefront facts `orders.place` enforces: opening hours and the restaurant minimum. */
export interface CatalogStorefrontView {
  /** Local weekly opening windows; empty = always open. */
  hours: PauseWindow[];
  /** On the items at menu prices, before any deal (a deal's own minimum is separate). */
  minOrderIqd: number;
  /** What the shop sells (`doorOf`, `iceCreamTooFar`); absent = unknown. */
  tags?: readonly string[];
  /** أكل بيت: set on a home kitchen (its orders follow `homeOrderProblem`). */
  home?: object | null;
}

export interface CatalogPort {
  /** `merchantOrgId`'s own items among `itemIds`; unknown or foreign ids are absent from the result. */
  itemsOf(merchantOrgId: string, itemIds: readonly string[]): Promise<CatalogItemView[]>;
  /** The merchant's storefront; null (or no binding) = no hours on file and no minimum. */
  storefront?(merchantOrgId: string): Promise<CatalogStorefrontView | null>;
}

export const ORDERS_CATALOG = Symbol('ORDERS_CATALOG');

/** Which shop items sell by the kilo (bound to the shop-items module): the only lines that take a weight. */
export interface WeighedItemsPort {
  weighedItemIds(merchantOrgId: string, itemIds: readonly string[]): Promise<Set<string>>;
}

export const ORDERS_WEIGHED_ITEMS = Symbol('ORDERS_WEIGHED_ITEMS');

/** Our own upload store (bound to places' `BLOB_STORE`): a «دوّرلي» photo or voice note must be the orderer's, finished. */
export interface OrdersUploadsPort {
  get(id: string): Promise<{ ownerId: string; state: 'pending' | 'stored' } | null>;
  getVoice(id: string): Promise<{ ownerId: string; state: 'pending' | 'stored' } | null>;
}

export const ORDERS_UPLOADS = Symbol('ORDERS_UPLOADS');

/** Refuses a «دوّرلي» photo or voice note that is not the orderer's own finished upload (`upload_invalid`). */
export async function assertErrandUploads(
  lines: readonly Pick<NewLine, 'errandItem'>[],
  ordererId: string,
  uploads: OrdersUploadsPort | null | undefined,
): Promise<void> {
  for (const l of lines) {
    const spec = l.errandItem;
    if (!spec || (!spec.photoUploadId && !spec.voiceUploadId)) continue;
    if (!uploads) throw new DriverError('upload_invalid');
    const checks = [
      spec.photoUploadId ? uploads.get(spec.photoUploadId) : null,
      spec.voiceUploadId ? uploads.getVoice(spec.voiceUploadId) : null,
    ];
    for (const rec of await Promise.all(checks.filter((c) => c !== null))) {
      if (!rec || rec.ownerId !== ordererId || rec.state !== 'stored')
        throw new DriverError('upload_invalid');
    }
  }
}

type LineIn = z.infer<typeof OrderLineInput>;

export interface PriceLinesContext {
  /** The order's merchant; null for errands and parcels (no menu). */
  merchantOrgId: string | null;
  /** Food / grocery-catalog orders: every priced line must come from the menu. */
  merchantOrder: boolean;
  branchKey: string | null;
  now: Date;
  timeZone?: string;
  /** Errand orders: free-text lines may carry a «دوّرلي» item. */
  errandOrder?: boolean;
  /** Absent = no line may be weighed. */
  weighed?: WeighedItemsPort | null;
}

/**
 * Prices every line on the server (review C2):
 *  - catalog lines: unit price = branch override ?? item price; each chosen modifier adds its menu
 *    delta; unknown, foreign, unavailable, sold-out, out-of-schedule items are refused
 *    (`catalog_item_unavailable`); bad modifier picks are refused (`modifier_invalid`); a client
 *    price that differs from the menu is refused (`price_changed`) rather than silently replaced,
 *    so the customer never pays a total they were not shown. Points eligibility is the menu's.
 *  - free-text lines on a merchant order are requests ("خبز زيادة"), priced 0 whatever was sent;
 *  - errand / parcel free-text lines keep the customer's estimate (no menu exists to price them);
 *  - a weighed line (2026-10-11) is one kilo-sold shop item: its price is the menu's kilo price for
 *    its grams (`priceForWeight`), and the line keeps the grams and the kilo price, so receipts,
 *    refunds and the ticket read the stored line; weighing anything else is `catalog_item_unavailable`;
 *  - a «دوّرلي» item's details ride only on an errand's free-text lines (`invalid_input` elsewhere).
 */
export async function priceLines(
  lines: readonly LineIn[],
  catalog: CatalogPort,
  ctx: PriceLinesContext,
): Promise<NewLine[]> {
  const catalogIds = lines.map((l) => l.catalogItemId).filter((id): id is string => Boolean(id));
  if (catalogIds.length > 0 && !ctx.merchantOrgId)
    throw new DriverError('catalog_item_unavailable');
  const items =
    catalogIds.length > 0
      ? new Map((await catalog.itemsOf(ctx.merchantOrgId!, catalogIds)).map((i) => [i.id, i]))
      : new Map<string, CatalogItemView>();
  const qtyByItem = new Map<string, number>();
  for (const l of lines)
    if (l.catalogItemId)
      qtyByItem.set(l.catalogItemId, (qtyByItem.get(l.catalogItemId) ?? 0) + l.qty);
  const weighedIds = [
    ...new Set(lines.filter((l) => l.weightG !== undefined).map((l) => l.catalogItemId!)),
  ];
  const weighed =
    weighedIds.length > 0 && ctx.weighed && ctx.merchantOrgId
      ? await ctx.weighed.weighedItemIds(ctx.merchantOrgId, weighedIds)
      : new Set<string>();

  return lines.map((l): NewLine => {
    if (l.errandItem && !ctx.errandOrder) throw new DriverError('invalid_input');
    const base = {
      catalogItemId: l.catalogItemId ?? null,
      freeText: l.freeText ?? null,
      qty: l.qty,
      participantRef: l.participantRef ?? null,
      note: l.note ?? null,
      errandItem: l.errandItem ?? null,
    };
    if (!l.catalogItemId) {
      if (ctx.merchantOrder)
        return { ...base, unitPriceIqd: 0, modifiers: [], pointsEligible: false };
      return {
        ...base,
        unitPriceIqd: l.unitPriceIqd ?? 0,
        modifiers: [],
        pointsEligible: l.pointsEligible,
      };
    }
    const item = items.get(l.catalogItemId);
    if (!item || item.orgId !== ctx.merchantOrgId)
      throw new DriverError('catalog_item_unavailable');
    const override = ctx.branchKey ? item.branchOverrides[ctx.branchKey] : undefined;
    const available = override?.available ?? item.available;
    const inStock = item.stock === null || item.stock >= (qtyByItem.get(item.id) ?? l.qty);
    const inSchedule =
      item.availability.length === 0 ||
      activePauseWindow(ctx.now, item.availability, ctx.timeZone ?? DEFAULT_TIMEZONE) !== null;
    if (!available || !inStock || !inSchedule) throw new DriverError('catalog_item_unavailable');
    const menuPriceIqd = override?.priceIqd ?? item.priceIqd;
    if (l.weightG !== undefined && !weighed.has(item.id))
      throw new DriverError('catalog_item_unavailable');
    const unitPriceIqd =
      l.weightG !== undefined ? priceForWeight(menuPriceIqd, l.weightG) : menuPriceIqd;
    if (l.unitPriceIqd !== undefined && l.unitPriceIqd !== unitPriceIqd)
      throw new DriverError('price_changed');
    const weight =
      l.weightG !== undefined
        ? { weightG: l.weightG, perKgIqd: menuPriceIqd }
        : { weightG: null, perKgIqd: null };
    return {
      ...base,
      ...weight,
      unitPriceIqd,
      modifiers: priceModifiers(item, l.modifiers),
      pointsEligible: item.pointsEligible,
    };
  });
}

function priceModifiers(item: CatalogItemView, picked: LineIn['modifiers']): NewLine['modifiers'] {
  const seen = new Set<string>();
  const out: NewLine['modifiers'] = [];
  for (const p of picked) {
    const group = item.modifierGroups.find((g) => g.id === p.groupId);
    const mod = group?.modifiers.find((m) => m.id === p.modifierId);
    if (!group || !mod || !mod.available || seen.has(mod.id))
      throw new DriverError('modifier_invalid');
    if (p.priceIqd !== undefined && p.priceIqd !== mod.priceIqd)
      throw new DriverError('price_changed');
    seen.add(mod.id);
    out.push({ groupId: group.id, modifierId: mod.id, nameAr: mod.nameAr, priceIqd: mod.priceIqd });
  }
  for (const g of item.modifierGroups) {
    const n = out.filter((m) => m.groupId === g.id).length;
    const min = Math.max(g.minSelect, g.required ? 1 : 0);
    if (n < min || n > g.maxSelect) throw new DriverError('modifier_invalid');
  }
  return out;
}
