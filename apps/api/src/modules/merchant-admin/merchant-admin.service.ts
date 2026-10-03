import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  DriverError,
  STAFF_INVITE_RULES,
  type Actor,
  type AdminMenu,
  type AdminMenuItem,
  type DealProjectionView,
  type DealView,
  type MenuImportJob,
  type MerchantAdminPort,
  type MerchantCashAccount,
  type MerchantDispute,
  type MerchantInsights,
  type MerchantScope,
  type MerchantStaffRole,
  type MoneyToday,
  type Order,
  type PriceChange,
  type ReorderCategoriesInput,
  type StaffMember,
  type UpsertCategoryInput,
  type UpsertItemInput,
  type WeeklyStatement,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { localDateKey, localPeriod } from '../../shared/local-time.js';
import { CatalogService, itemOnSale, type CatalogItemRecord, type MenuImportJobRecord } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { Accounts, LedgerFacade, LedgerService } from '../ledger/index.js';
import { OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { PROJECTION_BASIS_DAYS, projectDeal, PromotionsService, type DealProposal } from '../promotions/index.js';
import { composeInsights, defaultOutcome, disputeKindOf, staffInsights } from './insights.js';
import { MERCHANT_ADMIN_REPOSITORY, type DisputeResponseRecord, type MerchantAdminRepository } from './merchant-admin.repository.js';
import { composeCashAccount, composeMoneyToday, composeStatement, HANDOVER_LOOKBACK_DAYS } from './money.js';

const DAY_MS = 86_400_000;
const STAFF_KINDS: readonly MerchantStaffRole[] = ['merchant_owner', 'merchant_staff'];
/** Disputes the merchant still sees (domain §9: customers dispute until close, support after). */
export const DISPUTE_LOOKBACK_DAYS = 30;
/** The merchant answers a dispute within this; after it the default outcome stands. */
export const DISPUTE_RESPONSE_HOURS = 48;
/** Stored as the item's `photo_url` until a public CDN path exists; the admin view signs it. */
export const UPLOAD_PHOTO_PREFIX = 'upload:';

/**
 * Merchant app wave 2 (`merchantAdmin.*`). Every call is scoped to one merchant org the caller holds
 * `merchant_owner` / `merchant_staff` at; money, staff and deal changes are owner-only. Menu through
 * the catalog module, deals through promotions, money from the ledger, orders from orders, staff as
 * identity role grants (names from the vault, logged).
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
  ) {}

  // ───────────────────────── access ─────────────────────────

  /** The caller's role at the merchant (owner wins); FORBIDDEN when he has none there. */
  async roleAt(actor: Actor, merchantOrgId: string): Promise<MerchantStaffRole> {
    if (await this.identity.hasRole(actor.personId, 'merchant_owner', merchantOrgId)) return 'merchant_owner';
    if (await this.identity.hasRole(actor.personId, 'merchant_staff', merchantOrgId)) return 'merchant_staff';
    throw new DriverError('forbidden');
  }

  private async owner(actor: Actor, merchantOrgId: string): Promise<void> {
    if ((await this.roleAt(actor, merchantOrgId)) !== 'merchant_owner') throw new DriverError('forbidden');
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
    if (!stored) return null;
    return stored.startsWith(UPLOAD_PHOTO_PREFIX) ? this.blobs.readUrl(stored.slice(UPLOAD_PHOTO_PREFIX.length)) : stored;
  }

  private itemView(i: CatalogItemRecord): AdminMenuItem {
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
        modifiers: g.modifiers.map((m) => ({ id: m.id, nameAr: m.nameAr, nameEn: m.nameEn, priceIqd: m.priceIqd, available: m.available })),
      })),
    };
  }

  private async menuView(merchantOrgId: string): Promise<AdminMenu> {
    const items = await this.catalog.adminMenu(merchantOrgId);
    const sections = new Map<string | null, AdminMenuItem[]>();
    for (const i of items) {
      const list = sections.get(i.categoryAr) ?? [];
      list.push(this.itemView(i));
      sections.set(i.categoryAr, list);
    }
    // Named sections in first-item order, the unnamed one last (as the customer menu shows them).
    const named = [...sections.entries()].filter(([k]) => k !== null);
    const unnamed = sections.get(null);
    return { merchantOrgId, categories: [...named.map(([nameAr, list]) => ({ nameAr, items: list })), ...(unnamed ? [{ nameAr: null, items: unnamed }] : [])] };
  }

  async menuGet(actor: Actor, input: MerchantScope): Promise<AdminMenu> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.menuView(input.merchantOrgId);
  }

  private async itemEvent(actor: Actor, merchantOrgId: string, type: string, payload: Record<string, unknown>, write: (tx: Tx) => Promise<CatalogItemRecord>): Promise<AdminMenuItem> {
    const item = await this.uow.run(async (tx) => {
      const i = await write(tx);
      await this.events.emit(tx, { actorId: actor.personId, type, occurredAt: this.clock.now(), payload: { merchantOrgId, itemId: i.id, ...payload } }, { name: 'org', id: merchantOrgId });
      return i;
    });
    return this.itemView(item);
  }

  async menuSetAvailability(actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.itemEvent(actor, input.merchantOrgId, input.available ? 'item.restocked' : 'item.sold_out', { until: null }, (tx) => this.catalog.setAvailability(input.merchantOrgId, input.itemId, input.available, tx));
  }

  async menuSoldOutToday(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.uow.run(async (tx) => {
      const item = await this.catalog.soldOutToday(input.merchantOrgId, input.itemId, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'item.sold_out', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, until: item.soldOutUntil?.toISOString() ?? null } },
        { name: 'org', id: input.merchantOrgId },
      );
      return this.itemView(item);
    });
  }

  private historyView(rows: Awaited<ReturnType<CatalogService['priceHistory']>>): PriceChange[] {
    return rows.map((r) => ({ oldPriceIqd: r.oldPriceIqd, newPriceIqd: r.newPriceIqd, changedBy: r.changedById, at: r.at }));
  }

  async menuUpdatePrice(actor: Actor, input: { merchantOrgId: string; itemId: string; priceIqd: number }): Promise<{ item: AdminMenuItem; history: PriceChange[] }> {
    await this.roleAt(actor, input.merchantOrgId);
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
    return this.itemEvent(actor, input.merchantOrgId, 'item.photo_replaced', { uploadId: input.uploadId }, (tx) =>
      this.catalog.replacePhoto(input.merchantOrgId, input.itemId, `${UPLOAD_PHOTO_PREFIX}${input.uploadId}`, tx),
    );
  }

  async menuUpsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.uow.run(async (tx) => {
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
          },
        },
        actor.personId,
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: created ? 'item.published' : 'item.updated', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, itemId: item.id, priceIqd: item.priceIqd } },
        { name: 'org', id: input.merchantOrgId },
      );
      return this.itemView(item);
    });
  }

  async menuUpsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    await this.roleAt(actor, input.merchantOrgId);
    await this.uow.run(async (tx) => {
      const touched = await this.catalog.upsertCategory(input.merchantOrgId, input, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'menu.category_updated', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, nameAr: input.nameAr, renameFrom: input.renameFrom ?? null, items: touched } },
        { name: 'org', id: input.merchantOrgId },
      );
    });
    return this.menuView(input.merchantOrgId);
  }

  async menuReorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    await this.roleAt(actor, input.merchantOrgId);
    await this.uow.run(async (tx) => {
      const touched = await this.catalog.reorderCategories(input.merchantOrgId, input.order, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'menu.categories_reordered', occurredAt: this.clock.now(), payload: { merchantOrgId: input.merchantOrgId, order: [...input.order], items: touched } },
        { name: 'org', id: input.merchantOrgId },
      );
    });
    return this.menuView(input.merchantOrgId);
  }

  async menuSetModifiers(actor: Actor, input: { merchantOrgId: string; itemId: string; groups: Array<{ nameAr: string; nameEn?: string | null | undefined; minSelect: number; maxSelect: number; required: boolean; modifiers: Array<{ nameAr: string; nameEn?: string | null | undefined; priceIqd: number; available: boolean }> }> }): Promise<AdminMenuItem> {
    await this.roleAt(actor, input.merchantOrgId);
    return this.itemEvent(actor, input.merchantOrgId, 'item.modifiers_updated', { groups: input.groups.length }, (tx) => this.catalog.setModifiers(input.merchantOrgId, input.itemId, input.groups, tx));
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
    await this.roleAt(actor, input.merchantOrgId);
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
    await this.roleAt(actor, input.merchantOrgId);
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

  dealsReview(actor: Actor, input: { dealId: string; approve: boolean; reason?: string | undefined }): Promise<DealView> {
    return this.promotions.review(input.dealId, input.approve, actor.personId, input.reason);
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
    const [statement, orders] = await Promise.all([
      this.ledger.statement(Accounts.merchantCash(input.merchantOrgId), { from: range.from, to: range.to }),
      this.ordersIn(input.merchantOrgId, { from: new Date(range.from.getTime() - DAY_MS), to: range.to }),
    ]);
    return composeStatement({ merchantOrgId: input.merchantOrgId, from: range.from, to: range.to, statement, orders });
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
    const [orders, menu] = await Promise.all([this.orders.merchantOrders(input.merchantOrgId, { from, to: new Date(to.getTime() + 1) }), this.catalog.adminMenu(input.merchantOrgId)]);
    const insights = composeInsights({ merchantOrgId: input.merchantOrgId, from, to, orders, itemNames: new Map(menu.map((i) => [i.id, i.nameAr])) });
    // Review 2026-10-04 #10: money views are owner-only. Staff keep prep honesty, rejections, ratings,
    // peaks and what sells — ranked by quantity, without what each item brought in.
    return role === 'merchant_owner' ? insights : staffInsights(insights);
  }

  // ───────────────────────── staff ─────────────────────────

  /**
   * The store's people. A member who has not used the app since he was given the role is `pending`
   * and shown without his name: the owner typed the phone, but inviting a number must not tell him
   * whose it is (review 2026-10-04 #6). The name appears once the invitee signs in or refreshes.
   */
  private async staffRows(actor: Actor, merchantOrgId: string): Promise<StaffMember[]> {
    const holders = await this.identity.orgRoleHolders(merchantOrgId, STAFF_KINDS);
    const roleOf = new Map<string, MerchantStaffRole>();
    const grantedAt = new Map<string, Date>();
    for (const h of holders) {
      if (roleOf.get(h.personId) !== 'merchant_owner') roleOf.set(h.personId, h.kind as MerchantStaffRole);
      const prev = grantedAt.get(h.personId);
      if (!prev || h.grantedAt > prev) grantedAt.set(h.personId, h.grantedAt);
    }
    const ids = [...roleOf.keys()];
    const active = ids.length > 0 ? await this.identity.lastActiveAtOf(ids) : {};
    const pendingOf = (personId: string) => {
      if (personId === actor.personId) return false;
      const last = active[personId] ?? null;
      return last === null || last < grantedAt.get(personId)!;
    };
    const cards = ids.length > 0 ? await this.identity.memberCards(ids, actor.personId, 'merchant_staff_view') : {};
    const pendingIds = ids.filter(pendingOf);
    const hints =
      pendingIds.length > 0
        ? await this.identity.invitePhoneHints(pendingIds, actor.personId, 'merchant_staff_invite')
        : {};
    const sends =
      pendingIds.length > 0 ? await this.inviteSends(merchantOrgId) : new Map<string, Date>();
    const cooldownMs = STAFF_INVITE_RULES.resendCooldownMin * 60_000;
    return ids
      .map((personId) => {
        const pending = pendingOf(personId);
        const invitedAt = grantedAt.get(personId)!;
        const resent = sends.get(personId);
        const sentAt = resent && resent > invitedAt ? resent : invitedAt;
        return {
          personId,
          name: pending ? null : (cards[personId]?.name ?? null),
          phoneMasked: cards[personId]?.phoneMasked ?? null,
          role: roleOf.get(personId)!,
          you: personId === actor.personId,
          pending,
          ...(pending
            ? {
                phoneHint: hints[personId] ?? null,
                invitedAt,
                inviteSentAt: sentAt,
                resendAfter: new Date(sentAt.getTime() + cooldownMs),
              }
            : {}),
        };
      })
      .sort((a, b) => (a.role === b.role ? a.personId.localeCompare(b.personId) : a.role === 'merchant_owner' ? -1 : 1));
  }

  /** When each invite last went out again (`merchant.staff_invite_sent` on the store's staff stream). */
  private async inviteSends(merchantOrgId: string): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    for (const e of await this.events.forAggregate('merchant_staff', merchantOrgId)) {
      if (e.type !== 'merchant.staff_invite_sent') continue;
      const personId = (e.payload as { personId?: unknown }).personId;
      if (typeof personId !== 'string') continue;
      const prev = out.get(personId);
      if (!prev || e.occurredAt > prev) out.set(personId, e.occurredAt);
    }
    return out;
  }

  /**
   * The invite link goes out (WhatsApp, outbox `merchant.staff_invite_sent`): the store's name and the
   * app link, to the invited number. No name read: the notifier resolves the number in the vault.
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
    await this.sendInvite(actor, input.merchantOrgId, input.personId, row.role, true);
    return (
      (await this.staffRows(actor, input.merchantOrgId)).find(
        (s) => s.personId === input.personId,
      ) ?? row
    );
  }

  async staffList(actor: Actor, input: MerchantScope): Promise<StaffMember[]> {
    await this.owner(actor, input.merchantOrgId);
    return this.staffRows(actor, input.merchantOrgId);
  }

  /** Owner invites by phone (the Person is found or created pseudonymously; the number stays in the vault). */
  async staffInvite(actor: Actor, input: { merchantOrgId: string; phone: string; role: MerchantStaffRole }): Promise<StaffMember> {
    await this.owner(actor, input.merchantOrgId);
    const personId = await this.identity.ensurePersonByPhone(input.phone, actor.personId, 'merchant_staff_invite');
    const row = await this.setRoleOf(actor, input.merchantOrgId, personId, input.role);
    if (row.pending) await this.sendInvite(actor, input.merchantOrgId, personId, row.role, false);
    return row;
  }

  async staffSetRole(actor: Actor, input: { merchantOrgId: string; personId: string; role: MerchantStaffRole }): Promise<StaffMember> {
    await this.owner(actor, input.merchantOrgId);
    if (!(await this.staffRows(actor, input.merchantOrgId)).some((s) => s.personId === input.personId)) throw new DriverError('not_found');
    return this.setRoleOf(actor, input.merchantOrgId, input.personId, input.role);
  }

  private async setRoleOf(actor: Actor, merchantOrgId: string, personId: string, role: MerchantStaffRole): Promise<StaffMember> {
    const staff = await this.staffRows(actor, merchantOrgId);
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

  async staffRemove(actor: Actor, input: { merchantOrgId: string; personId: string }): Promise<{ removed: boolean }> {
    await this.owner(actor, input.merchantOrgId);
    const staff = await this.staffRows(actor, input.merchantOrgId);
    const target = staff.find((s) => s.personId === input.personId);
    if (!target) return { removed: false };
    if (target.role === 'merchant_owner' && staff.filter((s) => s.role === 'merchant_owner').length <= 1) throw new DriverError('staff_last_owner');
    await this.uow.run(async () => {
      for (const kind of STAFF_KINDS) await this.identity.revokeRole(actor, { personId: input.personId, kind, orgId: input.merchantOrgId });
    });
    return { removed: true };
  }
}
