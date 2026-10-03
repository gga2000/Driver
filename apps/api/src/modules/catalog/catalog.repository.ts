import type { PrismaService } from '../../shared/db/prisma.service.js';

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
  modifierGroups?: Array<{
    nameAr: string;
    nameEn?: string | null;
    minSelect?: number;
    maxSelect?: number;
    required?: boolean;
    modifiers: Array<{ nameAr: string; nameEn?: string | null; priceIqd: number; available?: boolean }>;
  }>;
}

/** The catalog module's persistence port. Prisma when DATABASE_URL is set, in-memory otherwise. */
export interface CatalogRepository {
  /** Items of `orgId` among `ids` (unknown ids and other merchants' items are simply absent). */
  itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]>;
  menu(orgId: string): Promise<CatalogItemRecord[]>;
  createItem(input: NewCatalogItem): Promise<CatalogItemRecord>;
  setAvailable(id: string, available: boolean): Promise<void>;
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
  private seq = 0;

  async itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]> {
    return [...new Set(ids)].map((id) => this.items.get(id)).filter((i): i is CatalogItemRecord => i !== undefined && i.orgId === orgId).map(clone);
  }

  async menu(orgId: string): Promise<CatalogItemRecord[]> {
    return [...this.items.values()].filter((i) => i.orgId === orgId).map(clone);
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
          modifiers: g.modifiers.map((m, mi) => ({ id: `${groupId}_m_${mi + 1}`, groupId, nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true })),
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
  modifierGroups: Array<{
    id: string;
    itemId: string;
    nameAr: string;
    nameEn: string | null;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    modifiers: Array<{ id: string; groupId: string; nameAr: string; nameEn: string | null; priceIqd: number; available: boolean }>;
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
    modifierGroups: r.modifierGroups.map((g) => ({
      id: g.id,
      itemId: g.itemId,
      nameAr: g.nameAr,
      nameEn: g.nameEn,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: g.required,
      modifiers: g.modifiers.map((m) => ({ id: m.id, groupId: m.groupId, nameAr: m.nameAr, nameEn: m.nameEn, priceIqd: m.priceIqd, available: m.available })),
    })),
  };
}

/** `catalog_items` + `modifier_groups` + `modifiers` (seeded by `pnpm db:seed`). */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async itemsByIds(orgId: string, ids: readonly string[]): Promise<CatalogItemRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.prisma.catalogItem.findMany({ where: { orgId, id: { in: [...new Set(ids)] } }, include: WITH_MODIFIERS });
    return (rows as unknown as ItemRow[]).map(fromRow);
  }

  async menu(orgId: string): Promise<CatalogItemRecord[]> {
    const rows = await this.prisma.prisma.catalogItem.findMany({ where: { orgId }, include: WITH_MODIFIERS, orderBy: { createdAt: 'asc' } });
    return (rows as unknown as ItemRow[]).map(fromRow);
  }

  async createItem(input: NewCatalogItem): Promise<CatalogItemRecord> {
    validate(input);
    const db = this.prisma.prisma;
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
        modifierGroups: {
          create: (input.modifierGroups ?? []).map((g, gi) => ({
            nameAr: g.nameAr,
            nameEn: g.nameEn ?? null,
            minSelect: g.minSelect ?? (g.required ? 1 : 0),
            maxSelect: g.maxSelect ?? 1,
            required: g.required ?? false,
            sortOrder: gi,
            modifiers: { create: g.modifiers.map((m, mi) => ({ nameAr: m.nameAr, nameEn: m.nameEn ?? null, priceIqd: m.priceIqd, available: m.available ?? true, sortOrder: mi })) },
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
}
