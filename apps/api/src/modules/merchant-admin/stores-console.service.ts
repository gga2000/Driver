import { Inject, Injectable } from '@nestjs/common';
import { DriverError, setupProgress, type Actor, type AdminMenu, type AdminMenuItem, type MerchantScope, type ReorderCategoriesInput, type UpsertCategoryInput, type UpsertItemInput } from '@driver/contracts';
import type { AddItemsInput, LibraryPhotoInput, StoreHistoryEntry, StoreHistoryInput, StoreRow, StoreSetupState, StoresInput, StoresOpsPort } from '@driver/contracts/store-setup';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, itemPhotoUrl } from '../catalog/index.js';
import { AuditLogService } from '../controls/index.js';
import { setupFacts } from '../merchant/index.js';
import { closedNow, OrgsService, type Org } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { MerchantAdminService } from './merchant-admin.service.js';

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
} as const;

const STORE_TYPES = new Set(['restaurant', 'grocer']);

/**
 * `ops.stores.*` — Console › المطاعم (Ali, 2026-10-21): Driver's team sets a store up and keeps its menu
 * for the owner. Every write goes through the owner's own menu rules (`MerchantAdminService`, as
 * `'console'`) and commits with one audit row under the staff member's name; prices of a shop already
 * open to customers stay the owner's (`store_price_owner_only`). The router gates the roles.
 */
@Injectable()
export class StoresConsoleService implements StoresOpsPort {
  constructor(
    private readonly menus: MerchantAdminService,
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
    return this.menus.menuGet(actor, input, 'console');
  }

  /** One write and its audit row in one unit of work (the menu service's own run joins it). */
  private async audited<T>(actor: Actor, merchantOrgId: string, action: string, summary: (org: Org, out: T) => string, detail: (out: T) => Record<string, unknown>, write: () => Promise<T>): Promise<T> {
    const org = await this.store(merchantOrgId);
    return this.uow.run(async (tx) => {
      const out = await write();
      await this.audits.record({ cityId: org.cityId, actorId: actor.personId, action, subjectKind: STORE_AUDIT_SUBJECT, subjectId: org.id, summaryAr: summary(org, out), detail: detail(out) }, tx);
      return out;
    });
  }

  upsertItem(actor: Actor, input: UpsertItemInput): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.itemSaved,
      (org, item) => (input.itemId ? `عدّل «${item.nameAr}» بـ${org.name}` : `زاد «${item.nameAr}» لـ${org.name}`),
      (item) => ({ itemId: item.id, created: !input.itemId, priceIqd: item.priceIqd }),
      () => this.menus.menuUpsertItem(actor, input, 'console'),
    );
  }

  addItems(actor: Actor, input: AddItemsInput): Promise<AdminMenu> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.itemsAdded,
      (org) => `زاد ${input.items.length} أكلات لـ${org.name}${input.categoryAr ? ` بقسم «${input.categoryAr}»` : ''}`,
      () => ({ count: input.items.length, categoryAr: input.categoryAr ?? null }),
      () => this.menus.consoleAddItems(actor, input),
    );
  }

  upsertCategory(actor: Actor, input: UpsertCategoryInput): Promise<AdminMenu> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.sectionSaved,
      (org) => (input.renameFrom ? `غيّر اسم قسم «${input.renameFrom}» لـ«${input.nameAr}» بـ${org.name}` : `رتّب قسم «${input.nameAr}» بـ${org.name}`),
      () => ({ nameAr: input.nameAr, renameFrom: input.renameFrom ?? null }),
      () => this.menus.menuUpsertCategory(actor, input, 'console'),
    );
  }

  reorderCategories(actor: Actor, input: ReorderCategoriesInput): Promise<AdminMenu> {
    return this.audited(actor, input.merchantOrgId, STORE_AUDIT.sectionsReordered, (org) => `رتّب أقسام المنيو بـ${org.name}`, () => ({ order: [...input.order] }), () => this.menus.menuReorderCategories(actor, input, 'console'));
  }

  setModifiers(actor: Actor, input: Parameters<MerchantAdminService['menuSetModifiers']>[1]): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.optionsSaved,
      (org, item) => `عدّل أحجام وإضافات «${item.nameAr}» بـ${org.name}`,
      (item) => ({ itemId: item.id, groups: input.groups.length }),
      () => this.menus.menuSetModifiers(actor, input, 'console'),
    );
  }

  setAvailability(actor: Actor, input: { merchantOrgId: string; itemId: string; available: boolean }): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.availability,
      (org, item) => (input.available ? `رجّع «${item.nameAr}» متوفّر بـ${org.name}` : `سوّى «${item.nameAr}» مو متوفّر بـ${org.name}`),
      (item) => ({ itemId: item.id, available: input.available }),
      () => this.menus.menuSetAvailability(actor, input, 'console'),
    );
  }

  soldOutToday(actor: Actor, input: { merchantOrgId: string; itemId: string }): Promise<AdminMenuItem> {
    return this.audited(actor, input.merchantOrgId, STORE_AUDIT.soldOutToday, (org, item) => `سوّى «${item.nameAr}» خلص اليوم بـ${org.name}`, (item) => ({ itemId: item.id }), () => this.menus.menuSoldOutToday(actor, input, 'console'));
  }

  libraryPhoto(actor: Actor, input: LibraryPhotoInput): Promise<AdminMenuItem> {
    return this.audited(
      actor,
      input.merchantOrgId,
      STORE_AUDIT.libraryPhoto,
      (org, item) => `حط صورة من مكتبتنا لـ«${item.nameAr}» بـ${org.name}`,
      (item) => ({ itemId: item.id, photo: input.photo }),
      () => this.menus.consoleLibraryPhoto(actor, input),
    );
  }
}
