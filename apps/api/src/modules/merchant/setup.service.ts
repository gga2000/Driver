import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  prepDefaultsFor,
  setupProgress,
  tagsForDoors,
  type Actor,
  type FoodDoor,
  type MenuCards,
  type MerchantOrgInput,
  type MerchantSetupPort,
  type MerchantSetupView,
  type RoleKind,
  type SetupAnswerInput,
  type SetupCheck,
  type SetupKindsInput,
  type StoreStatusView,
  type WeeklyWindow,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UPLOAD_PHOTO_PREFIX, itemPhotoUrl, type CatalogService, type CatalogItemRecord, type ImportedItemRecord, type MenuImportJobRecord, type NewStorefront, type StorefrontRecord } from '../catalog/index.js';
import { newSetupState, type MerchantSettings, type MerchantSetupState, type Org } from '../orgs/index.js';
import { MERCHANT_EVENTS, MERCHANT_ORDERS, MERCHANT_PEOPLE, MERCHANT_PHOTOS, MERCHANT_STORES, type MerchantEventsPort, type MerchantSetupLinePort, type MerchantOrdersPort, type MerchantPeoplePort, type MerchantPhotosPort, type MerchantStoresPort } from './merchant.service.js';
import { cardsOf, cardsState, cuisineLine, firstOrderAfter, pendingCards, progressOf, suggestedDoors } from './setup.js';

/** What «جهّز محلك» needs from the catalog (bound to `CatalogService`; plain fakes in tests). */
export interface SetupCatalogPort {
  /** Every dish of the store's menu, on sale or not. */
  menu(orgId: string): Promise<CatalogItemRecord[]>;
  storefront(orgId: string): Promise<StorefrontRecord | null>;
  saveStorefront(input: NewStorefront): Promise<StorefrontRecord>;
  createImportJob(orgId: string, uploadIds: readonly string[], actorId: string): Promise<MenuImportJobRecord>;
  /** `import_job_not_found` for another store's job. */
  importJob(orgId: string, jobId: string): Promise<MenuImportJobRecord>;
  saveImportDraft(orgId: string, jobId: string, items: readonly ImportedItemRecord[]): Promise<MenuImportJobRecord>;
  closeImport(orgId: string, jobId: string, appliedCount: number): Promise<MenuImportJobRecord>;
  /** A new dish (with its first price-history row). */
  addDish(orgId: string, dish: { nameAr: string; priceIqd: number; categoryAr: string | null; description: string | null; prepTimeMin?: number; sortOrder: number }, actorId: string): Promise<CatalogItemRecord>;
  /** `library`: the library slug of a Driver photo («صورة توضيحية»); null = his own. */
  setPhoto(orgId: string, itemId: string, photoUrl: string, library: string | null): Promise<CatalogItemRecord>;
}

export const MERCHANT_SETUP_CATALOG = Symbol('MERCHANT_SETUP_CATALOG');

/** The port over the catalog's own calls (the module binds it; tests use it over an in-memory catalog). */
export function setupCatalogOf(catalog: CatalogService): SetupCatalogPort {
  return {
    menu: (orgId) => catalog.adminMenu(orgId),
    storefront: (orgId) => catalog.storefront(orgId),
    saveStorefront: (input) => catalog.saveStorefront(input),
    createImportJob: (orgId, uploadIds, actorId) => catalog.createImportJob(orgId, uploadIds, actorId),
    importJob: (orgId, jobId) => catalog.importJob(orgId, jobId),
    saveImportDraft: (orgId, jobId, items) => catalog.saveImportDraft(orgId, jobId, items),
    closeImport: (orgId, jobId, count) => catalog.closeImport(orgId, jobId, count),
    addDish: async (orgId, dish, actorId) =>
      (
        await catalog.upsertItem(
          orgId,
          { patch: { nameAr: dish.nameAr, priceIqd: dish.priceIqd, categoryAr: dish.categoryAr, description: dish.description, sortOrder: dish.sortOrder, ...(dish.prepTimeMin !== undefined ? { prepTimeMin: dish.prepTimeMin } : {}) } },
          actorId,
        )
      ).item,
    setPhoto: (orgId, itemId, photoUrl, library) => catalog.replacePhoto(orgId, itemId, photoUrl, undefined, library),
  };
}

const OWNER: RoleKind = 'merchant_owner';

/**
 * «جهّز محلك» (`merchant.setup.*`): a new shop's first day. Owner only — staff never see setup. The
 * state lives on the org (`orgs.setup`); dishes, photos and the storefront go through the catalog the
 * same way the menu screens' edits do. Nothing here touches money: going live opens the shop like the
 * open switch, once every step is done.
 *
 * Shops from before setup have no state: `get` says `active: false` and nothing else changes for them.
 */
@Injectable()
export class MerchantSetupService implements MerchantSetupPort, MerchantSetupLinePort {
  constructor(
    @Inject(MERCHANT_STORES) private readonly stores: MerchantStoresPort,
    @Inject(MERCHANT_PEOPLE) private readonly people: MerchantPeoplePort,
    @Inject(MERCHANT_SETUP_CATALOG) private readonly catalog: SetupCatalogPort,
    @Inject(MERCHANT_ORDERS) private readonly orders: MerchantOrdersPort,
    @Inject(MERCHANT_EVENTS) private readonly events: MerchantEventsPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(MERCHANT_PHOTOS) private readonly photos: MerchantPhotosPort | null = null,
  ) {}

  /**
   * Starts setup for a shop field ops just signed up (or the demo's new shop): from now until the
   * owner raises the shutter it takes no orders. Idempotent; a shop already in setup keeps its state.
   */
  async start(merchantOrgId: string): Promise<void> {
    const s = await this.stores.merchantSettings(merchantOrgId);
    if (s.setup) return;
    const now = this.clock.now();
    const closed = s.closed ? {} : { closed: { reason: 'other', note: null, at: now, until: null } };
    await this.stores.setMerchantSettings(merchantOrgId, { setup: { ...newSetupState(now), closedBySetup: !s.closed }, ...closed });
    await this.events.record('merchant.setup_started', 'system:setup', merchantOrgId, { at: now.toISOString() });
  }

  async get(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView> {
    const org = await this.ownerStore(actor, input.merchantOrgId);
    await this.adopt(org);
    return this.view(org);
  }

  /** Shops already known to be from before setup (they have a storefront): not read again. */
  private readonly older = new Set<string>();

  /**
   * A shop field ops signed up (ops onboarding: an org with no storefront, customers can't see it yet)
   * starts «جهّز محلك» the first time its status or setup is read, so the ops module stays as it is.
   * A shop with a storefront is from before setup and never changes.
   */
  async adopt(org: Org): Promise<void> {
    if (this.older.has(org.id)) return;
    if (org.type !== 'restaurant' && org.type !== 'grocer') return;
    const s = await this.stores.merchantSettings(org.id);
    if (s.setup) return;
    if (await this.catalog.storefront(org.id)) {
      this.older.add(org.id);
      return;
    }
    await this.start(org.id);
  }

  async confirmKinds(actor: Actor, input: SetupKindsInput): Promise<MerchantSetupView> {
    const { org, s, setup } = await this.inSetup(actor, input.merchantOrgId);
    const kinds = [...input.kinds] as FoodDoor[];
    const front = await this.catalog.storefront(org.id);
    if (front) await this.catalog.saveStorefront({ ...front, tags: tagsForDoors(kinds, front.tags) });
    // Cafés and juice bars start quicker where the app already has the knob (the store's usual prep time),
    // and only when nobody set one yet.
    const prep = prepDefaultsFor(kinds);
    await this.stores.setMerchantSettings(org.id, {
      setup: { ...setup, kinds, kindsAt: this.clock.now() },
      ...(prep && s.defaultPrepMin === null ? { defaultPrepMin: prep.storeMinutes } : {}),
    });
    await this.events.record('merchant.setup_kinds', actor.personId, org.id, { kinds });
    return this.view(org);
  }

  async check(actor: Actor, input: MerchantOrgInput & { check: SetupCheck }): Promise<MerchantSetupView> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    const field = ({ sound: 'soundAt', screen: 'screenAt', practice: 'practiceAt', printer_later: 'printerLaterAt' } as const)[input.check];
    if (!setup[field]) {
      await this.stores.setMerchantSettings(org.id, { setup: { ...setup, [field]: this.clock.now() } });
      await this.events.record('merchant.setup_check', actor.personId, org.id, { check: input.check });
    }
    return this.view(org);
  }

  async seePayout(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    if (!setup.payoutAt) {
      await this.stores.setMerchantSettings(org.id, { setup: { ...setup, payoutAt: this.clock.now() } });
      await this.events.record('merchant.setup_payout_seen', actor.personId, org.id, {});
    }
    return this.view(org);
  }

  async shopPhoto(actor: Actor, input: MerchantOrgInput & { uploadId: string }): Promise<MerchantSetupView> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    await this.assertUpload(input.uploadId, actor.personId);
    const ref = `${UPLOAD_PHOTO_PREFIX}${input.uploadId}`;
    const front = await this.catalog.storefront(org.id);
    if (front) await this.catalog.saveStorefront({ ...front, photoUrl: ref });
    await this.stores.setMerchantSettings(org.id, { setup: { ...setup, shopPhotoRef: ref } });
    return this.view(org);
  }

  async dishPhoto(actor: Actor, input: MerchantOrgInput & { itemId: string; uploadId: string; librarySlug?: string | null | undefined }): Promise<MerchantSetupView> {
    const { org } = await this.inSetup(actor, input.merchantOrgId);
    await this.assertUpload(input.uploadId, actor.personId);
    await this.catalog.setPhoto(org.id, input.itemId, `${UPLOAD_PHOTO_PREFIX}${input.uploadId}`, input.librarySlug ?? null);
    await this.events.record('item.photo_replaced', actor.personId, org.id, { itemId: input.itemId, library: input.librarySlug ?? null });
    return this.view(org);
  }

  // ───────────────────────── the menu as yes/fix cards ─────────────────────────

  async menuCards(actor: Actor, input: MerchantOrgInput): Promise<MenuCards> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    return this.cards(org.id, setup);
  }

  /** His menu photos: a draft the reader (or Driver's team) turns into cards. */
  async startMenu(actor: Actor, input: MerchantOrgInput & { uploadIds: string[] }): Promise<MenuCards> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    for (const id of input.uploadIds) await this.assertUpload(id, actor.personId);
    const job = await this.catalog.createImportJob(org.id, input.uploadIds, actor.personId);
    const next = { ...setup, menuJobId: job.id, cards: {} };
    await this.stores.setMerchantSettings(org.id, { setup: next });
    await this.events.record('menu.import_started', actor.personId, org.id, { jobId: job.id, photos: input.uploadIds.length, setup: true });
    return this.cards(org.id, next);
  }

  /** Rows he typed himself: kept on the draft as cards (nothing reaches customers until «صح»). */
  async menuDraft(actor: Actor, input: MerchantOrgInput & { jobId: string; items: ImportedItemRecord[] }): Promise<MenuCards> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    if (setup.menuJobId !== input.jobId) throw new DriverError('import_job_not_found');
    await this.catalog.saveImportDraft(org.id, input.jobId, input.items);
    const next = { ...setup, cards: {} };
    await this.stores.setMerchantSettings(org.id, { setup: next });
    return this.cards(org.id, next);
  }

  /**
   * One card: «صح» puts the dish on the menu with his fixes and the photo he kept (a library photo
   * marked so customers see «صورة توضيحية»); «مو هذا» leaves it out. Answering a card twice changes
   * nothing. With the last card the draft closes.
   */
  async answer(actor: Actor, input: SetupAnswerInput): Promise<MenuCards> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    if (setup.menuJobId !== input.jobId) throw new DriverError('import_job_not_found');
    const job = await this.catalog.importJob(org.id, input.jobId);
    const row = job.items[input.index];
    if (job.state !== 'draft' || !row) throw new DriverError('import_state_conflict');
    if (setup.cards[String(input.index)]) return this.cards(org.id, setup);
    if (input.uploadId) await this.assertUpload(input.uploadId, actor.personId);
    let itemId: string | null = null;
    if (input.answer === 'ok') {
      const menu = await this.catalog.menu(org.id);
      const prep = prepDefaultsFor(setup.kinds ?? []);
      const dish = await this.catalog.addDish(
        org.id,
        {
          nameAr: input.nameAr ?? row.nameAr,
          priceIqd: input.priceIqd ?? row.priceIqd,
          categoryAr: input.categoryAr !== undefined ? input.categoryAr : (row.categoryAr ?? null),
          description: row.description ?? null,
          ...(prep ? { prepTimeMin: prep.dishMinutes } : {}),
          sortOrder: (menu.reduce((m, i) => Math.max(m, i.sortOrder), 0) || 0) + 10,
        },
        actor.personId,
      );
      if (input.uploadId) await this.catalog.setPhoto(org.id, dish.id, `${UPLOAD_PHOTO_PREFIX}${input.uploadId}`, input.librarySlug ?? null);
      itemId = dish.id;
      await this.events.record('item.published', actor.personId, org.id, { itemId, priceIqd: input.priceIqd ?? row.priceIqd, setup: true });
    }
    // Re-read: another tap may have landed while the dish was being written.
    const fresh = (await this.stores.merchantSettings(org.id)).setup ?? setup;
    const next: MerchantSetupState = { ...fresh, cards: { ...fresh.cards, [String(input.index)]: { answer: input.answer, itemId } } };
    await this.stores.setMerchantSettings(org.id, { setup: next });
    if (pendingCards(next, job.items.length) === 0) {
      const kept = Object.values(next.cards).filter((c) => c.answer === 'ok').length;
      await this.catalog.closeImport(org.id, job.id, kept);
      await this.events.record('menu.imported', actor.personId, org.id, { jobId: job.id, items: kept, setup: true });
    }
    return this.cards(org.id, next);
  }

  // ───────────────────────── the shutter and the first order ─────────────────────────

  /**
   * «ارفع الكبنك»: every step done, the shop opens for customers — its storefront is made (or updated)
   * from what he confirmed, and the close setup put on it at the start comes off. Idempotent.
   */
  async goLive(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView> {
    const { org, s, setup } = await this.inSetup(actor, input.merchantOrgId);
    if (setup.liveAt) return this.view(org);
    const facts = await this.inputs(org, s, setup);
    const progress = progressOf(facts);
    if (progress.left > 0) throw new DriverError('setup_not_ready');
    const now = this.clock.now();
    const kinds = setup.kinds ?? ['meal'];
    const front = await this.catalog.storefront(org.id);
    const hours: WeeklyWindow[] = s.openingHours ?? front?.hours ?? [];
    if (front) {
      await this.catalog.saveStorefront({ ...front, tags: tagsForDoors(kinds, front.tags), hours, ...(setup.shopPhotoRef && !front.photoUrl ? { photoUrl: setup.shopPhotoRef } : {}) });
    } else {
      await this.catalog.saveStorefront({ orgId: org.id, cityId: org.cityId, nameAr: org.name, cuisineAr: cuisineLine(kinds), tags: tagsForDoors(kinds, []), photoUrl: setup.shopPhotoRef, minOrderIqd: 0, hours });
    }
    await this.stores.setMerchantSettings(org.id, { setup: { ...setup, liveAt: now }, ...(setup.closedBySetup ? { closed: null } : {}) });
    await this.events.record('merchant.went_live', actor.personId, org.id, { at: now.toISOString(), dishes: facts.dishes.length });
    return this.view(org);
  }

  async firstOrderSeen(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView> {
    const { org, setup } = await this.inSetup(actor, input.merchantOrgId);
    if (setup.firstOrder && !setup.firstOrder.seenAt) await this.stores.setMerchantSettings(org.id, { setup: { ...setup, firstOrder: { ...setup.firstOrder, seenAt: this.clock.now() } } });
    return this.view(org);
  }

  /**
   * The setup line of the store's status header (owner and staff): live or not, how ready, and the
   * first real order once it arrives. Recording that order is the hook field ops' «first order» ping
   * listens to (`merchant.first_order`). Null for a shop from before setup.
   */
  async statusLine(org: Org, s: MerchantSettings): Promise<StoreStatusView['setup']> {
    const setup = s.setup;
    if (!setup) return null;
    if (!setup.liveAt) {
      const p = progressOf(await this.inputs(org, s, setup));
      return { live: false, percent: p.percent, left: p.left, firstOrderId: null };
    }
    let first = setup.firstOrder;
    if (!first) {
      const found = firstOrderAfter(await this.orders.listActive({ merchantOrgId: org.id }), setup.liveAt);
      if (found) {
        first = { orderId: found.id, at: found.placedAt, seenAt: null };
        await this.stores.setMerchantSettings(org.id, { setup: { ...setup, firstOrder: first } });
        await this.events.record('merchant.first_order', 'system:setup', org.id, { orderId: found.id, at: found.placedAt.toISOString() });
      }
    }
    return { live: true, percent: 100, left: 0, firstOrderId: first && !first.seenAt ? first.orderId : null };
  }

  /** Opening a shop that is still in setup is going live (the board's open switch lands here). */
  isInSetup(s: MerchantSettings): boolean {
    return !!s.setup && !s.setup.liveAt;
  }

  // ───────────────────────── internals ─────────────────────────

  private async inputs(org: Org, s: MerchantSettings, setup: MerchantSetupState) {
    const [menu, front, job] = await Promise.all([this.catalog.menu(org.id), this.catalog.storefront(org.id), this.draft(org.id, setup)]);
    return {
      setup,
      dishes: menu.map((i) => ({ photoUrl: i.photoUrl, photoLibrary: i.photoLibrary ?? null, available: i.available })),
      draftRows: job && job.state === 'draft' ? job.items.length : 0,
      hoursSet: (s.openingHours?.length ?? 0) > 0 || (front?.hours.length ?? 0) > 0,
      pickupSet: !!s.pickupSpot,
      front,
      job,
      menu,
    };
  }

  private async draft(orgId: string, setup: MerchantSetupState): Promise<MenuImportJobRecord | null> {
    if (!setup.menuJobId) return null;
    try {
      return await this.catalog.importJob(orgId, setup.menuJobId);
    } catch {
      return null;
    }
  }

  private async cards(orgId: string, setup: MerchantSetupState): Promise<MenuCards> {
    const job = await this.draft(orgId, setup);
    const cards = job ? cardsOf(setup, job.items) : [];
    return {
      merchantOrgId: orgId,
      jobId: job?.id ?? null,
      state: cardsState(job ? { state: job.state, rows: job.items.length } : null, pendingCards(setup, job?.items.length ?? 0)),
      photos: job?.photoRefs.length ?? 0,
      photoUrls: job && this.photos ? job.photoRefs.map((id) => this.photos!.readUrl(id)) : [],
      cards,
    };
  }

  private async view(org: Org): Promise<MerchantSetupView> {
    const s = await this.stores.merchantSettings(org.id);
    const setup = s.setup;
    if (!setup) {
      const done = setupProgress({ kindsConfirmed: true, items: 1, pendingCards: 0, missingPhotos: 0, hoursSet: true, payoutSeen: true, pickupSet: true, practiced: true });
      return {
        merchantOrgId: org.id,
        name: org.name,
        active: false,
        live: true,
        liveAt: null,
        progress: done,
        kinds: { confirmed: null, suggested: [] },
        shopPhotoUrl: null,
        menu: { items: 0, withPhoto: 0, libraryPhotos: 0, missingPhotos: 0, pendingCards: 0, cards: 'none' },
        hours: { set: true, source: s.openingHours ? 'store' : 'catalog' },
        payout: { seen: true },
        pickup: { set: !!s.pickupSpot },
        counter: { sound: true, screen: true, practice: true, printerLater: true },
        firstOrder: null,
      };
    }
    const i = await this.inputs(org, s, setup);
    const progress = progressOf(i);
    const pending = pendingCards(setup, i.draftRows);
    const linked = (stored: string | null) => itemPhotoUrl(this.photos ? { readUrl: (id) => this.photos!.readUrl(id) } : null, stored);
    return {
      merchantOrgId: org.id,
      name: org.name,
      active: true,
      live: setup.liveAt !== null,
      liveAt: setup.liveAt,
      progress,
      kinds: { confirmed: setup.kindsAt ? setup.kinds : null, suggested: suggestedDoors(i.front?.tags ?? null) },
      shopPhotoUrl: linked(i.front?.photoUrl ?? setup.shopPhotoRef),
      menu: {
        items: i.menu.length,
        withPhoto: i.menu.filter((d) => !!d.photoUrl).length,
        libraryPhotos: i.menu.filter((d) => !!d.photoUrl && !!d.photoLibrary).length,
        missingPhotos: i.menu.filter((d) => d.available && !d.photoUrl).length,
        pendingCards: pending,
        cards: cardsState(i.job ? { state: i.job.state, rows: i.job.items.length } : null, pending),
      },
      hours: { set: i.hoursSet, source: s.openingHours?.length ? 'store' : (i.front?.hours.length ?? 0) > 0 ? 'catalog' : 'none' },
      payout: { seen: setup.payoutAt !== null },
      pickup: { set: i.pickupSet },
      counter: { sound: setup.soundAt !== null, screen: setup.screenAt !== null, practice: setup.practiceAt !== null, printerLater: setup.printerLaterAt !== null },
      firstOrder: setup.firstOrder ? { orderId: setup.firstOrder.orderId, at: setup.firstOrder.at, seen: setup.firstOrder.seenAt !== null } : null,
    };
  }

  private async assertUpload(uploadId: string, personId: string): Promise<void> {
    if (!this.photos || !(await this.photos.owns(uploadId, personId))) throw new DriverError('upload_invalid');
  }

  /** The owner of a restaurant or grocer (staff never see setup: `forbidden`). */
  private async ownerStore(actor: Actor, merchantOrgId: string): Promise<Org> {
    if (!(await this.people.hasRole(actor.personId, OWNER, merchantOrgId))) throw new DriverError('forbidden');
    let org: Org;
    try {
      org = await this.stores.get(merchantOrgId);
    } catch {
      throw new DriverError('org_not_found');
    }
    if (org.type !== 'restaurant' && org.type !== 'grocer') throw new DriverError('org_not_found');
    return org;
  }

  /** The owner, of a shop that is in setup (a shop from before setup has nothing to set up). */
  private async inSetup(actor: Actor, merchantOrgId: string): Promise<{ org: Org; s: MerchantSettings; setup: MerchantSetupState }> {
    const org = await this.ownerStore(actor, merchantOrgId);
    const s = await this.stores.merchantSettings(org.id);
    if (!s.setup) throw new DriverError('forbidden');
    return { org, s, setup: s.setup };
  }
}
