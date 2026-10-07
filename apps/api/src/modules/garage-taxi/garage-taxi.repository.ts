import { randomUUID } from 'node:crypto';
import type { LatLng } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/**
 * One taxi linked to a الرجعة seat (`garage_taxis`). Ids, pins and times only: names stay in the vault.
 * - `to_garage` (x2/x3): the ride that takes him to the car's garage; `placed` while it may still
 *   matter to the car, `closed` once he boarded, the car left, or the ride ended or was cancelled.
 * - `from_garage` (x4/n10): the taxi armed to wait at the Aziziyah garage; `armed` until the server
 *   books it (`placed`), he takes it back (`disarmed`), the trip is cancelled (`dropped`) or booking
 *   it is refused (`failed`).
 */
export type GarageTaxiKind = 'to_garage' | 'from_garage';
export type GarageTaxiState = 'armed' | 'placed' | 'disarmed' | 'dropped' | 'failed' | 'closed';

export interface GarageTaxiRecord {
  id: string;
  kind: GarageTaxiKind;
  personId: string;
  bookingId: string;
  departureId: string;
  state: GarageTaxiState;
  orderId: string | null;
  /** The garage the ride starts or ends at (x4: set when it is booked). */
  garageId: string | null;
  /** His saved place: the pickup (x2) or the drop-off (x4). */
  placeId: string | null;
  /** x2 with a pin instead of a saved place: the pickup and its zone. */
  pin: LatLng | null;
  zoneId: string | null;
  paymentMethod: 'cash' | 'wallet';
  /** The car's announced time when linked. */
  departAt: Date;
  /** x2: when the taxi picks him up (null for a ride now) and the learned minutes to the garage. */
  pickupAt: Date | null;
  rideMin: number | null;
  /** x3: the latest expected arrival at the garage, how late that is, and what was last told. */
  expectedAt: Date | null;
  lateMin: number | null;
  toldMin: number | null;
  toldAt: Date | null;
  /** x4 `failed`: the refusal's code; `dropped`: why. */
  failCode: string | null;
  dropReason: string | null;
  placedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewGarageTaxi = Omit<GarageTaxiRecord, 'id' | 'createdAt' | 'updatedAt'>;

/** `garage_taxis`: Prisma when DATABASE_URL is set, in memory otherwise. One row per seat and kind. */
export interface GarageTaxisRepository {
  byBooking(bookingId: string, kind: GarageTaxiKind, tx?: Tx): Promise<GarageTaxiRecord | null>;
  byOrder(orderId: string, tx?: Tx): Promise<GarageTaxiRecord | null>;
  /** Creates the seat's row of that kind, or replaces it (a ride booked again after a cancel, re-arming). */
  put(rec: NewGarageTaxi & { id?: string }, now: Date, tx?: Tx): Promise<GarageTaxiRecord>;
  /** Rows of one kind in one state, oldest first: what the job looks at. */
  inState(kind: GarageTaxiKind, state: GarageTaxiState): Promise<GarageTaxiRecord[]>;
}

export const GARAGE_TAXIS_REPOSITORY = Symbol('GARAGE_TAXIS_REPOSITORY');

export class InMemoryGarageTaxisRepository implements GarageTaxisRepository {
  private readonly rows = new Map<string, GarageTaxiRecord>();

  async byBooking(bookingId: string, kind: GarageTaxiKind): Promise<GarageTaxiRecord | null> {
    const r = [...this.rows.values()].find((x) => x.bookingId === bookingId && x.kind === kind);
    return r ? clone(r) : null;
  }

  async byOrder(orderId: string): Promise<GarageTaxiRecord | null> {
    const r = [...this.rows.values()].find((x) => x.orderId === orderId);
    return r ? clone(r) : null;
  }

  async put(rec: NewGarageTaxi & { id?: string }, now: Date): Promise<GarageTaxiRecord> {
    const existing = rec.id ? this.rows.get(rec.id) : [...this.rows.values()].find((x) => x.bookingId === rec.bookingId && x.kind === rec.kind);
    const row: GarageTaxiRecord = { ...rec, id: existing?.id ?? rec.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.rows.set(row.id, clone(row));
    return clone(row);
  }

  async inState(kind: GarageTaxiKind, state: GarageTaxiState): Promise<GarageTaxiRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.kind === kind && r.state === state)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
}

function clone(r: GarageTaxiRecord): GarageTaxiRecord {
  return { ...r, pin: r.pin ? { ...r.pin } : null };
}

type Row = {
  id: string;
  kind: string;
  personId: string;
  bookingId: string;
  departureId: string;
  state: string;
  orderId: string | null;
  garageId: string | null;
  placeId: string | null;
  pinLat: number | null;
  pinLng: number | null;
  zoneId: string | null;
  paymentMethod: string;
  departAt: Date;
  pickupAt: Date | null;
  rideMin: number | null;
  expectedAt: Date | null;
  lateMin: number | null;
  toldMin: number | null;
  toldAt: Date | null;
  failCode: string | null;
  dropReason: string | null;
  placedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const fromRow = (r: Row): GarageTaxiRecord => ({
  id: r.id,
  kind: r.kind === 'from_garage' ? 'from_garage' : 'to_garage',
  personId: r.personId,
  bookingId: r.bookingId,
  departureId: r.departureId,
  state: r.state as GarageTaxiState,
  orderId: r.orderId,
  garageId: r.garageId,
  placeId: r.placeId,
  pin: r.pinLat !== null && r.pinLng !== null ? { lat: r.pinLat, lng: r.pinLng } : null,
  zoneId: r.zoneId,
  paymentMethod: r.paymentMethod === 'wallet' ? 'wallet' : 'cash',
  departAt: r.departAt,
  pickupAt: r.pickupAt,
  rideMin: r.rideMin,
  expectedAt: r.expectedAt,
  lateMin: r.lateMin,
  toldMin: r.toldMin,
  toldAt: r.toldAt,
  failCode: r.failCode,
  dropReason: r.dropReason,
  placedAt: r.placedAt,
  closedAt: r.closedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function toData(rec: NewGarageTaxi) {
  const { pin, ...rest } = rec;
  return { ...rest, pinLat: pin?.lat ?? null, pinLng: pin?.lng ?? null };
}

export class PrismaGarageTaxisRepository implements GarageTaxisRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async byBooking(bookingId: string, kind: GarageTaxiKind, tx?: Tx): Promise<GarageTaxiRecord | null> {
    const row = await this.db(tx).garageTaxi.findUnique({ where: { bookingId_kind: { bookingId, kind } } });
    return row ? fromRow(row) : null;
  }

  async byOrder(orderId: string, tx?: Tx): Promise<GarageTaxiRecord | null> {
    const row = await this.db(tx).garageTaxi.findFirst({ where: { orderId } });
    return row ? fromRow(row) : null;
  }

  async put(rec: NewGarageTaxi & { id?: string }, now: Date, tx?: Tx): Promise<GarageTaxiRecord> {
    const { id, ...fields } = rec;
    const data = toData(fields);
    // By id when the row is known (a seat moved to another car keeps its row), else by seat and kind.
    const row = await this.db(tx).garageTaxi.upsert({
      where: id ? { id } : { bookingId_kind: { bookingId: rec.bookingId, kind: rec.kind } },
      create: { ...(id ? { id } : {}), ...data, createdAt: now, updatedAt: now },
      update: { ...data, updatedAt: now },
    });
    return fromRow(row);
  }

  async inState(kind: GarageTaxiKind, state: GarageTaxiState): Promise<GarageTaxiRecord[]> {
    const rows = await this.prisma.prisma.garageTaxi.findMany({ where: { kind, state }, orderBy: { createdAt: 'asc' } });
    return rows.map(fromRow);
  }
}
