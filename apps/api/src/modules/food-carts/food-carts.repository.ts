import type { CartKind, CartSpot, WalkupLine, WalkupState } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { onRollback, type Tx } from '../../shared/db/unit-of-work.js';

export interface FoodCartRecord {
  id: string;
  orgId: string;
  cityId: string;
  kind: CartKind;
  /** Tonight's spot while open, the last one after; null before the first opening. */
  spot: CartSpot | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  usualFrom: string | null;
  usualTo: string | null;
  awayNote: string | null;
  createdAt: Date;
}

export type FoodCartPatch = Partial<Pick<FoodCartRecord, 'spot' | 'openedAt' | 'closesAt' | 'closedAt' | 'usualFrom' | 'usualTo' | 'awayNote'>>;

export interface WalkupRecord {
  id: string;
  cartId: string;
  orgId: string;
  personId: string;
  code: string;
  state: WalkupState;
  lines: WalkupLine[];
  note: string | null;
  totalIqd: number;
  commissionIqd: number;
  readyBy: Date;
  placedAt: Date;
  readyAt: Date | null;
  collectedAt: Date | null;
  cancelledAt: Date | null;
}

export type WalkupPatch = Partial<Pick<WalkupRecord, 'state' | 'readyAt' | 'collectedAt' | 'cancelledAt' | 'commissionIqd'>>;

/** `food_carts`, `food_cart_follows` and `food_cart_walkups`. */
export interface FoodCartsRepository {
  create(input: Omit<FoodCartRecord, 'id' | 'createdAt'>, tx?: Tx): Promise<FoodCartRecord>;
  get(id: string, tx?: Tx): Promise<FoodCartRecord | null>;
  byOrg(orgId: string, tx?: Tx): Promise<FoodCartRecord | null>;
  inCity(cityId: string, tx?: Tx): Promise<FoodCartRecord[]>;
  update(id: string, patch: FoodCartPatch, tx?: Tx): Promise<FoodCartRecord>;

  /** Of `cartIds`, the ones `personId` follows. */
  followed(personId: string, cartIds: readonly string[], tx?: Tx): Promise<Set<string>>;
  followerCounts(cartIds: readonly string[], tx?: Tx): Promise<Map<string, number>>;
  followerIds(cartId: string, tx?: Tx): Promise<string[]>;
  followCount(personId: string, tx?: Tx): Promise<number>;
  setFollow(personId: string, cartId: string, on: boolean, at: Date, tx?: Tx): Promise<void>;

  createWalkup(input: Omit<WalkupRecord, 'id'>, tx?: Tx): Promise<WalkupRecord>;
  walkup(id: string, tx?: Tx): Promise<WalkupRecord | null>;
  /** The cart's tickets in `states`, oldest first. */
  walkupsOfCart(cartId: string, states: readonly WalkupState[], tx?: Tx): Promise<WalkupRecord[]>;
  /** The person's tickets placed since `since`, newest first. */
  walkupsOfPerson(personId: string, since: Date, tx?: Tx): Promise<WalkupRecord[]>;
  /** Applies `patch` only while the ticket is in one of `from`; null when it no longer is. */
  updateWalkup(id: string, from: readonly WalkupState[], patch: WalkupPatch, tx?: Tx): Promise<WalkupRecord | null>;
  /** Tickets collected at the cart since `since`: how many and their cash. */
  collectedSince(cartId: string, since: Date, tx?: Tx): Promise<{ count: number; cashIqd: number }>;
}

export const FOOD_CARTS_REPOSITORY = Symbol('FOOD_CARTS_REPOSITORY');

const copyCart = (c: FoodCartRecord): FoodCartRecord => ({ ...c, spot: c.spot ? { ...c.spot } : null });
const copyWalkup = (w: WalkupRecord): WalkupRecord => ({ ...w, lines: w.lines.map((l) => ({ ...l })) });

export class InMemoryFoodCartsRepository implements FoodCartsRepository {
  readonly carts: FoodCartRecord[] = [];
  readonly follows = new Map<string, Date>();
  readonly walkups: WalkupRecord[] = [];
  private seq = 0;

  private key(personId: string, cartId: string): string {
    return `${personId}|${cartId}`;
  }

  async create(input: Omit<FoodCartRecord, 'id' | 'createdAt'>): Promise<FoodCartRecord> {
    const c: FoodCartRecord = { ...input, id: `cart_${++this.seq}`, createdAt: new Date() };
    this.carts.push(c);
    return copyCart(c);
  }

  async get(id: string): Promise<FoodCartRecord | null> {
    const c = this.carts.find((x) => x.id === id);
    return c ? copyCart(c) : null;
  }

  async byOrg(orgId: string): Promise<FoodCartRecord | null> {
    const c = this.carts.find((x) => x.orgId === orgId);
    return c ? copyCart(c) : null;
  }

  async inCity(cityId: string): Promise<FoodCartRecord[]> {
    return this.carts.filter((c) => c.cityId === cityId).map(copyCart);
  }

  async update(id: string, patch: FoodCartPatch): Promise<FoodCartRecord> {
    const c = this.carts.find((x) => x.id === id);
    if (!c) throw new Error(`food cart ${id} not found`);
    Object.assign(c, patch);
    return copyCart(c);
  }

  async followed(personId: string, cartIds: readonly string[]): Promise<Set<string>> {
    return new Set(cartIds.filter((id) => this.follows.has(this.key(personId, id))));
  }

  async followerCounts(cartIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>(cartIds.map((id) => [id, 0]));
    for (const k of this.follows.keys()) {
      const cartId = k.slice(k.indexOf('|') + 1);
      if (out.has(cartId)) out.set(cartId, out.get(cartId)! + 1);
    }
    return out;
  }

  async followerIds(cartId: string): Promise<string[]> {
    return [...this.follows.keys()].filter((k) => k.endsWith(`|${cartId}`)).map((k) => k.slice(0, k.indexOf('|')));
  }

  async followCount(personId: string): Promise<number> {
    return [...this.follows.keys()].filter((k) => k.startsWith(`${personId}|`)).length;
  }

  async setFollow(personId: string, cartId: string, on: boolean, at: Date): Promise<void> {
    const k = this.key(personId, cartId);
    if (on) {
      if (!this.follows.has(k)) this.follows.set(k, at);
    } else this.follows.delete(k);
  }

  async createWalkup(input: Omit<WalkupRecord, 'id'>): Promise<WalkupRecord> {
    const w: WalkupRecord = { ...input, id: `wlk_${++this.seq}`, lines: input.lines.map((l) => ({ ...l })) };
    this.walkups.push(w);
    return copyWalkup(w);
  }

  async walkup(id: string): Promise<WalkupRecord | null> {
    const w = this.walkups.find((x) => x.id === id);
    return w ? copyWalkup(w) : null;
  }

  async walkupsOfCart(cartId: string, states: readonly WalkupState[]): Promise<WalkupRecord[]> {
    return this.walkups
      .filter((w) => w.cartId === cartId && states.includes(w.state))
      .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime())
      .map(copyWalkup);
  }

  async walkupsOfPerson(personId: string, since: Date): Promise<WalkupRecord[]> {
    return this.walkups
      .filter((w) => w.personId === personId && w.placedAt.getTime() >= since.getTime())
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
      .map(copyWalkup);
  }

  async updateWalkup(id: string, from: readonly WalkupState[], patch: WalkupPatch, tx?: Tx): Promise<WalkupRecord | null> {
    const w = this.walkups.find((x) => x.id === id);
    if (!w || !from.includes(w.state)) return null;
    // Undone if the transaction rolls back, like a database row.
    const was = copyWalkup(w);
    onRollback(tx, () => void Object.assign(w, was));
    Object.assign(w, patch);
    return copyWalkup(w);
  }

  async collectedSince(cartId: string, since: Date): Promise<{ count: number; cashIqd: number }> {
    const done = this.walkups.filter((w) => w.cartId === cartId && w.state === 'collected' && w.collectedAt && w.collectedAt.getTime() >= since.getTime());
    return { count: done.length, cashIqd: done.reduce((s, w) => s + w.totalIqd, 0) };
  }
}

type CartRow = {
  id: string;
  orgId: string;
  cityId: string;
  kind: string;
  spotLat: number | null;
  spotLng: number | null;
  spotLabel: string | null;
  facing: number;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  usualFrom: string | null;
  usualTo: string | null;
  awayNote: string | null;
  createdAt: Date;
};

type WalkupRow = Omit<WalkupRecord, 'state' | 'lines'> & { state: string; lines: unknown };

function cartOf(r: CartRow): FoodCartRecord {
  return {
    id: r.id,
    orgId: r.orgId,
    cityId: r.cityId,
    kind: r.kind as CartKind,
    spot: r.spotLat !== null && r.spotLng !== null ? { lat: r.spotLat, lng: r.spotLng, label: r.spotLabel, facing: r.facing } : null,
    openedAt: r.openedAt,
    closesAt: r.closesAt,
    closedAt: r.closedAt,
    usualFrom: r.usualFrom,
    usualTo: r.usualTo,
    awayNote: r.awayNote,
    createdAt: r.createdAt,
  };
}

function cartData(patch: FoodCartPatch): Record<string, unknown> {
  const { spot, ...rest } = patch;
  if (spot === undefined) return rest;
  return {
    ...rest,
    spotLat: spot?.lat ?? null,
    spotLng: spot?.lng ?? null,
    spotLabel: spot?.label ?? null,
    ...(spot ? { facing: Math.round(spot.facing) } : {}),
  };
}

function walkupOf(r: WalkupRow): WalkupRecord {
  return { ...r, state: r.state as WalkupState, lines: (Array.isArray(r.lines) ? r.lines : []) as WalkupLine[] };
}

export class PrismaFoodCartsRepository implements FoodCartsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma.prisma;
  }

  async create(input: Omit<FoodCartRecord, 'id' | 'createdAt'>, tx?: Tx): Promise<FoodCartRecord> {
    const { orgId, cityId, kind, ...rest } = input;
    const row = await this.db(tx).foodCart.create({ data: { orgId, cityId, kind, ...cartData(rest) } as never });
    return cartOf(row);
  }

  async get(id: string, tx?: Tx): Promise<FoodCartRecord | null> {
    const row = await this.db(tx).foodCart.findUnique({ where: { id } });
    return row ? cartOf(row) : null;
  }

  async byOrg(orgId: string, tx?: Tx): Promise<FoodCartRecord | null> {
    const row = await this.db(tx).foodCart.findUnique({ where: { orgId } });
    return row ? cartOf(row) : null;
  }

  async inCity(cityId: string, tx?: Tx): Promise<FoodCartRecord[]> {
    return (await this.db(tx).foodCart.findMany({ where: { cityId }, orderBy: { createdAt: 'asc' } })).map(cartOf);
  }

  async update(id: string, patch: FoodCartPatch, tx?: Tx): Promise<FoodCartRecord> {
    return cartOf(await this.db(tx).foodCart.update({ where: { id }, data: cartData(patch) }));
  }

  async followed(personId: string, cartIds: readonly string[], tx?: Tx): Promise<Set<string>> {
    if (cartIds.length === 0) return new Set();
    const rows = await this.db(tx).foodCartFollow.findMany({ where: { personId, cartId: { in: [...cartIds] } }, select: { cartId: true } });
    return new Set(rows.map((r) => r.cartId));
  }

  async followerCounts(cartIds: readonly string[], tx?: Tx): Promise<Map<string, number>> {
    const out = new Map<string, number>(cartIds.map((id) => [id, 0]));
    if (cartIds.length === 0) return out;
    const rows = await this.db(tx).foodCartFollow.groupBy({ by: ['cartId'], where: { cartId: { in: [...cartIds] } }, _count: { _all: true } });
    for (const r of rows) out.set(r.cartId, r._count._all);
    return out;
  }

  async followerIds(cartId: string, tx?: Tx): Promise<string[]> {
    return (await this.db(tx).foodCartFollow.findMany({ where: { cartId }, select: { personId: true } })).map((r) => r.personId);
  }

  async followCount(personId: string, tx?: Tx): Promise<number> {
    return this.db(tx).foodCartFollow.count({ where: { personId } });
  }

  async setFollow(personId: string, cartId: string, on: boolean, at: Date, tx?: Tx): Promise<void> {
    if (on) await this.db(tx).foodCartFollow.upsert({ where: { personId_cartId: { personId, cartId } }, create: { personId, cartId, createdAt: at }, update: {} });
    else await this.db(tx).foodCartFollow.deleteMany({ where: { personId, cartId } });
  }

  async createWalkup(input: Omit<WalkupRecord, 'id'>, tx?: Tx): Promise<WalkupRecord> {
    return walkupOf(await this.db(tx).foodCartWalkup.create({ data: { ...input, lines: input.lines } }));
  }

  async walkup(id: string, tx?: Tx): Promise<WalkupRecord | null> {
    const row = await this.db(tx).foodCartWalkup.findUnique({ where: { id } });
    return row ? walkupOf(row) : null;
  }

  async walkupsOfCart(cartId: string, states: readonly WalkupState[], tx?: Tx): Promise<WalkupRecord[]> {
    return (await this.db(tx).foodCartWalkup.findMany({ where: { cartId, state: { in: [...states] } }, orderBy: { placedAt: 'asc' } })).map(walkupOf);
  }

  async walkupsOfPerson(personId: string, since: Date, tx?: Tx): Promise<WalkupRecord[]> {
    return (await this.db(tx).foodCartWalkup.findMany({ where: { personId, placedAt: { gte: since } }, orderBy: { placedAt: 'desc' }, take: 50 })).map(walkupOf);
  }

  async updateWalkup(id: string, from: readonly WalkupState[], patch: WalkupPatch, tx?: Tx): Promise<WalkupRecord | null> {
    const res = await this.db(tx).foodCartWalkup.updateMany({ where: { id, state: { in: [...from] } }, data: patch });
    if (res.count === 0) return null;
    return this.walkup(id, tx);
  }

  async collectedSince(cartId: string, since: Date, tx?: Tx): Promise<{ count: number; cashIqd: number }> {
    const agg = await this.db(tx).foodCartWalkup.aggregate({ where: { cartId, state: 'collected', collectedAt: { gte: since } }, _count: { _all: true }, _sum: { totalIqd: true } });
    return { count: agg._count._all, cashIqd: agg._sum.totalIqd ?? 0 };
  }
}
