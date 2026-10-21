import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  type ActivityTodayInput,
  DISH_LABELS,
  type DishLabel,
  AZIZIYAH_MONEY_RULES,
  DriverError,
  STAFF_INVITE_RULES,
  type Actor,
  type AdminMenu,
  type AdminMenuItem,
  type DealProjectionView,
  type DealView,
  type KitchenStoryView,
  type MenuImportJob,
  type MerchantPotView,
  POT_RULES,
  type MerchantAdminPort,
  type MerchantActivity,
  type MerchantCashAccount,
  type MerchantDaySummary,
  type MerchantDispute,
  type MerchantInsights,
  type MerchantScope,
  type MerchantStaffRole,
  type MyStaffInvite,
  type MoneyToday,
  type Order,
  type OrderWho,
  type OrderWhoInput,
  type PriceChange,
  type ReorderCategoriesInput,
  type StaffMember,
  type UpsertCategoryInput,
  type UpsertItemInput,
  type WeeklyStatement,
  homeLocalDay,
  type HomeKitchenDish,
  type HomeKitchenView,
  type HomeSale,
  type HomeTally,
  type SaveHomeDishInput,
  type SetHomeTodayInput,
} from '@driver/contracts';
import { LIBRARY_PHOTO_FILE } from '@driver/contracts/store-setup';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { localDateKey, localPeriod, startOfLocalDay } from '../../shared/local-time.js';
import { CatalogService, foodMediaPath, homeDishView, itemOnSale, itemPhotoUrl, kindOfLabels, withKind, potDay, potSuggestions, UPLOAD_PHOTO_PREFIX, type CatalogItemRecord, type MenuImportJobRecord } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { Accounts, LedgerFacade, LedgerService, MerchantCashService } from '../ledger/index.js';
import { MerchantService } from '../merchant/index.js';
import { OpsService } from '../ops/index.js';
import { activePauseWindow, CITY_PAUSE_WINDOWS, commissionPctOf, DEFAULT_TIMEZONE, ORDERS_RULES, OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { PROJECTION_BASIS_DAYS, projectDeal, PromotionsService, type DealProposal } from '../promotions/index.js';
import { activityActorIds, activityEntries, composeActivity, ITEM_ACTIVITY_TYPES, ORDER_ACTIVITY_TYPES, type ActivityNames } from './activity.js';
import { composeDaySummary, summaryDay } from './day-summary.js';
import { composeInsights, defaultOutcome, disputeKindOf, soldOutHabits, staffInsights } from './insights.js';
import { MERCHANT_ADMIN_REPOSITORY, type DisputeResponseRecord, type MerchantAdminRepository } from './merchant-admin.repository.js';
import { composeCashAccount, composeMoneyToday, composeStatement, HANDOVER_LOOKBACK_DAYS } from './money.js';

const DAY_MS = 86_400_000;
/** The feed also reads orders placed this long before the day starts (a late order readied after midnight). */
const ACTIVITY_ORDER_LEAD_MS = 6 * 3_600_000;
const STAFF_KINDS: readonly MerchantStaffRole[] = ['merchant_owner', 'merchant_staff'];
/** p4: the event Driver's team records when it takes a shop's dish photo down (ops `dishPhotos.takeDown`). */
export const PHOTO_TAKEN_DOWN_EVENT = 'catalog.photo_taken_down';
/** p4: how long the menu keeps telling the owner why a photo came down (while the dish has none). */
export const PHOTO_TAKEDOWN_NOTICE_DAYS = 14;
type PhotoTakenDown = { reason: string; at: Date };

/** Who made a menu edit: the merchant's own app, or Driver's team from the Console (`ops.stores.*`). */
export type MenuAccess = 'merchant' | 'console';
/** Console edits carry `by: 'console'` on their event, so the owner's "who did what" can tell them apart. */
const byConsole = (by: MenuAccess): { by?: 'console' } => (by === 'console' ? { by } : {});

/**
 * Does a modifier save change any price? Matched by group and option name; a new priced option, or a
 * removed one, counts as a change. Availability and names alone never do.
 */
export function modifierPricesChanged(
  before: ReadonlyArray<{ nameAr: string; modifiers: ReadonlyArray<{ nameAr: string; priceIqd: number }> }>,
  after: ReadonlyArray<{ nameAr: string; modifiers: ReadonlyArray<{ nameAr: string; priceIqd: number }> }>,
): boolean {
  const key = (g: string, m: string) => `${g.trim()}\u0000${m.trim()}`;
  const prices = (groups: typeof before) => new Map(groups.flatMap((g) => g.modifiers.filter((m) => m.priceIqd > 0).map((m) => [key(g.nameAr, m.nameAr), m.priceIqd] as const)));
  const a = prices(before);
  const b = prices(after);
  if (a.size !== b.size) return true;
  for (const [k, v] of b) if (a.get(k) !== v) return true;
  return false;
}
/** Disputes the merchant still sees (domain §9: customers dispute until close, support after). */
export const DISPUTE_LOOKBACK_DAYS = 30;
/** The merchant answers a dispute within this; after it the default outcome stands. */
export const DISPUTE_RESPONSE_HOURS = 48;

/**
 * Merchant app wave 2 (`merchantAdmin.*`). Every call is scoped to one merchant org the caller holds
 * `merchant_owner` / `merchant_staff` at; money, staff and deal changes are owner-only. Menu through
 * the catalog module, deals through promotions, money from the ledger, orders from orders, staff as
 * identity role grants (names from the vault, logged), given only when the invitee accepts (PRV-08).
 */
@Injectable()
export class MerchantAdminService implements MerchantAdminPort {
  constructor(
    @Inject(MERCHANT_ADMIN_REPOSITORY) private readonly repo: MerchantAdminRepository,
    private readonly catalog: CatalogService,
    private readonly promotions: PromotionsService,
    private readonly ledger: LedgerService,
    private readonly ledgerFacade: LedgerFacade,
    private readonly orders: OrdersService,
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly merchant?: MerchantService,
    @Optional() private readonly ops?: OpsService,
    @Optional() private readonly merchantCash?: MerchantCashService,
  ) {}

  // ───────────────────────── access ─────────────────────────

  /** The caller's role at the merchant (owner wins); FORBIDDEN when he has none there. */
  async roleAt(actor: Actor, merchantOrgId: string): Promise<MerchantStaffRole> {
    if (await this.identity.hasRole(actor.personId, 'merchant_owner', merchantOrgId)) return 'merchant_owner';
    if (await this.identity.hasRole(actor.personId, 'merchant_staff', merchantOrgId)) return 'merchant_staff';
    throw new DriverError('forbidden');
  }

  /**
   * Owner-only (MER-06): prices, new dishes, options, sections and menu imports. Staff keep the
   * kitchen's daily switches (available, sold out today) and photo requests.
   */
  private async owner(actor: Actor, merchantOrgId: string): Promise<void> {
    if ((await this.roleAt(actor, merchantOrgId)) !== 'merchant_owner') throw new DriverError('forbidden');
  }

  /**
   * Menu access: the merchant's own (owner or staff, per `need`) through the `menu*` methods, or
   * Driver's team acting for the store through the separate `ops*` methods (Console `ops.stores.*`,
   * audited by `StoresConsoleService`). The ops path checks field ops or admin here as well as at the
   * router; support, owners and staff are refused on it. On a store already open to customers the team
   * never sets a price (`store_price_owner_only`): prices stay the owner's.
   */
  private async access(actor: Actor, merchantOrgId: string, need: 'owner' | 'any', by: MenuAccess): Promise<void> {
    if (by === 'console') {
      await this.assertStoreOps(actor);
      await this.orgs.get(merchantOrgId);
      return;
    }
    if (need === 'owner') await this.owner(actor, merchantOrgId);
    else await this.roleAt(actor, merchantOrgId);
  }

  /** Driver's team that may set a store up for its owner: field ops or admin (support only reads). */
  async assertStoreOps(actor: Actor): Promise<void> {
    if (await this.identity.hasRole(actor.personId, 'field_ops')) return;
    if (await this.identity.hasRole(actor.personId, 'admin')) return;
    throw new DriverError('forbidden');
  }

  /** Open to customers: setup finished, or a store from before «جهّز محلك» (no setup record). */
  async storeIsLive(merchantOrgId: string): Promise<boolean> {
    const setup = (await this.orgs.merchantSettings(merchantOrgId)).setup;
    return !setup || setup.liveAt !== null;
  }

  private async consolePriceGuard(merchantOrgId: string, by: MenuAccess, changesPrice: () => Promise<boolean>): Promise<void> {
    if (by !== 'console') return;
    if ((await this.storeIsLive(merchantOrgId)) && (await changesPrice())) throw new DriverError('store_price_owner_only');
  }

  async myMerchants(actor: Actor): Promise<Array<{ merchantOrgId: string; role: MerchantStaffRole }>> {
    const grants = await this.identity.scopedOrgs(actor.personId, STAFF_KINDS);
    const byOrg = new Map<string, MerchantStaffRole>();
    for (const g of grants) if (byOrg.get(g.orgId) !== 'merchant_owner') byOrg.set(g.orgId, g.kind as MerchantStaffRole);
    return [...byOrg.entries()].map(([merchantOrgId, role]) => ({ merchantOrgId, role }));
  }

  private async assertUpload(ownerId: string, uploadId: string): Promise<void> {
    const blob = await this.blobs.get(uploadId);
    if (!blob || blob.ownerId !== ownerId || blob.state !== 'stored') throw new DriverError('upload_invalid');
  }

  // ───────────────────────── menu ─────────────────────────

  private photoUrl(stored: string | null): string | null {
    return itemPhotoUrl(this.blobs, stored);
  }

  private itemView(i: CatalogItemRecord, takenDown?: ReadonlyMap<string, PhotoTakenDown>): AdminMenuItem {
    const now = this.clock.now();
    return {
      id: i.id,
      nameAr: i.nameAr,
      nameEn: i.nameEn,
      description: i.description,
      priceIqd: i.priceIqd,
      photoUrl: this.photoUrl(i.photoUrl),
      categoryAr: i.categoryAr,
      sortOrder: i.sortOrder,
      prepTimeMin: i.prepTimeMin,
      available: i.available,
      soldOutUntil: i.soldOutUntil && i.soldOutUntil.getTime() > now.getTime() ? i.soldOutUntil : null,
      onSale: itemOnSale(i, now),
      modifierGroups: i.modifierGroups.map((g) => ({
        id: g.id,
        nameAr: g.nameAr,
        nameEn: g.nameEn,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        required: g.required,
        modifiers: g.modifiers.map((m) => ({ id: m.id, nameAr: m.nameAr, nameEn: m.nameEn, priceIqd: m.priceIqd, available: m.available, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })),
      })),
      servesMin: i.servesMin ?? null,
      servesMax: i.servesMax ?? null,
      labels: (i.labels ?? []).filter((l): l is DishLabel => (DISH_LABELS as readonly string[]).includes(l)),
      kind: kindOfLabels(i.labels),
      photoLibrary: i.photoUrl ? (i.photoLibrary ?? null) : null,
      photoReviewPending: !!i.photoUrl && !!i.photoReviewPendingAt,
      ...(takenDown ? { photoTakenDown: i.photoUrl ? null : (takenDown.get(i.id) ?? null) } : {}),
    };
  }

  /** p4: the store's photo take-downs of the last 14 days, the latest per dish. */
  private async photoTakeDowns(merchantOrgId: string): Promise<Map<string, PhotoTakenDown>> {
    const from = new Date(this.clock.now().getTime() - PHOTO_TAKEDOWN_NOTICE_DAYS * 86_400_000);
    const events = await this.events.forAggregate('org', merchantOrgId, { from, types: [PHOTO_TAKEN_DOWN_EVENT] });
    const out = new Map<string, PhotoTakenDown>();
    for (const e of events) {
      const p = e.payload as { itemId?: unknown; reason?: unknown };
      if (typeof p.itemId !== 'string') continue;
      out.set(p.itemId, { reason: typeof p.reason === 'string' ? p.reason : 'other', at: e.occurredAt });
    }
    return out;
  }

  private async menuView(merchantOrgId: string): Promise<AdminMenu> {
    const [items, takenDown] = await Promise.all([this.catalog.adminMenu(merchantOrgId), this.photoTakeDowns(merchantOrgId)]);
    const sections = new Map<string | null, AdminMenuItem[]>();
    for (const i of items) {
      const list = sections.get(i.categoryAr) ?? [];
      list.push(this.itemView(i, takenDown));
      sections.set(i.categoryAr, list);
    }
    // Named sections in first-item order, the unnamed one last (as the customer menu shows them).
    const named = [...sections.entries()].filter(([k]) => k !== null);
    const unnamed = sections.get(null);
    return { merchantOrgId, categories: [...named.map(([nameAr, list]) => ({ nameAr, items: list })), ...(unnamed ? [{ nameAr: null, items: unnamed }] : [])] };
  }

  async menuGet(actor: Actor, input: MerchantScope): Promise<AdminMenu> {
    return this.menuGetAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuGet for the owner; field ops or admin only. */
  async opsMenuGet(actor: Actor, input: MerchantScope): Promise<AdminMenu> {
    return this.menuGetAs('console', actor, input);
  }

  private async menuGetAs(by: MenuAccess, actor: Actor, input: MerchantScope): Promise<AdminMenu> {
    await this.access(actor, input.merchantOrgId, 'any', by);
    return this.menuView(input.merchantOrgId);
  }

  private async itemEvent(actor: Actor, merchantOrgId: string, type: string, payload: Record<string, unknown>, write: (tx: Tx) => Promise<CatalogItemRecord>, by: MenuAccess = 'merchant'): Promise<AdminMenuItem> {
    const item = await this.uow.run(async (tx) => {
      const i = await write(tx);
      await this.events.emit(tx, { actorId: actor.personId, type, occurredAt: this.clock.now(), payload: { merchantOrgId, itemId: i.id, ...payload, ...byConsole(by) } }, { name: 'org', id: merchantOrgId });
      return i;
    });
    return this.itemView(item);
  }

  async menuSetAvailability(actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    return this.menuSetAvailabilityAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuSetAvailability for the owner; field ops or admin only. */
  async opsSetAvailability(actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    return this.menuSetAvailabilityAs('console', actor, input);
  }

  private async menuSetAvailabilityAs(by: MenuAccess, actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    await this.access(actor, input.merchantOrgId, 'any', by);
    return this.itemEvent(actor, input.merchantOrgId, input.available ? 'item.restocked' : 'item.sold_out', { until: null }, (tx) => this.catalog.setAvailability(input.merchantOrgId, input.itemId, input.available, tx), by);
  }

  async menuSoldOutToday(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    return this.menuSoldOutTodayAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuSoldOutToday for the owner; field ops or admin only. */
  async opsSoldOutToday(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    return this.menuSoldOutTodayAs('console', actor, input);
  }

  private async menuSoldOutTodayAs(by: MenuAccess, actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    await this.access(actor, input.merchantOrgId, 'any', by);
    return this.uow.run(async (tx) => {
      const item = await this.catalog.soldOutToday(input.merchantOrgId, input.itemId, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'item.sold_out', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, until: item.soldOutUntil?.toISOString() ?? null, ...byConsole(by) } },
        { name: 'org', id: input.merchantOrgId },
      );
      return this.itemView(item);
    });
  }

  private historyView(rows: Awaited<ReturnType<CatalogService['priceHistory']>>): PriceChange[] {
    return rows.map((r) => ({ oldPriceIqd: r.oldPriceIqd, newPriceIqd: r.newPriceIqd, changedBy: r.changedById, at: r.at }));
  }

  async menuUpdatePrice(actor: Actor, input: { merchantOrgId: string; itemId: string; priceIqd: number }): Promise<{ item: AdminMenuItem; history: PriceChange[] }> {
    await this.owner(actor, input.merchantOrgId);
    return this.uow.run(async (tx) => {
      const before = await this.catalog.adminItem(input.merchantOrgId, input.itemId, tx);
      const { item, changed } = await this.catalog.updatePrice(input.merchantOrgId, input.itemId, input.priceIqd, actor.personId, tx);
      if (changed) {
        await this.events.emit(
          tx,
          { actorId: actor.personId, type: 'item.price_changed', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, oldPriceIqd: before.priceIqd, newPriceIqd: item.priceIqd } },
          { name: 'org', id: input.merchantOrgId },
        );
      }
      return { item: this.itemView(item), history: this.historyView(await this.catalog.priceHistory(input.merchantOrgId, input.itemId, tx)) };
    });
  }

  async menuPriceHistory(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<PriceChange[]> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.historyView(await this.catalog.priceHistory(input.merchantOrgId, input.itemId));
  }

  async menuReplacePhoto(actor: Actor, input: { merchantOrgId: string; itemId: string; uploadId: string }): Promise<AdminMenuItem> {
    await this.roleAt(actor, input.merchantOrgId);
    await this.assertUpload(actor.personId, input.uploadId);
    // p4 (Ali 2026-10-08): the photo shows to customers at once; `review: 'pending'` puts it on the
    // team's same-day review (the Console queue reads `CatalogService.photoReviewQueue`).
    return this.itemEvent(actor, input.merchantOrgId, 'item.photo_replaced', { uploadId: input.uploadId, review: 'pending' }, (tx) =>
      this.catalog.replacePhoto(input.merchantOrgId, input.itemId, `${UPLOAD_PHOTO_PREFIX}${input.uploadId}`, tx, null, true),
    );
  }

  async menuUpsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    return this.menuUpsertItemAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuUpsertItem for the owner; field ops or admin only. */
  async opsUpsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    return this.menuUpsertItemAs('console', actor, input);
  }

  private async menuUpsertItemAs(by: MenuAccess, actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    await this.access(actor, input.merchantOrgId, 'owner', by);
    await this.consolePriceGuard(input.merchantOrgId, by, async () => !input.itemId || (await this.catalog.adminItem(input.merchantOrgId, input.itemId)).priceIqd !== input.priceIqd);
    return this.uow.run(async (tx) => {
      // The customer labels and the ticket kind share one column: a save that names one keeps the other.
      const stored = input.labels !== undefined || input.kind !== undefined
        ? input.itemId ? ((await this.catalog.adminItem(input.merchantOrgId, input.itemId, tx)).labels ?? []) : []
        : null;
      const labels = stored === null
        ? undefined
        : withKind(input.labels ?? stored.filter((l) => (DISH_LABELS as readonly string[]).includes(l)), input.kind !== undefined ? input.kind : kindOfLabels(stored));
      const { item, created } = await this.catalog.upsertItem(
        input.merchantOrgId,
        {
          itemId: input.itemId,
          patch: {
            nameAr: input.nameAr,
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            priceIqd: input.priceIqd,
            ...(input.categoryAr !== undefined ? { categoryAr: input.categoryAr } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.prepTimeMin !== undefined ? { prepTimeMin: input.prepTimeMin } : {}),
            ...(input.available !== undefined ? { available: input.available } : {}),
            ...(input.servesMin !== undefined ? { servesMin: input.servesMin } : {}),
            ...(input.servesMax !== undefined ? { servesMax: input.servesMax } : {}),
            ...(labels !== undefined ? { labels } : {}),
          },
        },
        actor.personId,
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: created ? 'item.published' : 'item.updated', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, priceIqd: item.priceIqd, ...byConsole(by) } },
        { name: 'org', id: input.merchantOrgId },
      );
      return this.itemView(item);
    });
  }

  async menuUpsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    return this.menuUpsertCategoryAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuUpsertCategory for the owner; field ops or admin only. */
  async opsUpsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    return this.menuUpsertCategoryAs('console', actor, input);
  }

  private async menuUpsertCategoryAs(by: MenuAccess, actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    await this.access(actor, input.merchantOrgId, 'owner', by);
    await this.uow.run(async (tx) => {
      const touched = await this.catalog.upsertCategory(input.merchantOrgId, input, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'menu.category_updated', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, nameAr: input.nameAr, renameFrom: input.renameFrom ?? null, items: touched, ...byConsole(by) } },
        { name: 'org', id: input.merchantOrgId },
      );
    });
    return this.menuView(input.merchantOrgId);
  }

  async menuReorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    return this.menuReorderCategoriesAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuReorderCategories for the owner; field ops or admin only. */
  async opsReorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    return this.menuReorderCategoriesAs('console', actor, input);
  }

  private async menuReorderCategoriesAs(by: MenuAccess, actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    await this.access(actor, input.merchantOrgId, 'owner', by);
    await this.uow.run(async (tx) => {
      const touched = await this.catalog.reorderCategories(input.merchantOrgId, input.order, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'menu.categories_reordered', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, order: [...input.order], items: touched, ...byConsole(by) } },
        { name: 'org', id: input.merchantOrgId },
      );
    });
    return this.menuView(input.merchantOrgId);
  }

  async menuSetModifiers(actor: Actor, input: { merchantOrgId: string; itemId: string; groups: Array<{ nameAr: string; nameEn?: string | null | undefined; minSelect: number; maxSelect: number; required: boolean; modifiers: Array<{ nameAr: string; nameEn?: string | null | undefined; priceIqd: number; available: boolean; servesMin?: number | null | undefined; servesMax?: number | null | undefined }> }> }): Promise<AdminMenuItem> {
    return this.menuSetModifiersAs('merchant', actor, input);
  }

  /** Console (`ops.stores.*`): menuSetModifiers for the owner; field ops or admin only. */
  async opsSetModifiers(actor: Actor, input: { merchantOrgId: string; itemId: string; groups: Array<{ nameAr: string; nameEn?: string | null | undefined; minSelect: number; maxSelect: number; required: boolean; modifiers: Array<{ nameAr: string; nameEn?: string | null | undefined; priceIqd: number; available: boolean; servesMin?: number | null | undefined; servesMax?: number | null | undefined }> }> }): Promise<AdminMenuItem> {
    return this.menuSetModifiersAs('console', actor, input);
  }

  private async menuSetModifiersAs(by: MenuAccess, actor: Actor, input: { merchantOrgId: string; itemId: string; groups: Array<{ nameAr: string; nameEn?: string | null | undefined; minSelect: number; maxSelect: number; required: boolean; modifiers: Array<{ nameAr: string; nameEn?: string | null | undefined; priceIqd: number; available: boolean; servesMin?: number | null | undefined; servesMax?: number | null | undefined }> }> }): Promise<AdminMenuItem> {
    await this.access(actor, input.merchantOrgId, 'owner', by);
    await this.consolePriceGuard(input.merchantOrgId, by, async () => modifierPricesChanged((await this.catalog.adminItem(input.merchantOrgId, input.itemId)).modifierGroups, input.groups));
    return this.itemEvent(actor, input.merchantOrgId, 'item.modifiers_updated', { groups: input.groups.length }, (tx) => this.catalog.setModifiers(input.merchantOrgId, input.itemId, input.groups, tx), by);
  }

  /**
   * The Console's «الصق المنيو» (`ops.stores.addItems`): pasted dishes created in one go, after the
   * menu's last dish, with their first price-history rows. A shop open to customers refuses it (each
   * row sets a price, and prices there are the owner's).
   */
  async opsAddItems(actor: Actor, input: { merchantOrgId: string; categoryAr?: string | null | undefined; items: ReadonlyArray<{ nameAr: string; priceIqd: number }> }): Promise<AdminMenu> {
    await this.access(actor, input.merchantOrgId, 'owner', 'console');
    await this.consolePriceGuard(input.merchantOrgId, 'console', async () => true);
    await this.uow.run(async (tx) => {
      let order = (await this.catalog.adminMenu(input.merchantOrgId)).reduce((m, i) => Math.max(m, i.sortOrder), 0);
      for (const row of input.items) {
        order += 10;
        const { item } = await this.catalog.upsertItem(input.merchantOrgId, { patch: { nameAr: row.nameAr, priceIqd: row.priceIqd, categoryAr: input.categoryAr ?? null, sortOrder: order } }, actor.personId, tx);
        await this.events.emit(
          tx,
          { actorId: actor.personId, type: 'item.published', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, priceIqd: item.priceIqd, by: 'console' } },
          { name: 'org', id: input.merchantOrgId },
        );
      }
    });
    return this.menuView(input.merchantOrgId);
  }

  /**
   * The Console's «من صورنا» (`ops.stores.libraryPhoto`): one of Driver's library photos becomes the
   * dish's «صورة توضيحية», as setup's library pick does, without an upload or the same-day review
   * (the library is ours). Only a file that is really in the library is accepted.
   */
  async opsLibraryPhoto(actor: Actor, input: { merchantOrgId: string; itemId: string; photo: string }): Promise<AdminMenuItem> {
    await this.access(actor, input.merchantOrgId, 'any', 'console');
    const slug = LIBRARY_PHOTO_FILE.exec(input.photo)?.[1];
    if (!slug || !foodMediaPath(input.photo)) throw new DriverError('upload_invalid');
    return this.itemEvent(actor, input.merchantOrgId, 'item.photo_replaced', { library: slug }, (tx) => this.catalog.replacePhoto(input.merchantOrgId, input.itemId, `/media/food/${input.photo}`, tx, slug), 'console');
  }

  private importView(j: MenuImportJobRecord): MenuImportJob {
    return {
      jobId: j.id,
      merchantOrgId: j.orgId,
      state: j.state,
      photoUploadIds: [...j.photoRefs],
      photoUrls: j.photoRefs.map((id) => this.blobs.readUrl(id)),
      items: j.items.map((i) => ({ nameAr: i.nameAr, priceIqd: i.priceIqd, categoryAr: i.categoryAr ?? null, description: i.description ?? null, sourceUploadId: i.sourceUploadId ?? null })),
      ocr: j.ocr,
      createdAt: j.createdAt,
      appliedAt: j.appliedAt,
      appliedCount: j.appliedCount,
    };
  }

  async menuImportFromPhotos(actor: Actor, input: { merchantOrgId: string; uploadIds: string[] }): Promise<MenuImportJob> {
    await this.owner(actor, input.merchantOrgId);
    for (const id of input.uploadIds) await this.assertUpload(actor.personId, id);
    return this.uow.run(async (tx) => {
      const job = await this.catalog.createImportJob(input.merchantOrgId, input.uploadIds, actor.personId, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'menu.import_started', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, jobId: job.id, photos: input.uploadIds.length, ocr: 'stub' } }, { name: 'org', id: input.merchantOrgId });
      return this.importView(job);
    });
  }

  async menuImportJob(actor: Actor, input: { merchantOrgId: string; jobId: string }): Promise<MenuImportJob> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.importView(await this.catalog.importJob(input.merchantOrgId, input.jobId));
  }

  async menuApplyImport(actor: Actor, input: { merchantOrgId: string; jobId: string; items: Array<{ nameAr: string; priceIqd: number; categoryAr?: string | null | undefined; description?: string | null | undefined; sourceUploadId?: string | null | undefined }> }): Promise<MenuImportJob> {
    await this.owner(actor, input.merchantOrgId);
    return this.uow.run(async (tx) => {
      const job = await this.catalog.applyImport(input.merchantOrgId, input.jobId, input.items, actor.personId, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'menu.imported', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, jobId: job.id, items: job.appliedCount } }, { name: 'org', id: input.merchantOrgId });
      return this.importView(job);
    });
  }

  // ───────────────────────── deals ─────────────────────────

  async dealsList(actor: Actor, input: MerchantScope): Promise<DealView[]> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.promotions.list(input.merchantOrgId);
  }

  private async cityOf(merchantOrgId: string): Promise<string> {
    return (await this.orgs.find(merchantOrgId))?.cityId ?? this.config.cityIds()[0] ?? 'aziziyah';
  }

  private dealRules(cityId: string): { requirePlatformApproval: boolean; maxPercent: number; maxDays: number } {
    return { requirePlatformApproval: true, maxPercent: 50, maxDays: 60, ...this.config.city(cityId)?.merchantDeals };
  }

  /** Owner check, validation (city rules, own items) and the server-side projection of a draft. */
  private async draftDeal(actor: Actor, input: { merchantOrgId: string } & DealProposal) {
    await this.owner(actor, input.merchantOrgId);
    const cityId = await this.cityOf(input.merchantOrgId);
    const rules = this.dealRules(cityId);
    this.promotions.validate(input, rules);
    if (input.itemIds.length > 0) {
      const own = new Set((await this.catalog.adminMenu(input.merchantOrgId)).map((i) => i.id));
      if (input.itemIds.some((id) => !own.has(id))) throw new DriverError('deal_invalid');
    }
    const now = this.clock.now();
    const history = await this.orders.merchantOrders(input.merchantOrgId, { from: new Date(now.getTime() - PROJECTION_BASIS_DAYS * DAY_MS), to: now });
    const projection = projectDeal(
      history.map((o) => ({ placedAt: o.placedAt, state: o.state, itemsTotalIqd: o.itemsTotalIqd, deliveryFeeIqd: o.deliveryFeeIqd, lines: o.lines.map((l) => ({ catalogItemId: l.catalogItemId, qty: l.qty, unitPriceIqd: l.unitPriceIqd })) })),
      input,
      now,
    );
    return { cityId, rules, projection };
  }

  /** What a draft would cost, before the owner submits it (nothing is stored). */
  async dealsProject(
    actor: Actor,
    input: { merchantOrgId: string; type: DealView['type']; value: number; nameAr: string; itemIds: string[]; schedule: DealView['schedule']; budgetCapIqd?: number | undefined; minOrderIqd: number },
  ): Promise<DealProjectionView> {
    const { rules, projection } = await this.draftDeal(actor, input);
    return { projected: projection, basisDays: PROJECTION_BASIS_DAYS, requiresApproval: rules.requirePlatformApproval };
  }

  async dealsPropose(
    actor: Actor,
    input: { merchantOrgId: string; type: DealView['type']; value: number; nameAr: string; itemIds: string[]; schedule: DealView['schedule']; budgetCapIqd?: number | undefined; minOrderIqd: number },
  ): Promise<DealView> {
    const { cityId, rules, projection } = await this.draftDeal(actor, input);
    return this.promotions.propose({ ...input, cityId, ownerId: actor.personId, projection, requireApproval: rules.requirePlatformApproval });
  }

  async dealsSetActive(actor: Actor, input: { merchantOrgId: string; dealId: string; active: boolean }): Promise<DealView> {
    await this.owner(actor, input.merchantOrgId);
    return this.promotions.setActive(input.merchantOrgId, input.dealId, input.active, actor.personId);
  }

  // ───────────────────────── money ─────────────────────────

  private async ordersIn(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Map<string, Order>> {
    return new Map((await this.orders.merchantOrders(merchantOrgId, range)).map((o) => [o.id, o]));
  }

  async moneyToday(actor: Actor, input: MerchantScope): Promise<MoneyToday> {
    await this.owner(actor, input.merchantOrgId);
    const now = this.clock.now();
    const range = localPeriod('day', now);
    const [statement, balance, orders] = await Promise.all([
      this.ledger.statement(Accounts.merchantCash(input.merchantOrgId), { from: range.from, to: range.to }),
      this.ledgerFacade.merchantBalance(input.merchantOrgId),
      this.ordersIn(input.merchantOrgId, range),
    ]);
    return composeMoneyToday({ merchantOrgId: input.merchantOrgId, localDate: localDateKey(now), statement, orders, balance, rules: AZIZIYAH_MONEY_RULES });
  }

  async moneyCash(actor: Actor, input: MerchantScope): Promise<MerchantCashAccount> {
    await this.owner(actor, input.merchantOrgId);
    const now = this.clock.now();
    const [balance, statement, events] = await Promise.all([
      this.ledgerFacade.merchantBalance(input.merchantOrgId),
      this.ledger.statement(Accounts.merchantCash(input.merchantOrgId), { from: new Date(now.getTime() - HANDOVER_LOOKBACK_DAYS * DAY_MS), to: new Date(now.getTime() + 1) }),
      this.events.forAggregate('merchant', input.merchantOrgId),
    ]);
    const courierIds = new Set<string>(balance.holders.map((h) => h.courierId));
    for (const l of statement.lines) if (l.type === 'merchant_paid_by_courier' && l.counterparty.startsWith('cash:')) courierIds.add(l.counterparty.slice('cash:'.length));
    for (const e of events) if (e.type === 'merchant.settlement_assigned' && typeof e.payload['courierId'] === 'string') courierIds.add(e.payload['courierId']);
    // First names only on the merchant's screen (the courier's card); vault reads are logged.
    const names = new Map<string, string | null>();
    for (const id of courierIds) names.set(id, (await this.identity.courierCard(id, actor.personId)).firstName);
    return composeCashAccount({ merchantOrgId: input.merchantOrgId, now, balance, statement, events, names });
  }

  async moneyStatement(actor: Actor, input: { merchantOrgId: string; weekOf?: Date | undefined }): Promise<WeeklyStatement> {
    await this.owner(actor, input.merchantOrgId);
    const range = localPeriod('week', input.weekOf ?? this.clock.now());
    const [statement, orders, org] = await Promise.all([
      this.ledger.statement(Accounts.merchantCash(input.merchantOrgId), { from: range.from, to: range.to }),
      this.ordersIn(input.merchantOrgId, { from: new Date(range.from.getTime() - DAY_MS), to: range.to }),
      this.orgs.get(input.merchantOrgId),
    ]);
    // His rate now, for the statement's header; a starter shop also sees the day its starter period began.
    const tier = org.merchant?.commissionTier ?? ORDERS_RULES.defaultCommissionTier;
    const rate = { tier, pct: commissionPctOf(tier), starterSince: tier === 'starter' ? org.createdAt : null };
    return { ...composeStatement({ merchantOrgId: input.merchantOrgId, from: range.from, to: range.to, statement, orders }), rate };
  }

  private async disputeOf(order: Order, responses: ReadonlyMap<string, DisputeResponseRecord>, names: ReadonlyMap<string, string>): Promise<MerchantDispute | null> {
    const opened = (await this.events.forOrder(order.id)).filter((e) => e.type === 'order.disputed').at(-1);
    if (!opened) return null;
    const p = opened.payload;
    const rawKind = typeof p['kind'] === 'string' ? p['kind'] : 'other';
    const participants = new Map(order.participants.map((x) => [x.id, x.label ?? null]));
    const r = responses.get(order.id);
    return {
      orderId: order.id,
      kind: disputeKindOf(rawKind),
      note: typeof p['note'] === 'string' ? p['note'] : null,
      openedAt: opened.occurredAt,
      evidence: {
        acceptedAt: order.acceptedAt,
        readyAt: order.readyAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        promisedReadyAt: order.promisedReadyAt,
        lines: order.lines.map((l) => ({ name: (l.catalogItemId ? names.get(l.catalogItemId) : null) ?? l.freeText ?? '—', qty: l.qty, participant: l.participantId ? (participants.get(l.participantId) ?? null) : null })),
        itemsIqd: order.itemsTotalIqd,
        photos: (Array.isArray(p['photoUploadIds']) ? p['photoUploadIds'] : []).filter((x): x is string => typeof x === 'string').map((id) => this.blobs.readUrl(id)),
      },
      defaultOutcome: defaultOutcome(rawKind, order),
      respondBy: new Date(opened.occurredAt.getTime() + DISPUTE_RESPONSE_HOURS * 3_600_000),
      response: r ? { decision: r.decision, note: r.note, evidencePhotos: r.evidenceRefs.length, photoUrls: r.evidenceRefs.map((ref) => this.blobs.readUrl(ref)), at: r.at } : null,
    };
  }

  async moneyDisputes(actor: Actor, input: MerchantScope): Promise<MerchantDispute[]> {
    await this.owner(actor, input.merchantOrgId);
    const now = this.clock.now();
    const orders = [...(await this.ordersIn(input.merchantOrgId, { from: new Date(now.getTime() - DISPUTE_LOOKBACK_DAYS * DAY_MS), to: new Date(now.getTime() + 1) })).values()];
    const responses = new Map((await this.repo.responses(orders.map((o) => o.id))).map((r) => [r.orderId, r]));
    const names = new Map((await this.catalog.adminMenu(input.merchantOrgId)).map((i) => [i.id, i.nameAr]));
    const out: MerchantDispute[] = [];
    for (const o of orders) {
      if (o.state !== 'disputed' && o.state !== 'refunded' && !responses.has(o.id)) continue;
      const d = await this.disputeOf(o, responses, names);
      if (d) out.push(d);
    }
    return out.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }

  /**
   * The restaurant takes its cash from a courier on its own tablet (decisions §3: confirmed by the
   * tablet, with both sides' confirmation — the owner types what he counted, the courier reads his
   * daily hand-over code). Never more than that courier holds for it; a mismatch opens an incident and
   * posts nothing. A retry of the same sheet posts once.
   */
  async moneyReceiveCourierCash(actor: Actor, input: { merchantOrgId: string; courierId: string; amountIqd: number; code: string; idempotencyKey: string }): Promise<MerchantCashAccount> {
    await this.owner(actor, input.merchantOrgId);
    if (!this.ops || !this.merchantCash) throw new DriverError('forbidden');
    // An owner who also delivers can't take his own hand-in: the cash goes to the shop through someone else.
    if (input.courierId === actor.personId) throw new DriverError('staff_own_account');
    const handoverId = `mt_${createHash('sha256').update(`${input.merchantOrgId}:${input.idempotencyKey}`).digest('hex').slice(0, 24)}`;
    await this.ops.verifyCourierCode(actor, input.courierId, input.code);
    // A retry or a double tap is answered under the merchant's lock: the hand-over posts once, and the
    // same key with another amount or courier is refused.
    await this.merchantCash.confirmHandover({ handoverId, courierId: input.courierId, merchantId: input.merchantOrgId, amountIqd: input.amountIqd, merchantConfirmedIqd: input.amountIqd, tabletTap: true });
    return this.moneyCash(actor, { merchantOrgId: input.merchantOrgId });
  }

  async moneyRespondDispute(actor: Actor, input: { merchantOrgId: string; orderId: string; decision: 'accept_default' | 'contest'; note?: string | undefined; evidenceUploadIds: string[] }): Promise<MerchantDispute> {
    await this.owner(actor, input.merchantOrgId);
    const order = await this.orders.get(input.orderId).catch(() => null);
    if (!order || order.merchantOrgId !== input.merchantOrgId) throw new DriverError('dispute_not_found');
    for (const id of input.evidenceUploadIds) await this.assertUpload(actor.personId, id);
    const names = new Map((await this.catalog.adminMenu(input.merchantOrgId)).map((i) => [i.id, i.nameAr]));
    const open = await this.disputeOf(order, new Map(), names);
    if (!open) throw new DriverError('dispute_not_found');
    const now = this.clock.now();
    // After respondBy the default outcome stands (wave-2 API): no late contest or change of answer.
    if (open.respondBy && now.getTime() > open.respondBy.getTime()) throw new DriverError('dispute_response_closed');
    const response = await this.uow.run(async (tx) => {
      const r = await this.repo.upsertResponse(
        { orderId: order.id, merchantOrgId: input.merchantOrgId, decision: input.decision, note: input.note ?? null, evidenceRefs: [...input.evidenceUploadIds], respondedById: actor.personId, at: now },
        tx,
      );
      // Support sees the answer on the incident; a contest keeps the default outcome until support decides.
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'merchant.dispute_responded', occurredAt: now, orderId: order.id, payload: { merchantOrgId: input.merchantOrgId, decision: input.decision, evidencePhotos: input.evidenceUploadIds.length } },
        { name: 'order', id: order.id },
      );
      return r;
    });
    return (await this.disputeOf(order, new Map([[order.id, response]]), names))!;
  }

  // ───────────────────────── insights ─────────────────────────

  async insights(actor: Actor, input: { merchantOrgId: string; days: number }): Promise<MerchantInsights> {
    const role = await this.roleAt(actor, input.merchantOrgId);
    const to = this.clock.now();
    const from = new Date(to.getTime() - input.days * DAY_MS);
    const [orders, menu, soldOut] = await Promise.all([
      this.orders.merchantOrders(input.merchantOrgId, { from, to: new Date(to.getTime() + 1) }),
      this.catalog.adminMenu(input.merchantOrgId),
      // m4: the store's sold-out events over the window (indexed aggregate + occurred_at).
      this.events.forAggregate('org', input.merchantOrgId, { from, to: new Date(to.getTime() + 1), types: ['item.sold_out'] }),
    ]);
    const itemNames = new Map(menu.map((i) => [i.id, i.nameAr]));
    const insights = { ...composeInsights({ merchantOrgId: input.merchantOrgId, from, to, orders, itemNames }), soldOutHabits: soldOutHabits(soldOut, itemNames) };
    // Review 2026-10-04 #10: money views are owner-only. Staff keep prep honesty, rejections, ratings,
    // peaks and what sells — ranked by quantity, without what each item brought in.
    return role === 'merchant_owner' ? insights : staffInsights(insights);
  }

  // ───────────────────────── end of day (S-M6) ─────────────────────────

  /**
   * The day's summary card: orders, misses, on-time share, net (owner only) and one advice line, for
   * a Baghdad local day. Without `date`: the day the card is about now — today once the store is
   * closed for the day, or the day before from 00:30 to 05:00 (`due` says whether to show it).
   */
  async daySummary(actor: Actor, input: { merchantOrgId: string; date?: string | undefined }): Promise<MerchantDaySummary> {
    const role = await this.roleAt(actor, input.merchantOrgId);
    const now = this.clock.now();
    const status = this.merchant ? await this.merchant.storeStatus(actor, { merchantOrgId: input.merchantOrgId }) : null;
    const closedNow = Boolean(status && (status.closed !== null || status.schedule?.inHours === false));
    const auto = summaryDay(now, closedNow);
    const day = input.date ? { localDate: input.date, due: input.date === auto.localDate && auto.due, reason: input.date === auto.localDate ? auto.reason : null } : auto;
    const from = startOfLocalDay(new Date(`${day.localDate}T12:00:00+03:00`));
    const range = { from, to: new Date(from.getTime() + DAY_MS) };
    const org = await this.orgs.get(input.merchantOrgId);
    const settings = await this.orgs.merchantSettings(input.merchantOrgId);
    const pauses = settings.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])];
    const ordersById = await this.ordersIn(input.merchantOrgId, range);
    let netIqd: number | null = null;
    if (role === 'merchant_owner') {
      const [statement, balance] = await Promise.all([this.ledger.statement(Accounts.merchantCash(input.merchantOrgId), range), this.ledgerFacade.merchantBalance(input.merchantOrgId)]);
      netIqd = composeMoneyToday({ merchantOrgId: input.merchantOrgId, localDate: day.localDate, statement, orders: ordersById, balance, rules: AZIZIYAH_MONEY_RULES }).netIqd;
    }
    return composeDaySummary({
      merchantOrgId: input.merchantOrgId,
      storeName: org.name,
      day,
      orders: [...ordersById.values()],
      inPause: (at) => activePauseWindow(at, pauses, DEFAULT_TIMEZONE) !== null,
      netIqd,
    });
  }

  // ───────────────────────── who pressed what (owner only) ─────────────────────────

  /**
   * Names for the feed: one batched vault read (purpose `merchant_activity_view`) of the people who
   * acted, name only (the phone is dropped here). The ids are the actors of kitchen actions, which
   * are gated to a role at this store; the orders' customers are left out as a second fence.
   */
  private async activityNames(actor: Actor, events: Parameters<typeof activityActorIds>[0], notStaff: ReadonlySet<string>, merchantOrgId: string): Promise<ActivityNames> {
    const ids = activityActorIds(events).filter((id) => !notStaff.has(id));
    const [cards, menu] = await Promise.all([
      ids.length > 0 ? this.identity.memberCards(ids, actor.personId, 'merchant_activity_view') : Promise.resolve({} as Record<string, { name: string | null }>),
      events.some((e) => e.type.startsWith('item.')) ? this.catalog.adminMenu(merchantOrgId) : Promise.resolve([]),
    ]);
    const people = new Map<string, string | null>();
    for (const id of ids) people.set(id, cards[id]?.name ?? null);
    return { people, itemNames: new Map(menu.map((i) => [i.id, i.nameAr])), viewerId: actor.personId };
  }

  /**
   * «مين سوّى شنو»: a Baghdad local day's kitchen actions (default today), newest first, with who did
   * each. Owner only (staff FORBIDDEN on the server). Reads: the day's orders, the store's dish
   * events for the day (indexed aggregate + occurred_at), the orders' action events (indexed
   * order_id), then one vault read for the names.
   */
  async activityToday(actor: Actor, input: { merchantOrgId: string; date?: ActivityTodayInput['date'] }): Promise<MerchantActivity> {
    await this.owner(actor, input.merchantOrgId);
    const localDate = input.date ?? localDateKey(this.clock.now());
    const noon = new Date(`${localDate}T12:00:00+03:00`);
    if (Number.isNaN(noon.getTime())) throw new DriverError('invalid_input');
    const from = startOfLocalDay(noon);
    const window = { from, to: new Date(from.getTime() + DAY_MS) };
    const [orders, itemEvents] = await Promise.all([
      this.ordersIn(input.merchantOrgId, { from: new Date(from.getTime() - ACTIVITY_ORDER_LEAD_MS), to: window.to }),
      this.events.forAggregate('org', input.merchantOrgId, { ...window, types: ITEM_ACTIVITY_TYPES }),
    ]);
    const orderEvents = await this.events.forOrders([...orders.keys()], { types: ORDER_ACTIVITY_TYPES });
    const events = [...itemEvents, ...orderEvents.filter((e) => e.occurredAt >= window.from && e.occurredAt < window.to)].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    const customers = new Set([...orders.values()].map((o) => o.ordererId));
    const names = await this.activityNames(actor, events, customers, input.merchantOrgId);
    return composeActivity({ merchantOrgId: input.merchantOrgId, localDate, events, names, window });
  }

  /** One order's kitchen actions, oldest first, with who did each. Owner only; another store's order is NOT_FOUND. */
  async activityOrder(actor: Actor, input: { merchantOrgId: string; orderId: OrderWhoInput['orderId'] }): Promise<OrderWho> {
    await this.owner(actor, input.merchantOrgId);
    const order = await this.orders.get(input.orderId).catch(() => null);
    if (!order || order.merchantOrgId !== input.merchantOrgId) throw new DriverError('not_found');
    const types: ReadonlySet<string> = new Set(ORDER_ACTIVITY_TYPES);
    const events = (await this.events.forOrder(order.id)).filter((e) => types.has(e.type));
    const names = await this.activityNames(actor, events, new Set([order.ordererId]), input.merchantOrgId);
    return { orderId: order.id, entries: activityEntries(events, names) };
  }

  // ───────────────────────── أكل بيت: the cook's side ─────────────────────────

  /** «أكلاتي» (owner and staff): her dishes with today's plates, and the reservations coming. A store that isn't a home kitchen gets home: false. */
  async homeGet(actor: Actor, input: MerchantScope): Promise<HomeKitchenView> {
    await this.roleAt(actor, input.merchantOrgId);
    if (!(await this.catalog.storefront(input.merchantOrgId))?.home) return { home: false, dishes: [], reservations: [] };
    const now = this.clock.now();
    const items = (await this.catalog.menu(input.merchantOrgId)).filter((i) => i.homeSale);
    const { tally, reservations } = await this.orders.homeKitchenOrders(input.merchantOrgId, now);
    const names = new Map(items.map((i) => [i.id, i.nameAr]));
    return {
      home: true,
      dishes: items.map((i) => this.homeDish(i, now, tally)),
      reservations: reservations.filter((r) => names.has(r.itemId)).map((r) => ({ ...r, nameAr: names.get(r.itemId)! })),
    };
  }

  /** A new dish or an edit (owner): name, her line, portion, price, how it sells. A dish moved to ready starts with no plates today. */
  async homeSaveDish(actor: Actor, input: SaveHomeDishInput): Promise<HomeKitchenDish> {
    await this.owner(actor, input.merchantOrgId);
    if (!(await this.catalog.storefront(input.merchantOrgId))?.home) throw new DriverError('forbidden');
    const before = input.itemId ? await this.catalog.adminItem(input.merchantOrgId, input.itemId) : null;
    if (before && !before.homeSale) throw new DriverError('catalog_item_unavailable');
    const wasReady = before?.homeSale?.mode === 'ready' ? before.homeSale : null;
    const homeSale: HomeSale = input.sale.mode === 'reserve' ? { mode: 'reserve', rule: input.sale.rule } : (wasReady ?? { mode: 'ready', cooked: null, cookedOn: null, setAt: null });
    const { item } = await this.uow.run((tx) =>
      this.catalog.upsertItem(
        input.merchantOrgId,
        {
          itemId: input.itemId,
          patch: {
            nameAr: input.nameAr,
            description: input.description,
            priceIqd: input.priceIqd,
            servesMin: input.servesMin,
            servesMax: input.servesMax ?? input.servesMin,
            portion: input.portion,
            homeSale,
            // A reserved dish is cooked to order: no plates count on it.
            ...(input.sale.mode === 'reserve' ? { stock: null } : wasReady ? {} : { stock: 0 }),
          },
        },
        actor.personId,
        tx,
      ),
    );
    const now = this.clock.now();
    return this.homeDish(item, now, (await this.orders.homeKitchenOrders(input.merchantOrgId, now)).tally);
  }

  /** «جاهزة اليوم» (owner and staff): the plates of a ready dish she has now; null = not cooking it today. */
  async homeSetToday(actor: Actor, input: SetHomeTodayInput): Promise<HomeKitchenDish> {
    await this.roleAt(actor, input.merchantOrgId);
    const item = await this.catalog.adminItem(input.merchantOrgId, input.itemId);
    if (item.homeSale?.mode !== 'ready') throw new DriverError('catalog_item_unavailable');
    const now = this.clock.now();
    const today = homeLocalDay(now);
    const cooked = input.left === null ? null : (input.cooked ?? (item.homeSale.cookedOn === today ? item.homeSale.cooked : null));
    const homeSale: HomeSale = { mode: 'ready', cooked, cookedOn: input.left === null ? null : today, setAt: now.toISOString() };
    const { item: saved } = await this.uow.run((tx) => this.catalog.upsertItem(input.merchantOrgId, { itemId: item.id, patch: { homeSale, stock: input.left ?? 0 } }, actor.personId, tx));
    return this.homeDish(saved, now, (await this.orders.homeKitchenOrders(input.merchantOrgId, now)).tally);
  }

  private homeDish(i: CatalogItemRecord, now: Date, tally: HomeTally): HomeKitchenDish {
    const sale = i.homeSale!;
    const today = homeLocalDay(now);
    let booked = 0;
    for (const n of tally.slots.get(i.id)?.values() ?? []) booked += n;
    return {
      id: i.id,
      nameAr: i.nameAr,
      description: i.description,
      priceIqd: i.priceIqd,
      photoUrl: this.photoUrl(i.photoUrl),
      servesMin: i.servesMin ?? null,
      servesMax: i.servesMax ?? null,
      portion: i.portion ?? null,
      available: i.available,
      sale: sale.mode === 'ready' ? { mode: 'ready', cooked: sale.cookedOn === today ? sale.cooked : null, cookingToday: sale.cookedOn === today } : { mode: 'reserve', rule: sale.rule },
      view: homeDishView(sale, i.stock, now, i.id, tally),
      booked,
    };
  }

  // ───────────────────────── joy h2: «قدر اليوم» ─────────────────────────

  /** Today's pot (even past its «لحد» time), last week's same day and the recent ones, follower counts. */
  async potGet(actor: Actor, input: MerchantScope): Promise<MerchantPotView> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.potView(input.merchantOrgId);
  }

  private async potView(merchantOrgId: string): Promise<MerchantPotView> {
    const now = this.clock.now();
    const date = potDay(now);
    const [pots, items, counts] = await Promise.all([this.catalog.recentPots(merchantOrgId, POT_RULES.recentDays), this.catalog.adminMenu(merchantOrgId), this.catalog.followerCounts(merchantOrgId)]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const name = (id: string) => byId.get(id)?.nameAr ?? '';
    const today = pots.find((p) => p.localDate === date) ?? null;
    const { lastWeek, recent } = potSuggestions(pots, date, (id) => {
      const item = byId.get(id);
      return item !== undefined && itemOnSale(item, now);
    });
    return {
      merchantOrgId,
      date,
      today: today && byId.has(today.itemId) ? { itemId: today.itemId, name: name(today.itemId), note: today.note, until: today.until, postedAt: today.updatedAt } : null,
      lastWeek: lastWeek ? { itemId: lastWeek, name: name(lastWeek) } : null,
      recent: recent.map((itemId) => ({ itemId, name: name(itemId) })),
      followers: Object.fromEntries(counts),
    };
  }

  /**
   * Posts today's pot (owner or staff: a daily kitchen task like «خلص اليوم»). In the same transaction
   * the `catalog.pot_posted` event names the dish's followers, so notify tells each of them once.
   */
  async potSet(actor: Actor, input: { merchantOrgId: string; itemId: string; note?: string | null | undefined; until?: string | null | undefined }): Promise<MerchantPotView> {
    await this.roleAt(actor, input.merchantOrgId);
    const front = await this.catalog.storefront(input.merchantOrgId);
    const restaurantName = front?.nameAr ?? (await this.orgs.get(input.merchantOrgId)).name;
    await this.uow.run(async (tx) => {
      const { pot, item, followerIds } = await this.catalog.postPot(input.merchantOrgId, { itemId: input.itemId, note: input.note ?? null, until: input.until ?? null }, actor.personId, tx);
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: 'catalog.pot_posted',
          occurredAt: this.clock.now(),
          payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, dishName: item.nameAr, restaurantName, localDate: pot.localDate, note: pot.note, until: pot.until, followerIds },
        },
        { name: 'org', id: input.merchantOrgId },
      );
    });
    return this.potView(input.merchantOrgId);
  }

  /** «شيلها»: today's pot comes off the customer home. */
  async potClear(actor: Actor, input: MerchantScope): Promise<MerchantPotView> {
    await this.roleAt(actor, input.merchantOrgId);
    await this.uow.run(async (tx) => {
      await this.catalog.clearPot(input.merchantOrgId, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'catalog.pot_cleared', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId } }, { name: 'org', id: input.merchantOrgId });
    });
    return this.potView(input.merchantOrgId);
  }

  // ───────────────────────── joy h5: «مطاعمنا» ─────────────────────────

  /** The kitchen's story; staff read it, the owner edits (showing it is his consent). */
  async storyGet(actor: Actor, input: MerchantScope): Promise<KitchenStoryView> {
    const role = await this.roleAt(actor, input.merchantOrgId);
    const story = (await this.catalog.storefront(input.merchantOrgId))?.story ?? null;
    return { merchantOrgId: input.merchantOrgId, text: story?.text ?? null, sinceYear: story?.sinceYear ?? null, shown: story?.shown ?? false, canEdit: role === 'merchant_owner', updatedAt: story?.updatedAt ?? null };
  }

  async storySet(actor: Actor, input: { merchantOrgId: string; text: string | null; sinceYear: number | null; shown: boolean }): Promise<KitchenStoryView> {
    await this.owner(actor, input.merchantOrgId);
    if (input.sinceYear !== null && input.sinceYear > Number(localDateKey(this.clock.now()).slice(0, 4))) throw new DriverError('invalid_input');
    const saved = await this.catalog.setStory(input.merchantOrgId, { text: input.text, sinceYear: input.sinceYear, shown: input.shown && input.text !== null });
    await this.events.emit(undefined, { actorId: actor.personId, type: 'catalog.story_set', occurredAt: saved.updatedAt, payload: { merchantOrgId: input.merchantOrgId, shown: saved.shown } }, { name: 'org', id: input.merchantOrgId });
    return { merchantOrgId: input.merchantOrgId, text: saved.text, sinceYear: saved.sinceYear, shown: saved.shown, canEdit: true, updatedAt: saved.updatedAt };
  }

  // ───────────────────────── staff ─────────────────────────

  /**
   * The store's people: everyone holding `merchant_owner` / `merchant_staff` there (members, with
   * names), then the pending, unexpired invites (PRV-08, Ali 2026-10-10: a person joins only by
   * accepting). A pending row holds no role yet and shows no name: inviting a number must not tell the
   * owner whose it is (review 2026-10-04 #6); only the 4+4 hint of the number he typed.
   */
  private async staffRows(actor: Actor, merchantOrgId: string): Promise<StaffMember[]> {
    const holders = await this.identity.orgRoleHolders(merchantOrgId, STAFF_KINDS);
    const roleOf = new Map<string, MerchantStaffRole>();
    for (const h of holders) if (roleOf.get(h.personId) !== 'merchant_owner') roleOf.set(h.personId, h.kind as MerchantStaffRole);
    const ids = [...roleOf.keys()];
    const now = this.clock.now();
    const invites = (await this.repo.pendingStaffInvitesOfOrg(merchantOrgId)).filter((i) => i.expiresAt > now && !roleOf.has(i.personId));
    const cards = ids.length > 0 ? await this.identity.memberCards(ids, actor.personId, 'merchant_staff_view') : {};
    const hints = invites.length > 0 ? await this.identity.invitePhoneHints(invites.map((i) => i.personId), actor.personId, 'merchant_staff_invite') : {};
    const cooldownMs = STAFF_INVITE_RULES.resendCooldownMin * 60_000;
    const members: StaffMember[] = ids.map((personId) => ({
      personId,
      name: cards[personId]?.name ?? null,
      // The 4+4 form the owner saw on the invite («0780 ••• 4455»): they added this number themselves.
      phoneMasked: cards[personId]?.phoneHint ?? null,
      role: roleOf.get(personId)!,
      you: personId === actor.personId,
      pending: false,
    }));
    const waiting: StaffMember[] = invites.map((i) => ({
      personId: i.personId,
      name: null,
      phoneMasked: hints[i.personId] ?? null,
      role: i.role,
      you: false,
      pending: true,
      phoneHint: hints[i.personId] ?? null,
      invitedAt: i.createdAt,
      inviteSentAt: i.sentAt,
      resendAfter: new Date(i.sentAt.getTime() + cooldownMs),
    }));
    return [...members, ...waiting].sort((a, b) => (a.role === b.role ? a.personId.localeCompare(b.personId) : a.role === 'merchant_owner' ? -1 : 1));
  }

  /**
   * Records the invite (outbox `merchant.staff_invite_sent`). Nothing is sent to the invited number yet
   * (no subscriber): the owner tells them to install the app and sign in with that number (NTF2-05).
   */
  private async sendInvite(
    actor: Actor,
    merchantOrgId: string,
    personId: string,
    role: MerchantStaffRole,
    resend: boolean,
  ): Promise<void> {
    const org = await this.orgs.find(merchantOrgId);
    await this.events.emit(
      undefined,
      {
        actorId: actor.personId,
        type: 'merchant.staff_invite_sent',
        occurredAt: this.clock.now(),
        payload: { merchantOrgId, personId, role, storeName: org?.name ?? null, resend },
      },
      { name: 'merchant_staff', id: merchantOrgId },
    );
  }

  private async pendingRow(actor: Actor, merchantOrgId: string, personId: string): Promise<StaffMember> {
    const row = (await this.staffRows(actor, merchantOrgId)).find((s) => s.personId === personId);
    if (!row) throw new DriverError('internal');
    return row;
  }

  /** Owner sends a waiting invite again; within the cooldown it is a no-op that returns the row. */
  async staffResendInvite(
    actor: Actor,
    input: { merchantOrgId: string; personId: string },
  ): Promise<StaffMember> {
    await this.owner(actor, input.merchantOrgId);
    const row = (await this.staffRows(actor, input.merchantOrgId)).find(
      (s) => s.personId === input.personId,
    );
    if (!row) throw new DriverError('not_found');
    if (!row.pending) throw new DriverError('staff_invite_not_pending');
    if (row.resendAfter && row.resendAfter.getTime() > this.clock.now().getTime()) return row;
    const invite = await this.repo.staffInvite(input.merchantOrgId, input.personId);
    if (!invite) throw new DriverError('not_found');
    await this.repo.updateStaffInvite(invite.id, { sentAt: this.clock.now() });
    await this.sendInvite(actor, input.merchantOrgId, input.personId, row.role, true);
    return this.pendingRow(actor, input.merchantOrgId, input.personId);
  }

  async staffList(actor: Actor, input: MerchantScope): Promise<StaffMember[]> {
    await this.owner(actor, input.merchantOrgId);
    return this.staffRows(actor, input.merchantOrgId);
  }

  /**
   * Owner invites by phone (the Person is found or created pseudonymously; the number stays in the
   * vault). PRV-08: this gives no role; the person joins when he accepts in the Merchant app
   * (`staffRespondInvite`). Someone already at the store just gets the new role. A declined, cancelled
   * or expired invite starts again as a fresh pending one; a waiting one keeps its dates, takes the new
   * role and goes out again only after the resend cooldown.
   */
  async staffInvite(actor: Actor, input: { merchantOrgId: string; phone: string; role: MerchantStaffRole }): Promise<StaffMember> {
    await this.owner(actor, input.merchantOrgId);
    const personId = await this.identity.ensurePersonByPhone(input.phone, actor.personId, 'merchant_staff_invite');
    const staff = await this.staffRows(actor, input.merchantOrgId);
    if (staff.some((s) => s.personId === personId && !s.pending)) return this.setRoleOf(actor, input.merchantOrgId, personId, input.role);
    const now = this.clock.now();
    const existing = await this.repo.staffInvite(input.merchantOrgId, personId);
    if (existing && existing.status === 'pending' && existing.expiresAt > now) {
      const due = existing.sentAt.getTime() + STAFF_INVITE_RULES.resendCooldownMin * 60_000 <= now.getTime();
      await this.repo.updateStaffInvite(existing.id, { role: input.role, ...(due ? { sentAt: now } : {}) });
      if (due) await this.sendInvite(actor, input.merchantOrgId, personId, input.role, true);
      return this.pendingRow(actor, input.merchantOrgId, personId);
    }
    await this.repo.upsertStaffInvite({
      merchantOrgId: input.merchantOrgId,
      personId,
      role: input.role,
      invitedById: actor.personId,
      createdAt: now,
      sentAt: now,
      expiresAt: new Date(now.getTime() + STAFF_INVITE_RULES.expiresAfterDays * DAY_MS),
    });
    await this.sendInvite(actor, input.merchantOrgId, personId, input.role, false);
    return this.pendingRow(actor, input.merchantOrgId, personId);
  }

  /**
   * PRV-08: the caller's own pending, unexpired invites across stores: store name, role, dates (no
   * owner name). Stores he already works at, and invites whose inviter is no longer an owner, are left out.
   */
  async staffMyInvites(actor: Actor): Promise<MyStaffInvite[]> {
    const now = this.clock.now();
    const invites = (await this.repo.pendingStaffInvitesOfPerson(actor.personId)).filter((i) => i.expiresAt > now);
    if (invites.length === 0) return [];
    const at = new Set((await this.identity.scopedOrgs(actor.personId, STAFF_KINDS)).map((g) => g.orgId));
    const out: MyStaffInvite[] = [];
    for (const i of invites) {
      if (at.has(i.merchantOrgId)) continue;
      // An invite from someone no longer an owner there can't be accepted, so it isn't shown.
      if (!(await this.identity.hasRole(i.invitedById, 'merchant_owner', i.merchantOrgId))) continue;
      const org = await this.orgs.find(i.merchantOrgId);
      if (!org) continue;
      out.push({ merchantOrgId: i.merchantOrgId, storeName: org.name, role: i.role, invitedAt: i.createdAt, expiresAt: i.expiresAt });
    }
    return out.sort((a, b) => b.invitedAt.getTime() - a.invitedAt.getTime());
  }

  /**
   * PRV-08: only the invited person answers, only a pending, unexpired invite whose inviter is still
   * an owner there. Accepting gives the invite's role (the same grant as a role change, granted by the
   * owner who invited); declining gives nothing. Either way an event on the store's staff stream.
   */
  async staffRespondInvite(actor: Actor, input: { merchantOrgId: string; accept: boolean }): Promise<MyStaffInvite[]> {
    const now = this.clock.now();
    const invite = await this.repo.staffInvite(input.merchantOrgId, actor.personId);
    if (!invite || invite.personId !== actor.personId || invite.status !== 'pending' || invite.expiresAt <= now) throw new DriverError('staff_invite_not_found');
    if (input.accept && !(await this.identity.hasRole(invite.invitedById, 'merchant_owner', input.merchantOrgId))) throw new DriverError('staff_invite_not_found');
    const already = (await this.identity.scopedOrgs(actor.personId, STAFF_KINDS)).some((g) => g.orgId === input.merchantOrgId);
    await this.uow.run(async (tx) => {
      if (input.accept && !already) {
        const grantor = { personId: invite.invitedById };
        await this.identity.grantRole(grantor, { personId: actor.personId, kind: invite.role, orgId: input.merchantOrgId });
        const other: MerchantStaffRole = invite.role === 'merchant_owner' ? 'merchant_staff' : 'merchant_owner';
        await this.identity.revokeRole(grantor, { personId: actor.personId, kind: other, orgId: input.merchantOrgId });
      }
      await this.repo.updateStaffInvite(invite.id, { status: input.accept ? 'accepted' : 'declined', answeredAt: now }, tx);
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: input.accept ? 'merchant.staff_invite_accepted' : 'merchant.staff_invite_declined',
          occurredAt: now,
          payload: { merchantOrgId: input.merchantOrgId, personId: actor.personId, role: invite.role, invitedById: invite.invitedById },
        },
        { name: 'merchant_staff', id: input.merchantOrgId },
      );
    });
    return this.staffMyInvites(actor);
  }

  async staffSetRole(actor: Actor, input: { merchantOrgId: string; personId: string; role: MerchantStaffRole }): Promise<StaffMember> {
    await this.owner(actor, input.merchantOrgId);
    const row = (await this.staffRows(actor, input.merchantOrgId)).find((s) => s.personId === input.personId);
    if (!row) throw new DriverError('not_found');
    if (row.pending) {
      // A waiting invite: change the role it offers (still nothing granted until he accepts).
      const invite = await this.repo.staffInvite(input.merchantOrgId, input.personId);
      if (!invite) throw new DriverError('not_found');
      await this.repo.updateStaffInvite(invite.id, { role: input.role });
      return this.pendingRow(actor, input.merchantOrgId, input.personId);
    }
    return this.setRoleOf(actor, input.merchantOrgId, input.personId, input.role);
  }

  private async setRoleOf(actor: Actor, merchantOrgId: string, personId: string, role: MerchantStaffRole): Promise<StaffMember> {
    const staff = (await this.staffRows(actor, merchantOrgId)).filter((s) => !s.pending);
    const current = staff.find((s) => s.personId === personId)?.role;
    if (current === 'merchant_owner' && role !== 'merchant_owner' && staff.filter((s) => s.role === 'merchant_owner').length <= 1) throw new DriverError('staff_last_owner');
    await this.uow.run(async () => {
      await this.identity.grantRole(actor, { personId, kind: role, orgId: merchantOrgId });
      const other: MerchantStaffRole = role === 'merchant_owner' ? 'merchant_staff' : 'merchant_owner';
      await this.identity.revokeRole(actor, { personId, kind: other, orgId: merchantOrgId });
    });
    const row = (await this.staffRows(actor, merchantOrgId)).find((s) => s.personId === personId);
    if (!row) throw new DriverError('internal');
    return row;
  }

  /** A member loses his roles there; a waiting invite is cancelled (it can no longer be accepted). */
  async staffRemove(actor: Actor, input: { merchantOrgId: string; personId: string }): Promise<{ removed: boolean }> {
    await this.owner(actor, input.merchantOrgId);
    const staff = await this.staffRows(actor, input.merchantOrgId);
    const target = staff.find((s) => s.personId === input.personId);
    if (!target) return { removed: false };
    if (target.pending) {
      const invite = await this.repo.staffInvite(input.merchantOrgId, input.personId);
      if (!invite) return { removed: false };
      await this.uow.run(async (tx) => {
        await this.repo.updateStaffInvite(invite.id, { status: 'cancelled' }, tx);
        await this.events.emit(
          tx,
          { actorId: actor.personId, type: 'merchant.staff_invite_cancelled', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, personId: input.personId, role: invite.role } },
          { name: 'merchant_staff', id: input.merchantOrgId },
        );
      });
      return { removed: true };
    }
    const members = staff.filter((s) => !s.pending);
    if (target.role === 'merchant_owner' && members.filter((s) => s.role === 'merchant_owner').length <= 1) throw new DriverError('staff_last_owner');
    await this.uow.run(async () => {
      for (const kind of STAFF_KINDS) await this.identity.revokeRole(actor, { personId: input.personId, kind, orgId: input.merchantOrgId });
    });
    return { removed: true };
  }
}
