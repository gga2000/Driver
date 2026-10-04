import type { DispatchOfferState } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One row of `dispatch_offers`: a single driver's offer for a trip, with its wave/pass and compensation. */
export interface OfferRecord {
  id: string;
  tripId: string;
  driverId: string;
  /** smart_broadcast | auto_assign | pre_assigned | override */
  policy: string;
  wave: number;
  pass: number;
  state: DispatchOfferState;
  rank: number | null;
  distanceKm: number | null;
  compensationIqd: number;
  sentAt: Date;
  seenAt: Date | null;
  respondedAt: Date | null;
  expiresAt: Date;
}

export type NewOffer = Omit<OfferRecord, 'id' | 'state' | 'seenAt' | 'respondedAt'>;
export type OfferPatch = Partial<Pick<OfferRecord, 'state' | 'seenAt' | 'respondedAt'>>;

/**
 * Persistence of `DispatchOffer`. Only dispatch reads or writes this table. `updateOffer` is a
 * compare-and-set on state so a late timer can never overwrite an accept (and vice versa).
 */
export interface DispatchRepository {
  createOffers(offers: NewOffer[], tx?: Tx): Promise<OfferRecord[]>;
  getOffer(id: string, tx?: Tx): Promise<OfferRecord | null>;
  /** Applies `patch` only while the offer is in one of `from`; returns the updated row or null. */
  updateOffer(id: string, from: readonly DispatchOfferState[], patch: OfferPatch, tx?: Tx): Promise<OfferRecord | null>;
  listByTrip(tripId: string, tx?: Tx): Promise<OfferRecord[]>;
  /** Offers accepted at or after `since` (the Console's time-to-accept). */
  acceptedSince(since: Date, tx?: Tx): Promise<OfferRecord[]>;
  /** Offers sent at or after `since`, any state (launch wall acceptance rate). */
  sentSince(since: Date, tx?: Tx): Promise<OfferRecord[]>;
}

export const DISPATCH_REPOSITORY = Symbol('DISPATCH_REPOSITORY');

export const OPEN_STATES: readonly DispatchOfferState[] = ['sent', 'seen'];

// ───────────────────────── Prisma ─────────────────────────

export class PrismaDispatchRepository implements DispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async createOffers(offers: NewOffer[], tx?: Tx): Promise<OfferRecord[]> {
    const out: OfferRecord[] = [];
    for (const o of offers) out.push((await this.db(tx).dispatchOffer.create({ data: { ...o } })) as OfferRecord);
    return out;
  }

  async getOffer(id: string, tx?: Tx): Promise<OfferRecord | null> {
    return (await this.db(tx).dispatchOffer.findUnique({ where: { id } })) as OfferRecord | null;
  }

  async updateOffer(id: string, from: readonly DispatchOfferState[], patch: OfferPatch, tx?: Tx): Promise<OfferRecord | null> {
    const res = await this.db(tx).dispatchOffer.updateMany({ where: { id, state: { in: [...from] } }, data: patch });
    if (res.count === 0) return null;
    return this.getOffer(id, tx);
  }

  async listByTrip(tripId: string, tx?: Tx): Promise<OfferRecord[]> {
    return (await this.db(tx).dispatchOffer.findMany({ where: { tripId }, orderBy: [{ sentAt: 'asc' }, { rank: 'asc' }] })) as OfferRecord[];
  }

  async acceptedSince(since: Date, tx?: Tx): Promise<OfferRecord[]> {
    return (await this.db(tx).dispatchOffer.findMany({ where: { state: 'accepted', respondedAt: { gte: since } }, orderBy: { respondedAt: 'asc' } })) as OfferRecord[];
  }

  async sentSince(since: Date, tx?: Tx): Promise<OfferRecord[]> {
    return (await this.db(tx).dispatchOffer.findMany({ where: { sentAt: { gte: since } }, orderBy: { sentAt: 'asc' } })) as OfferRecord[];
  }
}

// ───────────────────────── In-memory ─────────────────────────

export class InMemoryDispatchRepository implements DispatchRepository {
  private readonly rows = new Map<string, OfferRecord>();

  /** Offer ids per trip, in creation order (the board reads every live trip's offers each poll). */
  private readonly byTrip = new Map<string, string[]>();

  private seq = 0;

  async createOffers(offers: NewOffer[]): Promise<OfferRecord[]> {
    return offers.map((o) => {
      this.seq += 1;
      const row: OfferRecord = { ...o, id: `do_${this.seq}`, state: 'sent', seenAt: null, respondedAt: null };
      this.rows.set(row.id, row);
      const ids = this.byTrip.get(row.tripId);
      if (ids) ids.push(row.id);
      else this.byTrip.set(row.tripId, [row.id]);
      return { ...row };
    });
  }

  async getOffer(id: string): Promise<OfferRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async updateOffer(id: string, from: readonly DispatchOfferState[], patch: OfferPatch): Promise<OfferRecord | null> {
    const row = this.rows.get(id);
    if (!row || !from.includes(row.state)) return null;
    Object.assign(row, patch);
    return { ...row };
  }

  async listByTrip(tripId: string): Promise<OfferRecord[]> {
    return (this.byTrip.get(tripId) ?? []).map((id) => ({ ...this.rows.get(id)! }));
  }

  async acceptedSince(since: Date): Promise<OfferRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.state === 'accepted' && r.respondedAt !== null && r.respondedAt.getTime() >= since.getTime())
      .map((r) => ({ ...r }));
  }

  async sentSince(since: Date): Promise<OfferRecord[]> {
    return [...this.rows.values()].filter((r) => r.sentAt.getTime() >= since.getTime()).map((r) => ({ ...r }));
  }

  all(): OfferRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
