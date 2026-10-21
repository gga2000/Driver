import { Inject, Injectable } from '@nestjs/common';
import { DriverError, setupProgress, type Actor, type AdminMenu, type AdminMenuItem, type MerchantOrgInput, type MerchantScope, type MerchantSetupView, type ReorderCategoriesInput, type StoreHoursView, type StoreStatusView, type UpsertCategoryInput, type UpsertItemInput } from '@driver/contracts';
import type {
  AddItemsInput,
  LibraryPhotoInput,
  OpsDishPhotoInput,
  OpsSetBusyInput,
  OpsSetHoursInput,
  OpsSetOpenInput,
  OpsSetupKindsInput,
  OpsShopPhotoInput,
  OpsStoreInput,
  StoreHistoryEntry,
  StoreHistoryInput,
  StoreRow,
  StoreSetupState,
  StoresInput,
  StoresOpsPort,
} from '@driver/contracts/store-setup';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, itemPhotoUrl } from '../catalog/index.js';
import { AuditLogService } from '../controls/index.js';
import { MerchantService, MerchantSetupService, setupFacts } from '../merchant/index.js';
import { closedNow, OrgsService, type Org } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { MerchantAdminService, modifierPricesChanged } from './merchant-admin.service.js';

const iqd = (n: number) => n.toLocaleString('en-US');

/** Every Console change to a store is one audit row on this subject (pickup spots and kitchen moves share it). */
export const STORE_AUDIT_SUBJECT = 'store';
/** The audit actions of `ops.stores.*` (the history shows these next to the pickup-spot ones). */
export const STORE_AUDIT = {
  itemSaved: 'store.item_saved',
  itemsAdded: 'store.items_added',
  sectionSaved: 'store.section_saved',
  sectionsReordered: 'store.sections_reordered',
  optionsSaved: 'store.options_saved',
  availability: 'store.availability_set',
  soldOutToday: 'store.sold_out_today',
  libraryPhoto: 'store.library_photo',
  hoursSet: 'store.hours_set',
  openSet: 'store.open_set',
  busySet: 'store.busy_set',
  kindsSet: 'store.kinds_set',
  shopPhoto: 'store.shop_photo',
  dishPhoto: 'store.dish_photo',
  wentLive: 'store.went_live',
} as const;

const STORE_TYPES = new Set(['restaurant', 'grocer']);

/**
 * `ops.stores.*` — Console › المطاعم (Ali, 2026-10-21): Driver's team sets a store up and keeps its menu
 * for the owner. Every write goes through the owners' modules' separate `ops*` methods (each checks
 * field ops or admin itself, then runs the owner's very rules) and commits with one audit row under the
 * staff member's name, with what it was before and after and the team's «ليش؟». Prices change at once,
 * on a live shop too, and the owner is told (Ali, 2026-10-21: "change now, tell the owner"); his practice
 * order, sound check and payout stay his. The router gates the roles too.
 */
@Injectable()
export class StoresConsoleService implements StoresOpsPort {
  constructor(
    private readonly menus: MerchantAdminService,
    private readonly shops: MerchantService,
    private readonly setups: MerchantSetupService,
    private readonly orgs: OrgsService,
    private readonly catalog: CatalogService,
    private readonly audits: AuditLogService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async store(merchantOrgId: string): Promise<Org> {
    const org = await this.orgs.get(merchantOrgId);
    if (!STORE_TYPES.has(org.type)) throw new DriverError('org_not_found');
    return org;
  }

  private stateOf(org: Org): StoreSetupState {
    const setup = org.merchant?.setup ?? null;
    if (setup && !setup.liveAt) return 'setup';
    return closedNow(org.merchant?.closed, this.clock.now()) ? 'closed' : 'live';
  }

  /** The city's restaurants and grocers: setup steps, menu gaps and the last Console edit; still in setup first. */
  async list(_actor: Actor, input: StoresInput): Promise<StoreRow[]> {
    const orgs = (await this.orgs.inCity(input.cityId)).filter((o) => STORE_TYPES.has(o.type));
    const fronts = new Map((await this.catalog.storefronts(input.cityId)).map((f) => [f.orgId, f]));
    const rows = await Promise.all(
      orgs.map(async (org): Promise<StoreRow> => {
        const s = org.merchant;
        const front = fronts.get(org.id) ?? null;
        const [menu, last] = await Promise.all([this.catalog.menu(org.id), this.audits.list({ subjectKind: STORE_AUDIT_SUBJECT, subjectId: org.id, limit: 1 })]);
        const dishesNoPhoto = menu.filter((i) => i.available && !i.photoUrl).length;
        // A shop from before «جهّز محلك» has no steps to do: it shows them all done.
        const progress = s?.setup
          ? setupProgress(
              setupFacts({
                setup: s.setup,
                dishes: menu.map((i) => ({ photoUrl: i.photoUrl, photoLibrary: i.photoLibrary ?? null, available: i.available })),
                draftRows: 0,
                hoursSet: (s.openingHours?.length ?? 0) > 0 || (front?.hours.length ?? 0) > 0,
                pickupSet: !!s.pickupSpot,
              }),
            )
          : null;
        const total = progress?.total ?? 7;
        return {
          merchantOrgId: org.id,
          name: org.name,
          type: org.type as StoreRow['type'],
          photoUrl: itemPhotoUrl(this.blobs, front?.photoUrl ?? s?.setup?.shopPhotoRef ?? null),
          state: this.stateOf(org),
          steps: { done: progress?.done ?? total, total, next: progress?.next ?? null },
          dishes: menu.length,
          dishesNoPhoto,
          lastEdit: last[0] ? { at: last[0].at, actorName: last[0].actorName } : null,
        };
      }),
    );
    const rank: Record<StoreSetupState, number> = { setup: 0, closed: 1, live: 2 };
    return rows.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, 'ar') || a.merchantOrgId.localeCompare(b.merchantOrgId));
  }

  /** «السجل»: the store's Console changes, newest first, with the staff member's name. */
  async history(_actor: Actor, input: StoreHistoryInput): Promise<StoreHistoryEntry[]> {
    const org = await this.store(input.merchantOrgId);
    const rows = await this.audits.list({ subjectKind: STORE_AUDIT_SUBJECT, subjectId: org.id, limit: input.limit ?? 50 });
    return rows.map((r) => ({ id: r.id, at: r.at, actorId: r.actorId, actorName: r.actorName, action: r.action, summaryAr: r.summary_ar }));
  }

  async menu(actor: Actor, input: MerchantScope): Promise<AdminMenu> {
    await this.store(input.merchantOrgId);
    return this.menus.opsMenuGet(actor, input);
  }

  /** The dish as it was, for the audit row's «قبل» (undefined when it is not this store's). */
  private async itemBefore(merchantOrgId: string, itemId: string): Promise<{ nameAr: string; priceIqd: number; modifierGroups: AdminMenuItem['modifierGroups'] } | undefined> {
    const item = await this.catalog.adminItem(merchantOrgId, itemId).catch((err: unknown) => {
      // A dish of another store: the write itself refuses it.
      if (err instanceof DriverError) return undefined;
      throw err;
    });
    return item ? { nameAr: item.nameAr, priceIqd: item.priceIqd, modifierGroups: item.modifierGroups } : undefined;
  }

  /**
   * One write and its audit row in one unit of work (the menu service's own run joins it). `before`
   * reads what the change replaces, kept next to the result's `detail`; `why` is the team's «ليش؟».
   */
  private async audited<T, B = undefined>(
    actor: Actor,
    merchantOrgId: string,
    action: string,
    summary: (org: Org, out: T) => string,
    detail: (out: T) => Record<string, unknown>,
    write: () => Promise<T>,
    opts: { why?: string | undefined; before?: (org: Org) => Promise<B> } = {},
  ): Promise<T> {
    const org = await this.store(merchantOrgId);
    const before = opts.before ? await opts.before(org) : undefined;
    return this.uow.run(async (tx) => {
      const out = await write();
      const extra = { ...(opts.before ? { before } : {}), ...(opts.why ? { why: opts.why } : {}) };
      await this.audits.record({ cityId: org.cityId, actorId: actor.personId, action, subjectKind: STORE_AUDIT_SUBJECT, subjectId: org.id, summaryAr: summary(org, out), detail: { ...detail(out), ...extra } }, tx);
      return out;
    });
  }

  async upsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    const before = input.itemId ? await this.itemBefore(input.merchantOrgId, input.itemId) : undefined;
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.itemSaved,
      (org, item) => {
        if (!input.itemId) return `زاد «${item.nameAr}» لـ${org.name}`;
        const was = before?.priceIqd;
        return was !== undefined && was !== item.priceIqd ? `غيّر سعر «${item.nameAr}» من ${iqd(was)} لـ${iqd(item.priceIqd)} دينار بـ${org.name}` : `عدّل «${item.nameAr}» بـ${org.name}`;
      },
      (item) => ({ itemId: item.id, created: !input.itemId, after: { nameAr: item.nameAr, priceIqd: item.priceIqd }, priceChanged: !!input.itemId && before?.priceIqd !== item.priceIqd }),
      () => this.menus.opsUpsertItem(actor, input),
      { before: async () => before },
    );
  }

  addItems(actor: Actor, input: AddItemsInput): Promise<AdminMenu> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.itemsAdded,
      (org) => `زاد ${input.items.length} أكلات لـ${org.name}${input.categoryAr ? ` بقسم «${input.categoryAr}»` : ''}`,
      () => ({ count: input.items.length, categoryAr: input.categoryAr ?? null }),
      () => this.menus.opsAddItems(actor, input),
    );
  }

  upsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.sectionSaved,
      (org) => (input.renameFrom ? `غيّر اسم قسم «${input.renameFrom}» لـ«${input.nameAr}» بـ${org.name}` : `رتّب قسم «${input.nameAr}» بـ${org.name}`),
      () => ({ nameAr: input.nameAr, renameFrom: input.renameFrom ?? null }),
      () => this.menus.opsUpsertCategory(actor, input),
    );
  }

  reorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    return this.audited(actor, input.merchantOrgId, STORE_AUDIT.sectionsReordered, (org) => `رتّب أقسام المنيو بـ${org.name}`, () => ({ order: [...input.order] }), () => this.menus.opsReorderCategories(actor, input));
  }

  async setModifiers(actor: Actor, input: Parameters<MerchantAdminService['menuSetModifiers']>[1]): Promise<AdminMenuItem> {
    const before = await this.itemBefore(input.merchantOrgId, input.itemId);
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.optionsSaved,
      (org, item) => `عدّل أحجام وإضافات «${item.nameAr}» بـ${org.name}`,
      (item) => ({ itemId: item.id, groups: input.groups.length, priceChanged: modifierPricesChanged(before?.modifierGroups ?? [], input.groups) }),
      () => this.menus.opsSetModifiers(actor, input),
      { before: async () => (before ? { modifierGroups: before.modifierGroups } : null) },
    );
  }

  setAvailability(actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.availability,
      (org, item) => (input.available ? `رجّع «${item.nameAr}» متوفّر بـ${org.name}` : `سوّى «${item.nameAr}» مو متوفّر بـ${org.name}`),
      (item) => ({ itemId: item.id, available: input.available }),
      () => this.menus.opsSetAvailability(actor, input),
    );
  }

  soldOutToday(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    return this.audited(actor, input.merchantOrgId, STORE_AUDIT.soldOutToday, (org, item) => `سوّى «${item.nameAr}» خلص اليوم بـ${org.name}`, (item) => ({ itemId: item.id }), () => this.menus.opsSoldOutToday(actor, input));
  }

  libraryPhoto(actor: Actor, input: LibraryPhotoInput): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.libraryPhoto,
      (org, item) => `حط صورة من مكتبتنا لـ«${item.nameAr}» بـ${org.name}`,
      (item) => ({ itemId: item.id, photo: input.photo }),
      () => this.menus.opsLibraryPhoto(actor, input),
    );
  }

  // ───────────────────────── the shop itself ─────────────────────────

  setup(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView> {
    return this.setups.opsGet(actor, input);
  }

  status(actor: Actor, input: MerchantOrgInput): Promise<StoreStatusView> {
    return this.shops.opsStoreStatus(actor, input);
  }

  hours(actor: Actor, input: MerchantOrgInput): Promise<StoreHoursView> {
    return this.shops.opsHours(actor, input);
  }

  setHours(actor: Actor, input: OpsSetHoursInput): Promise<StoreHoursView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.hoursSet,
      (org) => `رتّب أوقات دوام ${org.name}`,
      (v) => ({ after: { days: v.days, holidays: v.holidays } }),
      () => this.shops.opsSetHours(actor, input),
      { why: input.why, before: async (org) => ({ openingHours: org.merchant?.openingHours ?? null, holidays: org.merchant?.holidays ?? [] }) },
    );
  }

  setOpen(actor: Actor, input: OpsSetOpenInput): Promise<StoreStatusView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.openSet,
      (org) => (input.open ? `فتح ${org.name}` : input.pauseMinutes ? `وقّف ${org.name} ${input.pauseMinutes} دقيقة` : `سدّ ${org.name}`),
      () => ({ after: { open: input.open, reason: input.reason ?? null, note: input.note ?? null, pauseMinutes: input.pauseMinutes ?? null } }),
      () => this.shops.opsSetOpen(actor, input),
      { why: input.why, before: async (org) => ({ closed: org.merchant?.closed ?? null }) },
    );
  }

  setBusy(actor: Actor, input: OpsSetBusyInput): Promise<StoreStatusView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.busySet,
      (org) => (input.on ? `سوّى ${org.name} مزدحم` : `شال الزحمة عن ${org.name}`),
      () => ({ after: { on: input.on, extraMinutes: input.on ? (input.extraMinutes ?? 10) : null } }),
      () => this.shops.opsSetBusy(actor, input),
      { why: input.why, before: async (org) => ({ busyUntil: org.merchant?.busyUntil ?? null, busyExtraMin: org.merchant?.busyExtraMin ?? null }) },
    );
  }

  confirmKinds(actor: Actor, input: OpsSetupKindsInput): Promise<MerchantSetupView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.kindsSet,
      (org) => `ثبّت شنو يبيع ${org.name}`,
      () => ({ after: { kinds: [...input.kinds] } }),
      () => this.setups.opsConfirmKinds(actor, input),
      { why: input.why, before: async (org) => ({ kinds: org.merchant?.setup?.kinds ?? null }) },
    );
  }

  shopPhoto(actor: Actor, input: OpsShopPhotoInput): Promise<MerchantSetupView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.shopPhoto,
      (org) => `حط صورة محل ${org.name}`,
      () => ({ after: { uploadId: input.uploadId } }),
      () => this.setups.opsShopPhoto(actor, input),
      { why: input.why, before: async (org) => ({ shopPhotoRef: org.merchant?.setup?.shopPhotoRef ?? null }) },
    );
  }

  dishPhoto(actor: Actor, input: OpsDishPhotoInput): Promise<MerchantSetupView> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.dishPhoto,
      (org) => `حط صورة أكلة بـ${org.name}`,
      () => ({ after: { itemId: input.itemId, uploadId: input.uploadId, library: input.librarySlug ?? null } }),
      () => this.setups.opsDishPhoto(actor, input),
      { why: input.why, before: async (org) => ({ photoUrl: (await this.catalog.menu(org.id)).find((i) => i.id === input.itemId)?.photoUrl ?? null }) },
    );
  }

  goLive(actor: Actor, input: OpsStoreInput): Promise<MerchantSetupView> {
    return this.audited(actor, input.merchantOrgId, STORE_AUDIT.wentLive, (org) => `فتح ${org.name} للزباين`, (v) => ({ after: { live: v.live } }), () => this.setups.opsGoLive(actor, input), { why: input.why });
  }
}
