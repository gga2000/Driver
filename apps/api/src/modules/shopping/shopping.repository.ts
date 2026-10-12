import { randomUUID } from 'node:crypto';
import type { DeliveryPoint } from '@driver/contracts';
import type { DailyBreadTime } from '@driver/contracts/shopping';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One item's morning «أسعار اليوم» on a local day (`shop_day_posts`). */
export interface DayPostRecord {
  orgId: string;
  itemId: string;
  /** Baghdad date, YYYY-MM-DD. */
  localDate: string;
  priceIqd: number;
  photoUrl: string | null;
  fromYesterday: boolean;
  available: boolean;
  postedAt: Date;
}

/** «صمون كل يوم» (`shop_daily_bread`). */
export interface DailyBreadRecord {
  id: string;
  personId: string;
  cityId: string;
  orgId: string;
  itemId: string;
  packs: number;
  time: DailyBreadTime;
  days: number[];
  dropoff: DeliveryPoint;
  courierNote: string | null;
  paused: boolean;
  lastPlacedOn: string | null;
  createdAt: Date;
}

export type DailyBreadPatchRecord = Partial<
  Pick<DailyBreadRecord, 'packs' | 'time' | 'days' | 'paused'>
>;

export interface ShoppingRepository {
  /** Inserts or replaces the post of each item on its day. */
  savePosts(posts: readonly DayPostRecord[], tx?: Tx): Promise<void>;
  /** `orgId`'s posts on any of `dates`. */
  postsOn(orgId: string, dates: readonly string[], tx?: Tx): Promise<DayPostRecord[]>;
  /** The newest photo each item was posted with (any day), by item id. */
  lastPhotos(orgId: string, tx?: Tx): Promise<Map<string, string>>;

  createDailyBread(
    input: Omit<DailyBreadRecord, 'id' | 'createdAt' | 'lastPlacedOn' | 'paused'>,
    tx?: Tx,
  ): Promise<DailyBreadRecord>;
  dailyBread(id: string, tx?: Tx): Promise<DailyBreadRecord | null>;
  dailyBreadOf(personId: string, tx?: Tx): Promise<DailyBreadRecord[]>;
  dailyBreadOfOrg(orgId: string, tx?: Tx): Promise<DailyBreadRecord[]>;
  /** Active standing orders delivered at `time`. */
  dailyBreadAt(time: DailyBreadTime, tx?: Tx): Promise<DailyBreadRecord[]>;
  updateDailyBread(id: string, patch: DailyBreadPatchRecord, tx?: Tx): Promise<DailyBreadRecord>;
  deleteDailyBread(id: string, tx?: Tx): Promise<void>;
  /** Marks `id` placed on `localDate` unless it already was: true when this call claimed the day. */
  claimDay(id: string, localDate: string, tx?: Tx): Promise<boolean>;
}

export const SHOPPING_REPOSITORY = Symbol('SHOPPING_REPOSITORY');

const copyBread = (r: DailyBreadRecord): DailyBreadRecord => ({
  ...r,
  days: [...r.days],
  dropoff: { ...r.dropoff },
});

export class InMemoryShoppingRepository implements ShoppingRepository {
  private readonly posts = new Map<string, DayPostRecord>();
  private readonly bread = new Map<string, DailyBreadRecord>();

  async savePosts(posts: readonly DayPostRecord[]): Promise<void> {
    for (const p of posts) this.posts.set(`${p.itemId}|${p.localDate}`, { ...p });
  }

  async postsOn(orgId: string, dates: readonly string[]): Promise<DayPostRecord[]> {
    return [...this.posts.values()]
      .filter((p) => p.orgId === orgId && dates.includes(p.localDate))
      .map((p) => ({ ...p }));
  }

  async lastPhotos(orgId: string): Promise<Map<string, string>> {
    const out = new Map<string, { at: number; url: string }>();
    for (const p of this.posts.values()) {
      if (p.orgId !== orgId || !p.photoUrl) continue;
      const prev = out.get(p.itemId);
      if (!prev || prev.at < p.postedAt.getTime())
        out.set(p.itemId, { at: p.postedAt.getTime(), url: p.photoUrl });
    }
    return new Map([...out].map(([k, v]) => [k, v.url]));
  }

  async createDailyBread(
    input: Omit<DailyBreadRecord, 'id' | 'createdAt' | 'lastPlacedOn' | 'paused'>,
  ): Promise<DailyBreadRecord> {
    const r: DailyBreadRecord = {
      ...input,
      id: randomUUID(),
      paused: false,
      lastPlacedOn: null,
      createdAt: new Date(),
    };
    this.bread.set(r.id, r);
    return copyBread(r);
  }

  async dailyBread(id: string): Promise<DailyBreadRecord | null> {
    const r = this.bread.get(id);
    return r ? copyBread(r) : null;
  }

  async dailyBreadOf(personId: string): Promise<DailyBreadRecord[]> {
    return [...this.bread.values()]
      .filter((r) => r.personId === personId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(copyBread);
  }

  async dailyBreadOfOrg(orgId: string): Promise<DailyBreadRecord[]> {
    return [...this.bread.values()].filter((r) => r.orgId === orgId).map(copyBread);
  }

  async dailyBreadAt(time: DailyBreadTime): Promise<DailyBreadRecord[]> {
    return [...this.bread.values()].filter((r) => r.time === time && !r.paused).map(copyBread);
  }

  async updateDailyBread(id: string, patch: DailyBreadPatchRecord): Promise<DailyBreadRecord> {
    const r = this.bread.get(id);
    if (!r) throw new Error(`daily bread ${id} not found`);
    Object.assign(r, patch);
    return copyBread(r);
  }

  async deleteDailyBread(id: string): Promise<void> {
    this.bread.delete(id);
  }

  async claimDay(id: string, localDate: string): Promise<boolean> {
    const r = this.bread.get(id);
    if (!r || r.lastPlacedOn === localDate) return false;
    r.lastPlacedOn = localDate;
    return true;
  }
}

type BreadRow = Omit<DailyBreadRecord, 'time' | 'dropoff'> & { time: string; dropoff: unknown };

const breadOf = (r: BreadRow): DailyBreadRecord => ({
  ...r,
  time: r.time as DailyBreadTime,
  days: [...r.days],
  dropoff: r.dropoff as DeliveryPoint,
});

export class PrismaShoppingRepository implements ShoppingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma.prisma;
  }

  async savePosts(posts: readonly DayPostRecord[], tx?: Tx): Promise<void> {
    for (const p of posts) {
      const { itemId, localDate, ...rest } = p;
      await this.db(tx).shopDayPost.upsert({
        where: { itemId_localDate: { itemId, localDate } },
        create: { itemId, localDate, ...rest },
        update: rest,
      });
    }
  }

  async postsOn(orgId: string, dates: readonly string[], tx?: Tx): Promise<DayPostRecord[]> {
    const rows = await this.db(tx).shopDayPost.findMany({
      where: { orgId, localDate: { in: [...dates] } },
    });
    return rows.map(({ id: _id, ...r }) => r);
  }

  async lastPhotos(orgId: string, tx?: Tx): Promise<Map<string, string>> {
    const rows = await this.db(tx).shopDayPost.findMany({
      where: { orgId, photoUrl: { not: null } },
      orderBy: { postedAt: 'desc' },
      distinct: ['itemId'],
      select: { itemId: true, photoUrl: true },
    });
    return new Map(rows.map((r) => [r.itemId, r.photoUrl!]));
  }

  async createDailyBread(
    input: Omit<DailyBreadRecord, 'id' | 'createdAt' | 'lastPlacedOn' | 'paused'>,
    tx?: Tx,
  ): Promise<DailyBreadRecord> {
    return breadOf(
      await this.db(tx).shopDailyBread.create({
        data: { ...input, dropoff: input.dropoff as never },
      }),
    );
  }

  async dailyBread(id: string, tx?: Tx): Promise<DailyBreadRecord | null> {
    const r = await this.db(tx).shopDailyBread.findUnique({ where: { id } });
    return r ? breadOf(r) : null;
  }

  async dailyBreadOf(personId: string, tx?: Tx): Promise<DailyBreadRecord[]> {
    return (
      await this.db(tx).shopDailyBread.findMany({
        where: { personId },
        orderBy: { createdAt: 'asc' },
      })
    ).map(breadOf);
  }

  async dailyBreadOfOrg(orgId: string, tx?: Tx): Promise<DailyBreadRecord[]> {
    return (await this.db(tx).shopDailyBread.findMany({ where: { orgId } })).map(breadOf);
  }

  async dailyBreadAt(time: DailyBreadTime, tx?: Tx): Promise<DailyBreadRecord[]> {
    return (await this.db(tx).shopDailyBread.findMany({ where: { time, paused: false } })).map(
      breadOf,
    );
  }

  async updateDailyBread(
    id: string,
    patch: DailyBreadPatchRecord,
    tx?: Tx,
  ): Promise<DailyBreadRecord> {
    return breadOf(await this.db(tx).shopDailyBread.update({ where: { id }, data: patch }));
  }

  async deleteDailyBread(id: string, tx?: Tx): Promise<void> {
    await this.db(tx).shopDailyBread.deleteMany({ where: { id } });
  }

  async claimDay(id: string, localDate: string, tx?: Tx): Promise<boolean> {
    const r = await this.db(tx).shopDailyBread.updateMany({
      where: { id, OR: [{ lastPlacedOn: null }, { lastPlacedOn: { not: localDate } }] },
      data: { lastPlacedOn: localDate },
    });
    return r.count === 1;
  }
}
