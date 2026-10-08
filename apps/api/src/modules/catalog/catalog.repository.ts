import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** A weekly availability window, local time: `[{dow, start, end}]`; an empty list means always. */
export interface AvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
  /** "HH:MM" inclusive. */
  start: string;
  /** "HH:MM" exclusive; may be before `start` to wrap midnight. */
  end: string;
}

/** Per-branch price/availability override, keyed by the catalog's `branchKey`. */
export interface BranchOverride {
  priceIqd?: number;
  available?: boolean;
}

export interface CatalogModifierRecord {
  id: string;
  groupId: string;
  nameAr: string;
  nameEn: string | null;
  /** Price delta added to the item's unit price when chosen. */
  priceIqd: number;
  available: boolean;
  /** How many this version feeds (joy o3, «يشبّع 2–3»); null = not said. */
  servesMin?: number | null;
  servesMax?: number | null;
}

export interface CatalogModifierGroupRecord {
  id: string;
  itemId: string;
  nameAr: string;
  nameEn: string | null;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifiers: CatalogModifierRecord[];
}

export interface CatalogItemRecord {
  id: string;
  orgId: string;
  catalogId: string;
  nameAr: string;
  nameEn: string | null;
  priceIqd: number;
  available: boolean;
  /** Null = unlimited; 0 = sold out. */
  stock: number | null;
  availability: AvailabilityWindow[];
  branchOverrides: Record<string, BranchOverride>;
  prepTimeMin: number;
  pointsEligible: boolean;
  modifierGroups: CatalogModifierGroupRecord[];
  description: string | null;
  photoUrl: string | null;
  /** Menu section ("لفات"); null = the menu's last, unnamed section. */
  categoryAr: string | null;
  sortOrder: number;
  /** Wave 2 "خلص اليوم": off sale until this instant (next local midnight); absent/null = not sold out. */
  soldOutUntil?: Date | null;
  /** How many the dish feeds, set by the kitchen (joy o3); null = not said. */
  servesMin?: number | null;
  servesMax?: number | null;
  /** The kitchen's dish labels (joy o8): `DISH_LABELS`. */
  labels?: string[];
}

/** Wave 2: one price edit (merchant app "price edit with history"). */
export interface PriceChangeRecord {
  id: string;
  itemId: string;
  orgId: string;
  oldPriceIqd: number;
  newPriceIqd: number;
  changedById: string;
  at: Date;
}

export interface ImportedItemRecord {
  nameAr: string;
  priceIqd: number;
  categoryAr?: string | null | undefined;
  description?: string | null | undefined;
  sourceUploadId?: string | null | undefined;
}

/** Wave 2: photo-based menu import; OCR stubbed, staff correct the rows. */
export interface MenuImportJobRecord {
  id: string;
  orgId: string;
  photoRefs: string[];
  state: 'draft' | 'applied' | 'discarded';
  items: ImportedItemRecord[];
  ocr: 'stub' | 'done';
  createdById: string;
  createdAt: Date;
  appliedAt: Date | null;
  appliedCount: number;
}

export type CatalogItemPatch = Partial<Pick<CatalogItemRecord, 'nameAr' | 'nameEn' | 'description' | 'priceIqd' | 'photoUrl' | 'categoryAr' | 'sortOrder' | 'prepTimeMin' | 'available' | 'servesMin' | 'servesMax' | 'labels'>> & {
  soldOutUntil?: Date | null;
};

export type NewModifierGroup = NonNullable<NewCatalogItem['modifierGroups']>[number];

/**
 * The customer-facing storefront of a merchant's main menu (M3): what a restaurant card needs
 * besides the merchant's own settings (location, pause windows, busy) and the delivery quote.
 */
export interface StorefrontRecord {
  orgId: string;
  cityId: string;
  /** The merchant's display name (the org's name). */
  nameAr: string;
  cuisineAr: string;
  tags: string[];
  photoUrl: string | null;
  minOrderIqd: number;
  /** Typical prep in minutes; null = derive from the menu's items. */
  prepMin: number | null;
  /** Local weekly opening windows; empty = always open. */
  hours: AvailabilityWindow[];
  /** PLACEHOLDER until ratings are aggregated from orders. */
  ratingPlaceholder: { avg: number; count: number } | null;
  /** «مطاعمنا» (joy h5): the owner's own lines; customers see it only when `shown`. */
  story?: KitchenStoryRecord | null;
  /** The store reviewers' hidden test kitchen (`orgs.is_test`, BENCH-04): listed only to the reviewer account. */
  isTest?: boolean;
}

/** The kitchen's story as the owner wrote it (storefront JSON `story`). */
export interface KitchenStoryRecord {
  text: string | null;
  sinceYear: number | null;
  /** The owner agreed to show it to customers. */
  shown: boolean;
  updatedAt: Date;
}

export type NewStorefront = Omit<StorefrontRecord, 'photoUrl' | 'prepMin' | 'hours' | 'ratingPlaceholder' | 'tags' | 'story'> &
  Partial<Pick<StorefrontRecord, 'photoUrl' | 'prepMin' | 'hours' | 'ratingPlaceholder' | 'tags' | 'story'>>;

/** «قدر اليوم» (joy h2): one kitchen's dish of one Baghdad day. */
export interface DailyPotRecord {
  id: string;
  merchantOrgId: string;
  itemId: string;
  /** Baghdad date "YYYY-MM-DD". */
  localDate: string;
  note: string | null;
  /** "HH:MM" local; null = to the end of the day. */
  until: string | null;
  postedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDailyPot = Pick<DailyPotRecord, 'merchantOrgId' | 'itemId' | 'localDate' | 'note' | 'until' | 'postedById'> & { at: Date };

/** «خبرني لمن يطبخوه»: one person following one dish. */
export interface DishFollowRecord {
  personId: string;
  merchantOrgId: string;
  itemId: string;
  createdAt: Date;
}

export interface NewCatalogItem {
  /** Optional fixed id (seeds, simulator); generated otherwise. */
  id?: string;
  orgId: string;
  nameAr: string;
  nameEn?: string | null;
  priceIqd: number;
  available?: boolean;
  stock?: number | null;
  availability?: AvailabilityWindow[];
  branchOverrides?: Record<string, BranchOverride>;
  prepTimeMin?: number;
  pointsEligible?: boolean;
  description?: string | null;
  photoUrl?: string | null;
  categoryAr?: string | null;
  sortOrder?: number;
  servesMin?: number | null;
  servesMax?: number | null;
  labels?: string[];
  modifierGroups?: Array<{
    nameAr: string;
    nameEn?: string | null;
    minSelect?: number;
    maxSelect?: number;
    required?: boolean;
    modifiers: Array<{ nameAr: string; nameEn?: string | null; priceIqd: number; available?: boolean; servesMin?: number | null; servesMax?: number | null }>;
  }>;
}

/** The catalog module's persistence port. Prisma when DATABASE_URL is set, in-memory otherwise. */
export interface CatalogRepository {
  /** Items of `orgId` among `ids` (unknown ids and other merchants' items are simply absent). */
  itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]>;
  menu(orgId: string): Promise<CatalogItemRecord[]>;
  createItem(input: NewCatalogItem, tx?: Tx): Promise<CatalogItemRecord>;
  setAvailable(id: string, available: boolean): Promise<void>;
  /** Merchants of `cityId` with a customer storefront on their main menu. */
  storefronts(cityId: string): Promise<StorefrontRecord[]>;
  storefront(orgId: string): Promise<StorefrontRecord | null>;
  /** Creates or replaces the storefront of `orgId`'s main menu. */
  saveStorefront(input: NewStorefront): Promise<StorefrontRecord>;

  // ── wave 2: merchant menu admin ──
  item(id: string, tx?: Tx): Promise<CatalogItemRecord | null>;
  updateItem(id: string, patch: CatalogItemPatch, tx?: Tx): Promise<CatalogItemRecord>;
  /** Replaces every modifier group (and modifier) of the item. */
  replaceModifierGroups(itemId: string, groups: readonly NewModifierGroup[], tx?: Tx): Promise<CatalogItemRecord>;
  addPriceChange(input: Omit<PriceChangeRecord, 'id'>, tx?: Tx): Promise<PriceChangeRecord>;
  /** Newest first. */
  priceChanges(itemId: string, tx?: Tx): Promise<PriceChangeRecord[]>;
  createImportJob(input: Omit<MenuImportJobRecord, 'id'>, tx?: Tx): Promise<MenuImportJobRecord>;
  updateImportJob(id: string, patch: Partial<Pick<MenuImportJobRecord, 'state' | 'items' | 'appliedAt' | 'appliedCount'>>, tx?: Tx): Promise<MenuImportJobRecord>;
  importJob(id: string, tx?: Tx): Promise<MenuImportJobRecord | null>;
  /**
   * Moves a `draft` job to `applied` (stamped `at`) if, and only if, it is still a draft: true for the
   * one caller that wins (a conditional update, so two concurrent applies cannot both create items).
   */
  claimImportJob(id: string, at: Date, tx?: Tx): Promise<boolean>;

  // ── joy h2: today's pot and dish follows ──
  /** Creates or replaces the kitchen's pot of `localDate`. */
  upsertPot(input: NewDailyPot, tx?: Tx): Promise<DailyPotRecord>;
  deletePot(merchantOrgId: string, localDate: string, tx?: Tx): Promise<void>;
  /** Every kitchen's pot of one day. */
  potsOn(localDate: string): Promise<DailyPotRecord[]>;
  /** One kitchen's pots from `sinceDate` (inclusive), newest first. */
  potsOf(merchantOrgId: string, sinceDate: string): Promise<DailyPotRecord[]>;
  dishFollows(personId: string): Promise<DishFollowRecord[]>;
  /** Idempotent: on adds the row once, off removes it. */
  setDishFollow(input: Omit<DishFollowRecord, 'createdAt'> & { on: boolean; at: Date }): Promise<void>;
  /** Who follows a dish. */
  followersOf(itemId: string, tx?: Tx): Promise<string[]>;
  /** Followers per dish of one kitchen. */
  followerCounts(merchantOrgId: string): Promise<Map<string, number>>;

  // ── joy h4: searches that found nothing (anonymous) ──
  addUnmetSearch(input: Omit<UnmetSearchRecord, 'id'>): Promise<void>;
  /** Rows of `cityId` at or after `since`, newest first. */
  unmetSearches(cityId: string, since: Date): Promise<UnmetSearchRecord[]>;
}

/** One «إي گولولهم» on an empty search: the words, the zone, signed in or not — never who. */
export interface UnmetSearchRecord {
  id: string;
  cityId: string;
  /** Folded (what the Console groups by). */
  term: string;
  typed: string;
  zoneKey: string | null;
  signedIn: boolean;
  createdAt: Date;
}

function toStorefront(input: NewStorefront): StorefrontRecord {
  assertPrice(input.minOrderIqd, 'minOrderIqd');
  return {
    orgId: input.orgId,
    cityId: input.cityId,
    nameAr: input.nameAr,
    cuisineAr: input.cuisineAr,
    tags: [...(input.tags ?? [])],
    photoUrl: input.photoUrl ?? null,
    minOrderIqd: input.minOrderIqd,
    prepMin: input.prepMin ?? null,
    hours: [...(input.hours ?? [])],
    ratingPlaceholder: input.ratingPlaceholder ?? null,
    story: input.story ?? null,
    isTest: input.isTest ?? false,
  };
}

/** Menu order: by `sortOrder`, ties keep their insertion (creation) order. */
function byMenuOrder(a: CatalogItemRecord, b: CatalogItemRecord): number {
  return a.sortOrder - b.sortOrder;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

function assertPrice(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer IQD amount`);
}

function validate(input: NewCatalogItem): void {
  assertPrice(input.priceIqd, 'priceIqd');
  for (const g of input.modifierGroups ?? []) for (const m of g.modifiers) assertPrice(m.priceIqd, 'modifier priceIqd');
  for (const o of Object.values(input.branchOverrides ?? {})) if (o.priceIqd !== undefined) assertPrice(o.priceIqd, 'branch priceIqd');
}

/** In-memory twin: unit tests, the simulator and the API without a database. */
export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly items = new Map<string, CatalogItemRecord>();
  private readonly fronts = new Map<string, StorefrontRecord>();
  private readonly unmet: UnmetSearchRecord[] = [];
  private readonly pots = new Map<string, DailyPotRecord>();
  private readonly follows = new Map<string, DishFollowRecord>();
  private seq = 0;

  async upsertPot(input: NewDailyPot): Promise<DailyPotRecord> {
    const key = `${input.merchantOrgId}|${input.localDate}`;
    const old = this.pots.get(key);
    const row: DailyPotRecord = {
      id: old?.id ?? `pot_${++this.seq}`,
      merchantOrgId: input.merchantOrgId,
      itemId: input.itemId,
      localDate: input.localDate,
      note: input.note,
      until: input.until,
      postedById: input.postedById,
      createdAt: old?.createdAt ?? input.at,
      updatedAt: input.at,
    };
    this.pots.set(key, row);
    return { ...row };
  }

  async deletePot(merchantOrgId: string, localDate: string): Promise<void> {
    this.pots.delete(`${merchantOrgId}|${localDate}`);
  }

  async potsOn(localDate: string): Promise<DailyPotRecord[]> {
    return [...this.pots.values()].filter((p) => p.localDate === localDate).map((p) => ({ ...p }));
  }

  async potsOf(merchantOrgId: string, sinceDate: string): Promise<DailyPotRecord[]> {
    return [...this.pots.values()]
      .filter((p) => p.merchantOrgId === merchantOrgId && p.localDate >= sinceDate)
      .sort((a, b) => b.localDate.localeCompare(a.localDate))
      .map((p) => ({ ...p }));
  }

  async dishFollows(personId: string): Promise<DishFollowRecord[]> {
    return [...this.follows.values()].filter((f) => f.personId === personId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((f) => ({ ...f }));
  }

  async setDishFollow(input: Omit<DishFollowRecord, 'createdAt'> & { on: boolean; at: Date }): Promise<void> {
    const key = `${input.personId}|${input.itemId}`;
    if (!input.on) this.follows.delete(key);
    else if (!this.follows.has(key)) this.follows.set(key, { personId: input.personId, merchantOrgId: input.merchantOrgId, itemId: input.itemId, createdAt: input.at });
  }

  async followersOf(itemId: string): Promise<string[]> {
    return [...this.follows.values()].filter((f) => f.itemId === itemId).map((f) => f.personId);
  }

  async followerCounts(merchantOrgId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const f of this.follows.values()) if (f.merchantOrgId === merchantOrgId) out.set(f.itemId, (out.get(f.itemId) ?? 0) + 1);
    return out;
  }

  async addUnmetSearch(input: Omit<UnmetSearchRecord, 'id'>): Promise<void> {
    this.unmet.push({ ...input, id: `unmet_${++this.seq}` });
  }

  async unmetSearches(cityId: string, since: Date): Promise<UnmetSearchRecord[]> {
    return this.unmet
      .filter((r) => r.cityId === cityId && r.createdAt.getTime() >= since.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]> {
    return [...new Set(ids)].map((id) => this.items.get(id)).filter((i): i is CatalogItemRecord => i !== undefined && i.orgId === orgId).map(clone);
  }

  async menu(orgId: string): Promise<CatalogItemRecord[]> {
    return [...this.items.values()].filter((i) => i.orgId === orgId).sort(byMenuOrder).map(clone);
  }

  async storefronts(cityId: string): Promise<StorefrontRecord[]> {
    return [...this.fronts.values()].filter((s) => s.cityId === cityId).map((s) => structuredClone(s));
  }

  async storefront(orgId: string): Promise<StorefrontRecord | null> {
    const s = this.fronts.get(orgId);
    return s ? structuredClone(s) : null;
  }

  async saveStorefront(input: NewStorefront): Promise<StorefrontRecord> {
    const s = toStorefront(input);
    this.fronts.set(s.orgId, s);
    return structuredClone(s);
  }

  async createItem(input: NewCatalogItem): Promise<CatalogItemRecord> {
    validate(input);
    this.seq += 1;
    const id = input.id ?? `ci_${this.seq}`;
    if (this.items.has(id)) throw new Error(`catalog item ${id} already exists`);
    const item: CatalogItemRecord = {
      id,
      orgId: input.orgId,
      catalogId: `${input.orgId}_catalog`,
      nameAr: input.nameAr,
      nameEn: input.nameEn ?? null,
      priceIqd: input.priceIqd,
      available: input.available ?? true,
      stock: input.stock ?? null,
      availability: [...(input.availability ?? [])],
      branchOverrides: { ...(input.branchOverrides ?? {}) },
      prepTimeMin: input.prepTimeMin ?? 15,
      pointsEligible: input.pointsEligible ?? true,
      description: input.description ?? null,
      photoUrl: input.photoUrl ?? null,
      categoryAr: input.categoryAr ?? null,
      sortOrder: input.sortOrder ?? 0,
      servesMin: input.servesMin ?? null,
      servesMax: input.servesMax ?? null,
      labels: [...(input.labels ?? [])],
      modifierGroups: (input.modifierGroups ?? []).map((g, gi) => {
        const groupId = `${id}_mg_${gi + 1}`;
        return {
          id: groupId,
          itemId: id,
          nameAr: g.nameAr,
          nameEn: g.nameEn ?? null,
          minSelect: g.minSelect ?? (g.required ? 1 : 0),
          maxSelect: g.maxSelect ?? 1,
          required: g.required ?? false,
          modifiers: g.modifiers.map((m, mi) => ({ id: `${groupId}_m_${mi + 1}`, groupId, nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })),
        };
      }),
    };
    this.items.set(id, item);
    return clone(item);
  }

  async setAvailable(id: string, available: boolean): Promise<void> {
    const item = this.items.get(id);
    if (item) item.available = available;
  }

  private readonly prices: PriceChangeRecord[] = [];
  private readonly imports = new Map<string, MenuImportJobRecord>();

  async item(id: string): Promise<CatalogItemRecord | null> {
    const i = this.items.get(id);
    return i ? clone(i) : null;
  }

  async updateItem(id: string, patch: CatalogItemPatch): Promise<CatalogItemRecord> {
    const item = this.items.get(id);
    if (!item) throw new Error(`catalog item ${id} not found`);
    if (patch.priceIqd !== undefined) assertPrice(patch.priceIqd, 'priceIqd');
    Object.assign(item, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return clone(item);
  }

  async replaceModifierGroups(itemId: string, groups: readonly NewModifierGroup[]): Promise<CatalogItemRecord> {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`catalog item ${itemId} not found`);
    this.seq += 1;
    const gen = this.seq;
    item.modifierGroups = groups.map((g, gi) => {
      const groupId = `${itemId}_mg${gen}_${gi + 1}`;
      return {
        id: groupId,
        itemId,
        nameAr: g.nameAr,
        nameEn: g.nameEn ?? null,
        minSelect: g.minSelect ?? (g.required ? 1 : 0),
        maxSelect: g.maxSelect ?? 1,
        required: g.required ?? false,
        modifiers: g.modifiers.map((m, mi) => {
          assertPrice(m.priceIqd, 'modifier priceIqd');
          return { id: `${groupId}_m_${mi + 1}`, groupId, nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null };
        }),
      };
    });
    return clone(item);
  }

  async addPriceChange(input: Omit<PriceChangeRecord, 'id'>): Promise<PriceChangeRecord> {
    this.seq += 1;
    const row = { id: `pc_${this.seq}`, ...input };
    this.prices.push(row);
    return { ...row };
  }

  async priceChanges(itemId: string): Promise<PriceChangeRecord[]> {
    return this.prices.filter((p) => p.itemId === itemId).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id)).map((p) => ({ ...p }));
  }

  async createImportJob(input: Omit<MenuImportJobRecord, 'id'>): Promise<MenuImportJobRecord> {
    this.seq += 1;
    const job = structuredClone({ id: `mij_${this.seq}`, ...input });
    this.imports.set(job.id, job);
    return structuredClone(job);
  }

  async updateImportJob(id: string, patch: Partial<Pick<MenuImportJobRecord, 'state' | 'items' | 'appliedAt' | 'appliedCount'>>): Promise<MenuImportJobRecord> {
    const job = this.imports.get(id);
    if (!job) throw new Error(`menu import ${id} not found`);
    Object.assign(job, structuredClone(patch));
    return structuredClone(job);
  }

  async claimImportJob(id: string, at: Date): Promise<boolean> {
    const j = this.imports.get(id);
    if (!j || j.state !== 'draft') return false;
    j.state = 'applied';
    j.appliedAt = at;
    return true;
  }

  async importJob(id: string): Promise<MenuImportJobRecord | null> {
    const job = this.imports.get(id);
    return job ? structuredClone(job) : null;
  }
}

function clone(i: CatalogItemRecord): CatalogItemRecord {
  return structuredClone(i);
}

type ItemRow = {
  id: string;
  orgId: string;
  catalogId: string;
  nameAr: string;
  nameEn: string | null;
  priceIqd: number;
  available: boolean;
  stock: number | null;
  availability: unknown;
  branchOverrides: unknown;
  prepTimeMin: number;
  pointsEligible: boolean;
  description: string | null;
  photoUrl: string | null;
  categoryAr: string | null;
  sortOrder: number;
  soldOutUntil?: Date | null;
  servesMin?: number | null;
  servesMax?: number | null;
  labels?: string[];
  modifierGroups: Array<{
    id: string;
    itemId: string;
    nameAr: string;
    nameEn: string | null;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    modifiers: Array<{ id: string; groupId: string; nameAr: string; nameEn: string | null; priceIqd: number; available: boolean; servesMin?: number | null; servesMax?: number | null }>;
  }>;
};

const WITH_MODIFIERS = { modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { modifiers: { orderBy: { sortOrder: 'asc' } } } } } as const;

function fromRow(r: ItemRow): CatalogItemRecord {
  return {
    id: r.id,
    orgId: r.orgId,
    catalogId: r.catalogId,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    priceIqd: r.priceIqd,
    available: r.available,
    stock: r.stock,
    availability: Array.isArray(r.availability) ? (r.availability as AvailabilityWindow[]) : [],
    branchOverrides: r.branchOverrides && typeof r.branchOverrides === 'object' && !Array.isArray(r.branchOverrides) ? (r.branchOverrides as Record<string, BranchOverride>) : {},
    prepTimeMin: r.prepTimeMin,
    pointsEligible: r.pointsEligible,
    description: r.description ?? null,
    photoUrl: r.photoUrl ?? null,
    categoryAr: r.categoryAr ?? null,
    sortOrder: r.sortOrder ?? 0,
    ...(r.soldOutUntil ? { soldOutUntil: r.soldOutUntil } : {}),
    servesMin: r.servesMin ?? null,
    servesMax: r.servesMax ?? null,
    labels: [...(r.labels ?? [])],
    modifierGroups: r.modifierGroups.map((g) => ({
      id: g.id,
      itemId: g.itemId,
      nameAr: g.nameAr,
      nameEn: g.nameEn,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: g.required,
      modifiers: g.modifiers.map((m) => ({ id: m.id, groupId: m.groupId, nameAr: m.nameAr, nameEn: m.nameEn, priceIqd: m.priceIqd, available: m.available, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })),
    })),
  };
}

/**
 * Reads `catalogs.storefront` defensively (JSON written by the seed or `saveStorefront`); a menu
 * without a cuisine line has no storefront and is not listed to customers.
 */
function storefrontFromRow(orgId: string, org: { name: string; cityId: string; isTest: boolean }, raw: unknown): StorefrontRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const j = raw as Record<string, unknown>;
  if (typeof j['cuisineAr'] !== 'string' || !j['cuisineAr']) return null;
  const rating = j['ratingPlaceholder'] as { avg?: unknown; count?: unknown } | null | undefined;
  return {
    orgId,
    cityId: org.cityId,
    nameAr: org.name,
    cuisineAr: j['cuisineAr'],
    tags: Array.isArray(j['tags']) ? j['tags'].filter((t): t is string => typeof t === 'string') : [],
    photoUrl: typeof j['photoUrl'] === 'string' ? j['photoUrl'] : null,
    minOrderIqd: typeof j['minOrderIqd'] === 'number' ? j['minOrderIqd'] : 0,
    prepMin: typeof j['prepMin'] === 'number' ? j['prepMin'] : null,
    hours: Array.isArray(j['hours']) ? (j['hours'] as AvailabilityWindow[]) : [],
    ratingPlaceholder: rating && typeof rating.avg === 'number' && typeof rating.count === 'number' ? { avg: rating.avg, count: rating.count } : null,
    story: storyFromJson(j['story']),
    isTest: org.isTest,
  };
}

/** `storefront.story` as written by `saveStorefront`; anything malformed reads as no story. */
function storyFromJson(raw: unknown): KitchenStoryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const j = raw as Record<string, unknown>;
  const updatedAt = typeof j['updatedAt'] === 'string' ? new Date(j['updatedAt']) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return null;
  return {
    text: typeof j['text'] === 'string' && j['text'] ? j['text'] : null,
    sinceYear: typeof j['sinceYear'] === 'number' ? j['sinceYear'] : null,
    shown: j['shown'] === true,
    updatedAt,
  };
}

function potFromRow(r: { id: string; merchantOrgId: string; itemId: string; localDate: string; note: string | null; until: string | null; postedById: string; createdAt: Date; updatedAt: Date }): DailyPotRecord {
  return { id: r.id, merchantOrgId: r.merchantOrgId, itemId: r.itemId, localDate: r.localDate, note: r.note, until: r.until, postedById: r.postedById, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

/** `catalog_items` + `modifier_groups` + `modifiers` (seeded by `pnpm db:seed`). */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertPot(input: NewDailyPot, tx?: Tx): Promise<DailyPotRecord> {
    const data = { itemId: input.itemId, note: input.note, until: input.until, postedById: input.postedById, updatedAt: input.at };
    const row = await this.db(tx).dailyPot.upsert({
      where: { merchantOrgId_localDate: { merchantOrgId: input.merchantOrgId, localDate: input.localDate } },
      create: { ...data, merchantOrgId: input.merchantOrgId, localDate: input.localDate, createdAt: input.at },
      update: data,
    });
    return potFromRow(row);
  }

  async deletePot(merchantOrgId: string, localDate: string, tx?: Tx): Promise<void> {
    await this.db(tx).dailyPot.deleteMany({ where: { merchantOrgId, localDate } });
  }

  async potsOn(localDate: string): Promise<DailyPotRecord[]> {
    return (await this.prisma.prisma.dailyPot.findMany({ where: { localDate } })).map(potFromRow);
  }

  async potsOf(merchantOrgId: string, sinceDate: string): Promise<DailyPotRecord[]> {
    return (await this.prisma.prisma.dailyPot.findMany({ where: { merchantOrgId, localDate: { gte: sinceDate } }, orderBy: { localDate: 'desc' } })).map(potFromRow);
  }

  async dishFollows(personId: string): Promise<DishFollowRecord[]> {
    const rows = await this.prisma.prisma.dishFollow.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ personId: r.personId, merchantOrgId: r.merchantOrgId, itemId: r.itemId, createdAt: r.createdAt }));
  }

  async setDishFollow(input: Omit<DishFollowRecord, 'createdAt'> & { on: boolean; at: Date }): Promise<void> {
    const db = this.prisma.prisma;
    if (!input.on) {
      await db.dishFollow.deleteMany({ where: { personId: input.personId, itemId: input.itemId } });
      return;
    }
    // ON CONFLICT DO NOTHING: a double tap racing the first follow keeps one row and no 500 (RDB-04).
    await db.dishFollow.createMany({ data: [{ personId: input.personId, merchantOrgId: input.merchantOrgId, itemId: input.itemId, createdAt: input.at }], skipDuplicates: true });
  }

  async followersOf(itemId: string, tx?: Tx): Promise<string[]> {
    return (await this.db(tx).dishFollow.findMany({ where: { itemId }, select: { personId: true } })).map((r) => r.personId);
  }

  async followerCounts(merchantOrgId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.prisma.dishFollow.groupBy({ by: ['itemId'], where: { merchantOrgId }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.itemId, r._count._all]));
  }

  async addUnmetSearch(input: Omit<UnmetSearchRecord, 'id'>): Promise<void> {
    await this.prisma.prisma.searchUnmet.create({ data: { cityId: input.cityId, term: input.term, typed: input.typed, zoneKey: input.zoneKey, signedIn: input.signedIn, createdAt: input.createdAt } });
  }

  async unmetSearches(cityId: string, since: Date): Promise<UnmetSearchRecord[]> {
    const rows = await this.prisma.prisma.searchUnmet.findMany({ where: { cityId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 5000 });
    return rows.map((r) => ({ id: r.id, cityId: r.cityId, term: r.term, typed: r.typed, zoneKey: r.zoneKey, signedIn: r.signedIn, createdAt: r.createdAt }));
  }

  async itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.prisma.catalogItem.findMany({ where: { orgId, id: { in: [...new Set(ids)] } }, include: WITH_MODIFIERS });
    return (rows as unknown as ItemRow[]).map(fromRow);
  }

  async menu(orgId: string): Promise<CatalogItemRecord[]> {
    const rows = await this.prisma.prisma.catalogItem.findMany({ where: { orgId }, include: WITH_MODIFIERS, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return (rows as unknown as ItemRow[]).map(fromRow);
  }

  async storefronts(cityId: string): Promise<StorefrontRecord[]> {
    const rows = await this.prisma.prisma.catalog.findMany({
      where: { active: true, branchKey: null, org: { cityId, type: { in: ['restaurant', 'grocer'] } } },
      include: { org: { select: { name: true, cityId: true, isTest: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => storefrontFromRow(r.orgId, r.org, r.storefront)).filter((s): s is StorefrontRecord => s !== null);
  }

  async storefront(orgId: string): Promise<StorefrontRecord | null> {
    const r = await this.prisma.prisma.catalog.findFirst({
      where: { orgId, active: true, branchKey: null },
      include: { org: { select: { name: true, cityId: true, isTest: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return r ? storefrontFromRow(r.orgId, r.org, r.storefront) : null;
  }

  async saveStorefront(input: NewStorefront): Promise<StorefrontRecord> {
    const s = toStorefront(input);
    const db = this.prisma.prisma;
    const story = s.story ? { text: s.story.text, sinceYear: s.story.sinceYear, shown: s.story.shown, updatedAt: s.story.updatedAt.toISOString() } : null;
    const json = { cuisineAr: s.cuisineAr, tags: s.tags, photoUrl: s.photoUrl, minOrderIqd: s.minOrderIqd, prepMin: s.prepMin, hours: s.hours, ratingPlaceholder: s.ratingPlaceholder, story } as never;
    const catalog = await db.catalog.findFirst({ where: { orgId: s.orgId, branchKey: null, active: true }, orderBy: { createdAt: 'asc' } });
    if (catalog) await db.catalog.update({ where: { id: catalog.id }, data: { storefront: json } });
    else await db.catalog.create({ data: { orgId: s.orgId, nameAr: 'القائمة الرئيسية', storefront: json } });
    return s;
  }

  async createItem(input: NewCatalogItem, tx?: Tx): Promise<CatalogItemRecord> {
    validate(input);
    const db = this.db(tx);
    const catalog =
      (await db.catalog.findFirst({ where: { orgId: input.orgId, branchKey: null, active: true }, orderBy: { createdAt: 'asc' } })) ??
      (await db.catalog.create({ data: { orgId: input.orgId, nameAr: 'القائمة الرئيسية' } }));
    const row = await db.catalogItem.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        catalogId: catalog.id,
        orgId: input.orgId,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        priceIqd: input.priceIqd,
        available: input.available ?? true,
        stock: input.stock ?? null,
        availability: (input.availability ?? []) as never,
        branchOverrides: (input.branchOverrides ?? {}) as never,
        prepTimeMin: input.prepTimeMin ?? 15,
        pointsEligible: input.pointsEligible ?? true,
        description: input.description ?? null,
        photoUrl: input.photoUrl ?? null,
        categoryAr: input.categoryAr ?? null,
        sortOrder: input.sortOrder ?? 0,
        servesMin: input.servesMin ?? null,
        servesMax: input.servesMax ?? null,
        labels: [...(input.labels ?? [])],
        modifierGroups: {
          create: (input.modifierGroups ?? []).map((g, gi) => ({
            nameAr: g.nameAr,
            nameEn: g.nameEn ?? null,
            minSelect: g.minSelect ?? (g.required ? 1 : 0),
            maxSelect: g.maxSelect ?? 1,
            required: g.required ?? false,
            sortOrder: gi,
            modifiers: { create: g.modifiers.map((m, mi) => ({ nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true, sortOrder: mi, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })) },
          })),
        },
      },
      include: WITH_MODIFIERS,
    });
    return fromRow(row as unknown as ItemRow);
  }

  async setAvailable(id: string, available: boolean): Promise<void> {
    await this.prisma.prisma.catalogItem.update({ where: { id }, data: { available } });
  }

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async item(id: string, tx?: Tx): Promise<CatalogItemRecord | null> {
    const row = await this.db(tx).catalogItem.findUnique({ where: { id }, include: WITH_MODIFIERS });
    return row ? fromRow(row as unknown as ItemRow) : null;
  }

  async updateItem(id: string, patch: CatalogItemPatch, tx?: Tx): Promise<CatalogItemRecord> {
    if (patch.priceIqd !== undefined) assertPrice(patch.priceIqd, 'priceIqd');
    const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const row = await this.db(tx).catalogItem.update({ where: { id }, data, include: WITH_MODIFIERS });
    return fromRow(row as unknown as ItemRow);
  }

  async replaceModifierGroups(itemId: string, groups: readonly NewModifierGroup[], tx?: Tx): Promise<CatalogItemRecord> {
    const db = this.db(tx);
    for (const g of groups) for (const m of g.modifiers) assertPrice(m.priceIqd, 'modifier priceIqd');
    const old = await db.modifierGroup.findMany({ where: { itemId }, select: { id: true } });
    if (old.length > 0) {
      await db.modifier.deleteMany({ where: { groupId: { in: old.map((g) => g.id) } } });
      await db.modifierGroup.deleteMany({ where: { itemId } });
    }
    for (const [gi, g] of groups.entries()) {
      await db.modifierGroup.create({
        data: {
          itemId,
          nameAr: g.nameAr,
          nameEn: g.nameEn ?? null,
          minSelect: g.minSelect ?? (g.required ? 1 : 0),
          maxSelect: g.maxSelect ?? 1,
          required: g.required ?? false,
          sortOrder: gi,
          modifiers: { create: g.modifiers.map((m, mi) => ({ nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true, sortOrder: mi, servesMin: m.servesMin ?? null, servesMax: m.servesMax ?? null })) },
        },
      });
    }
    const row = await db.catalogItem.findUniqueOrThrow({ where: { id: itemId }, include: WITH_MODIFIERS });
    return fromRow(row as unknown as ItemRow);
  }

  async addPriceChange(input: Omit<PriceChangeRecord, 'id'>, tx?: Tx): Promise<PriceChangeRecord> {
    const row = await this.db(tx).catalogPriceChange.create({
      data: { itemId: input.itemId, orgId: input.orgId, oldPriceIqd: input.oldPriceIqd, newPriceIqd: input.newPriceIqd, changedById: input.changedById, createdAt: input.at },
    });
    return { id: row.id, itemId: row.itemId, orgId: row.orgId, oldPriceIqd: row.oldPriceIqd, newPriceIqd: row.newPriceIqd, changedById: row.changedById, at: row.createdAt };
  }

  async priceChanges(itemId: string, tx?: Tx): Promise<PriceChangeRecord[]> {
    const rows = await this.db(tx).catalogPriceChange.findMany({ where: { itemId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map((r) => ({ id: r.id, itemId: r.itemId, orgId: r.orgId, oldPriceIqd: r.oldPriceIqd, newPriceIqd: r.newPriceIqd, changedById: r.changedById, at: r.createdAt }));
  }

  async createImportJob(input: Omit<MenuImportJobRecord, 'id'>, tx?: Tx): Promise<MenuImportJobRecord> {
    const row = await this.db(tx).menuImportJob.create({
      data: {
        orgId: input.orgId,
        photoRefs: input.photoRefs,
        state: input.state,
        items: input.items as never,
        ocr: input.ocr,
        createdById: input.createdById,
        createdAt: input.createdAt,
        appliedAt: input.appliedAt,
        appliedCount: input.appliedCount,
      },
    });
    return importJobFromRow(row);
  }

  async updateImportJob(id: string, patch: Partial<Pick<MenuImportJobRecord, 'state' | 'items' | 'appliedAt' | 'appliedCount'>>, tx?: Tx): Promise<MenuImportJobRecord> {
    const { items, ...rest } = patch;
    const row = await this.db(tx).menuImportJob.update({ where: { id }, data: { ...rest, ...(items ? { items: items as never } : {}) } });
    return importJobFromRow(row);
  }

  async claimImportJob(id: string, at: Date, tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).menuImportJob.updateMany({ where: { id, state: 'draft' }, data: { state: 'applied', appliedAt: at } });
    return res.count === 1;
  }

  async importJob(id: string, tx?: Tx): Promise<MenuImportJobRecord | null> {
    const row = await this.db(tx).menuImportJob.findUnique({ where: { id } });
    return row ? importJobFromRow(row) : null;
  }
}

function importJobFromRow(r: {
  id: string;
  orgId: string;
  photoRefs: string[];
  state: string;
  items: unknown;
  ocr: string;
  createdById: string;
  createdAt: Date;
  appliedAt: Date | null;
  appliedCount: number;
}): MenuImportJobRecord {
  return {
    id: r.id,
    orgId: r.orgId,
    photoRefs: [...r.photoRefs],
    state: r.state === 'applied' || r.state === 'discarded' ? r.state : 'draft',
    items: Array.isArray(r.items) ? (r.items as ImportedItemRecord[]) : [],
    ocr: r.ocr === 'done' ? 'done' : 'stub',
    createdById: r.createdById,
    createdAt: r.createdAt,
    appliedAt: r.appliedAt,
    appliedCount: r.appliedCount,
  };
}
