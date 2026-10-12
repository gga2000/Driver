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
  /** `waiting_door` until the order is placed; `cancelled` if it never is. The rest follows the order. */
  stage: 'waiting_door' | 'placed' | 'cancelled';
  cancelledAt: Date | null;
  createdAt: Date;
}

export type ParcelPatch = Partial<Pick<ParcelRecord, 'dropoff' | 'doorSetAt' | 'orderId' | 'stage' | 'cancelledAt' | 'doorTokenHash' | 'fareIqd'>>;

export interface ParcelsRepository {
  create(input: Omit<ParcelRecord, 'id' | 'createdAt'> & { createdAt: Date }): Promise<ParcelRecord>;
  get(id: string): Promise<ParcelRecord | null>;
  byRequest(senderId: string, clientRequestId: string): Promise<ParcelRecord | null>;
  byDoorToken(tokenHash: string): Promise<ParcelRecord | null>;
  bySender(senderId: string, limit: number): Promise<ParcelRecord[]>;
  /** Parcels still waiting for a door whose time ran out by `now`. */
  lapsed(now: Date): Promise<ParcelRecord[]>;
  /** Applies `patch` only while the parcel is at `stage`; null when it no longer is (a race lost). */
  update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch): Promise<ParcelRecord | null>;
}

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
    const r = this.rows.find((p) => p.doorTokenHash === tokenHash);
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
  async update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch): Promise<ParcelRecord | null> {
    const r = this.rows.find((p) => p.id === id);
    if (!r || r.stage !== stage) return null;
    Object.assign(r, patch);
    return copy(r);
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
    const r = await this.db.parcelSend.findUnique({ where: { doorTokenHash: tokenHash } });
    return r ? fromRow(r) : null;
  }
  async bySender(senderId: string, limit: number): Promise<ParcelRecord[]> {
    return (await this.db.parcelSend.findMany({ where: { senderId }, orderBy: { createdAt: 'desc' }, take: limit })).map(fromRow);
  }
  async lapsed(now: Date): Promise<ParcelRecord[]> {
    return (await this.db.parcelSend.findMany({ where: { stage: 'waiting_door', doorDueAt: { lte: now } } })).map(fromRow);
  }
  async update(id: string, stage: ParcelRecord['stage'], patch: ParcelPatch): Promise<ParcelRecord | null> {
    const { dropoff, ...rest } = patch;
    const res = await this.db.parcelSend.updateMany({ where: { id, stage }, data: { ...rest, ...(dropoff !== undefined ? { dropoff: json(dropoff) } : {}) } });
    return res.count === 0 ? null : this.get(id);
  }
}
