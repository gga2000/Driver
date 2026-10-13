import type { DeliveryPoint, ParcelPayer, ParcelSize } from '@driver/contracts';
import { Prisma } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/**
 * One parcel (`parcel_sends`). No personal data: the receiver is a person id (the name lives in the
 * identity vault under `parcel:<id>`, the number with that person), the door token is stored hashed,
 * and the receipt code is a short delivery code like a night ride's start code.
 */
export interface ParcelRecord {
  id: string;
  cityId: string;
  senderId: string;
  clientRequestId: string;
  what: string;
  size: ParcelSize;
  declaredValueIqd: number;
  photoUploadId: string | null;
  recipientPersonId: string;
  pickup: DeliveryPoint;
  doorBy: 'receiver' | 'sender';
  /** The receiver's area as sent (prices the fare). */
  zoneKey: string;
  /** The door once set (by the receiver from the link, or by the sender when sending). */
  dropoff: DeliveryPoint | null;
  payer: ParcelPayer;
  fareIqd: number;
  courierNote: string | null;
  pin: string;
  doorTokenHash: string | null;
  doorDueAt: Date | null;
  doorSetAt: Date | null;
  /** The courier order, placed once the door is set. */
  orderId: string | null;
  /** Wrong receipt codes the courier typed; `pinVerifiedAt` once the right one was. */
  pinFails: number;
  pinVerifiedAt: Date | null;
  /** «رفضت تستلم»: the courier marked it refused at the door. */
  refusedAt: Date | null;
  /** When the door-link text goes (08:00 for a night link); null when none is planned. */
  doorTextDueAt: Date | null;
  /** The receiver's texts, once handed to notify (each at most once: notify's dedupe keys back it up). */
  doorTextedAt: Date | null;
  pinTextedAt: Date | null;
  /** The texted link's own token, hashed (made when the text goes; the sender's link keeps `doorTokenHash`). */
  textTokenHash: string | null;
  /** Over a daily text limit (or the day's SMS budget): no text for this parcel, the sender shares the link. */
  textCapped: boolean;
  /** The courier's photo at pickup (their own upload). */
  pickupPhotoUploadId: string | null;
  /** Trusted contact, household member or an earlier receiver of this sender: outside the sender's daily cap. */
  receiverKnown: boolean;
  /** `waiting_door` until the order is placed; `cancelled` if it never is. The rest follows the order. */
  stage: 'waiting_door' | 'placed' | 'cancelled';
  cancelledAt: Date | null;
  createdAt: Date;
}

export type ParcelPatch = Partial<Pick<ParcelRecord, 'dropoff' | 'doorSetAt' | 'orderId' | 'stage' | 'cancelledAt' | 'doorTokenHash' | 'fareIqd' | 'pinFails' | 'pinVerifiedAt' | 'refusedAt' | 'doorTextedAt' | 'pinTextedAt' | 'textTokenHash' | 'textCapped' | 'pickupPhotoUploadId'>>;

/** A text field an update may require to be still unset (claiming a text so it goes once). */
export type ParcelTextField = 'doorTextedAt' | 'pinTextedAt';

/** Whose texts today: one sender's to people outside his known circle, or one receiver's from everyone. */
export type ParcelTextScope = { senderId: string; strangersOnly: true } | { recipientPersonId: string };

export interface ParcelsRepository {
  create(input: Omit<ParcelRecord, 'id' | 'createdAt'> & { createdAt: Date }): Promise<ParcelRecord>;
  get(id: string): Promise<ParcelRecord | null>;
  byRequest(senderId: string, clientRequestId: string): Promise<ParcelRecord | null>;
  byDoorToken(tokenHash: string): Promise<ParcelRecord | null>;
  byOrder(orderId: string): Promise<ParcelRecord | null>;
  bySender(senderId: string, limit: number): Promise<ParcelRecord[]>;
  /** Parcels still waiting for a door whose time ran out by `now`. */
  lapsed(now: Date): Promise<ParcelRecord[]>;
  /**
   * Applies `patch` only while the parcel is at `stage` (and, with `unset`, while that text field is
   * still empty); null when it no longer is (a race lost).
   */
  update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch, unset?: ParcelTextField): Promise<ParcelRecord | null>;
  /** Waiting parcels whose door-link text is due by `now` and has not gone (nor been capped). */
  doorTextsDue(now: Date): Promise<ParcelRecord[]>;
  /** Placed parcels since `since` whose receipt code has not been texted (nor capped), not refused or handed over yet. */
  pinTextsDue(since: Date): Promise<ParcelRecord[]>;
  /** Parcels in `scope` whose first text to the receiver went at or after `since` (the daily caps). */
  textedSince(scope: ParcelTextScope, since: Date): Promise<number>;
  /** Did this person ever take a parcel from this sender with the receipt code (an earlier receiver)? */
  deliveredTo(senderId: string, recipientPersonId: string): Promise<boolean>;
}

/** When a parcel's first text to the receiver went (the door link, else the receipt code): what the caps count. */
export const firstTextAt = (p: Pick<ParcelRecord, 'doorTextedAt' | 'pinTextedAt'>): Date | null => p.doorTextedAt ?? p.pinTextedAt;

export const PARCELS_REPOSITORY = Symbol('PARCELS_REPOSITORY');

const copy = (p: ParcelRecord): ParcelRecord => ({ ...p, pickup: { ...p.pickup }, dropoff: p.dropoff ? { ...p.dropoff } : null });

export class InMemoryParcelsRepository implements ParcelsRepository {
  readonly rows: ParcelRecord[] = [];
  private seq = 0;

  async create(input: Omit<ParcelRecord, 'id' | 'createdAt'> & { createdAt: Date }): Promise<ParcelRecord> {
    const rec: ParcelRecord = { ...input, id: `parcel_${++this.seq}` };
    this.rows.push(copy(rec));
    return copy(rec);
  }
  async get(id: string): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.id === id);
    return r ? copy(r) : null;
  }
  async byRequest(senderId: string, clientRequestId: string): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.senderId === senderId && p.clientRequestId === clientRequestId);
    return r ? copy(r) : null;
  }
  async byDoorToken(tokenHash: string): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.doorTokenHash === tokenHash || p.textTokenHash === tokenHash);
    return r ? copy(r) : null;
  }
  async byOrder(orderId: string): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.orderId === orderId);
    return r ? copy(r) : null;
  }
  async bySender(senderId: string, limit: number): Promise<ParcelRecord[]> {
    return this.rows
      .filter((p) => p.senderId === senderId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(copy);
  }
  async lapsed(now: Date): Promise<ParcelRecord[]> {
    return this.rows.filter((p) => p.stage === 'waiting_door' && p.doorDueAt !== null && p.doorDueAt <= now).map(copy);
  }
  async update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch, unset?: ParcelTextField): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.id === id);
    if (!r || r.stage !== stage || (unset && r[unset] !== null)) return null;
    Object.assign(r, patch);
    return copy(r);
  }
  async doorTextsDue(now: Date): Promise<ParcelRecord[]> {
    return this.rows.filter((p) => p.stage === 'waiting_door' && p.doorTextDueAt !== null && p.doorTextDueAt <= now && p.doorTextedAt === null && !p.textCapped).map(copy);
  }
  async pinTextsDue(since: Date): Promise<ParcelRecord[]> {
    return this.rows
      .filter((p) => p.stage === 'placed' && p.pinTextedAt === null && !p.textCapped && !p.refusedAt && !p.pinVerifiedAt && p.doorSetAt !== null && p.doorSetAt >= since)
      .map(copy);
  }
  async textedSince(scope: ParcelTextScope, since: Date): Promise<number> {
    return this.rows.filter((p) => {
      const at = firstTextAt(p);
      if (!at || at < since) return false;
      return 'senderId' in scope ? p.senderId === scope.senderId && !p.receiverKnown : p.recipientPersonId === scope.recipientPersonId;
    }).length;
  }
  async deliveredTo(senderId: string, recipientPersonId: string): Promise<boolean> {
    return this.rows.some((p) => p.senderId === senderId && p.recipientPersonId === recipientPersonId && p.pinVerifiedAt !== null);
  }
}

type Row = Prisma.ParcelSendGetPayload<object>;

const fromRow = (r: Row): ParcelRecord => ({
  id: r.id,
  cityId: r.cityId,
  senderId: r.senderId,
  clientRequestId: r.clientRequestId,
  what: r.what,
  size: r.size as ParcelSize,
  declaredValueIqd: r.declaredValueIqd,
  photoUploadId: r.photoUploadId,
  recipientPersonId: r.recipientPersonId,
  pickup: r.pickup as unknown as DeliveryPoint,
  doorBy: r.doorBy as ParcelRecord['doorBy'],
  zoneKey: r.zoneKey,
  dropoff: (r.dropoff as unknown as DeliveryPoint | null) ?? null,
  payer: r.payer as ParcelPayer,
  fareIqd: r.fareIqd,
  courierNote: r.courierNote,
  pin: r.pin,
  doorTokenHash: r.doorTokenHash,
  doorDueAt: r.doorDueAt,
  doorSetAt: r.doorSetAt,
  orderId: r.orderId,
  pinFails: r.pinFails,
  pinVerifiedAt: r.pinVerifiedAt,
  refusedAt: r.refusedAt,
  doorTextDueAt: r.doorTextDueAt,
  doorTextedAt: r.doorTextedAt,
  pinTextedAt: r.pinTextedAt,
  textTokenHash: r.textTokenHash,
  textCapped: r.textCapped,
  pickupPhotoUploadId: r.pickupPhotoUploadId,
  receiverKnown: r.receiverKnown,
  stage: r.stage as ParcelRecord['stage'],
  cancelledAt: r.cancelledAt,
  createdAt: r.createdAt,
});

const json = (v: DeliveryPoint | null): Prisma.InputJsonValue | typeof Prisma.DbNull => (v === null ? Prisma.DbNull : (v as unknown as Prisma.InputJsonValue));

export class PrismaParcelsRepository implements ParcelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }

  async create(input: Omit<ParcelRecord, 'id' | 'createdAt'> & { createdAt: Date }): Promise<ParcelRecord> {
    const { pickup, dropoff, ...rest } = input;
    return fromRow(
      await this.db.parcelSend.create({
        data: { ...rest, pickup: pickup as unknown as Prisma.InputJsonValue, dropoff: json(dropoff) },
      }),
    );
  }
  async get(id: string): Promise<ParcelRecord | null> {
    const r = await this.db.parcelSend.findUnique({ where: { id } });
    return r ? fromRow(r) : null;
  }
  async byRequest(senderId: string, clientRequestId: string): Promise<ParcelRecord | null> {
    const r = await this.db.parcelSend.findUnique({ where: { senderId_clientRequestId: { senderId, clientRequestId } } });
    return r ? fromRow(r) : null;
  }
  async byDoorToken(tokenHash: string): Promise<ParcelRecord | null> {
    const r = await this.db.parcelSend.findFirst({ where: { OR: [{ doorTokenHash: tokenHash }, { textTokenHash: tokenHash }] } });
    return r ? fromRow(r) : null;
  }
  async byOrder(orderId: string): Promise<ParcelRecord | null> {
    const r = await this.db.parcelSend.findFirst({ where: { orderId } });
    return r ? fromRow(r) : null;
  }
  async bySender(senderId: string, limit: number): Promise<ParcelRecord[]> {
    return (await this.db.parcelSend.findMany({ where: { senderId }, orderBy: { createdAt: 'desc' }, take: limit })).map(fromRow);
  }
  async lapsed(now: Date): Promise<ParcelRecord[]> {
    return (await this.db.parcelSend.findMany({ where: { stage: 'waiting_door', doorDueAt: { lte: now } } })).map(fromRow);
  }
  async update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch, unset?: ParcelTextField): Promise<ParcelRecord | null> {
    const { dropoff, ...rest } = patch;
    const res = await this.db.parcelSend.updateMany({
      where: { id, stage, ...(unset ? { [unset]: null } : {}) },
      data: { ...rest, ...(dropoff !== undefined ? { dropoff: json(dropoff) } : {}) },
    });
    return res.count === 0 ? null : this.get(id);
  }
  async doorTextsDue(now: Date): Promise<ParcelRecord[]> {
    return (await this.db.parcelSend.findMany({ where: { stage: 'waiting_door', doorTextDueAt: { lte: now }, doorTextedAt: null, textCapped: false } })).map(fromRow);
  }
  async pinTextsDue(since: Date): Promise<ParcelRecord[]> {
    return (
      await this.db.parcelSend.findMany({ where: { stage: 'placed', pinTextedAt: null, textCapped: false, refusedAt: null, pinVerifiedAt: null, doorSetAt: { gte: since } } })
    ).map(fromRow);
  }
  async textedSince(scope: ParcelTextScope, since: Date): Promise<number> {
    const who = 'senderId' in scope ? { senderId: scope.senderId, receiverKnown: false } : { recipientPersonId: scope.recipientPersonId };
    return this.db.parcelSend.count({ where: { ...who, OR: [{ doorTextedAt: { gte: since } }, { doorTextedAt: null, pinTextedAt: { gte: since } }] } });
  }
  async deliveredTo(senderId: string, recipientPersonId: string): Promise<boolean> {
    return (await this.db.parcelSend.count({ where: { senderId, recipientPersonId, pinVerifiedAt: { not: null } }, take: 1 })) > 0;
  }
}
