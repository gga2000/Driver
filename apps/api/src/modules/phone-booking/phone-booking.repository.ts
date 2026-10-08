import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One ride staff booked by phone (`phone_bookings`). Ids and landmark names only; the number stays in the vault. */
export interface PhoneBookingRecord {
  id: string;
  orderId: string;
  cityId: string;
  /** The caller's person (the order's orderer). */
  personId: string;
  /** The staff member who took the call. */
  bookedBy: string;
  vertical: 'taxi' | 'tuktuk';
  pickupId: string;
  pickupName: string;
  dropoffId: string;
  dropoffName: string;
  createdAt: Date;
}

export type NewPhoneBooking = Omit<PhoneBookingRecord, 'id'>;

/** `phone_bookings`: Prisma when DATABASE_URL is set, in memory otherwise. One row per order. */
export interface PhoneBookingsRepository {
  /** Idempotent per order: a retried booking gets the first row back. */
  add(b: NewPhoneBooking, tx?: Tx): Promise<PhoneBookingRecord>;
  byOrder(orderId: string, tx?: Tx): Promise<PhoneBookingRecord | null>;
  /** A city's bookings made in [from, to), newest first. */
  inCity(cityId: string, from: Date, to: Date): Promise<PhoneBookingRecord[]>;
  /** How many rides were booked by phone for this person before `before`. */
  countForPerson(personId: string, before: Date): Promise<number>;
  /** W7 account deletion: the place names said on his calls (his home, his street) are blanked. Idempotent. */
  blankPlacesOf(personId: string): Promise<void>;
}

export const PHONE_BOOKINGS_REPOSITORY = Symbol('PHONE_BOOKINGS_REPOSITORY');

const verticalOf = (v: string): 'taxi' | 'tuktuk' => (v === 'tuktuk' ? 'tuktuk' : 'taxi');

export class InMemoryPhoneBookingsRepository implements PhoneBookingsRepository {
  private readonly rows = new Map<string, PhoneBookingRecord>();

  async add(b: NewPhoneBooking): Promise<PhoneBookingRecord> {
    const existing = this.rows.get(b.orderId);
    if (existing) return { ...existing };
    const row = { ...b, id: randomUUID() };
    this.rows.set(b.orderId, row);
    return { ...row };
  }

  async byOrder(orderId: string): Promise<PhoneBookingRecord | null> {
    const r = this.rows.get(orderId);
    return r ? { ...r } : null;
  }

  async inCity(cityId: string, from: Date, to: Date): Promise<PhoneBookingRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.cityId === cityId && r.createdAt.getTime() >= from.getTime() && r.createdAt.getTime() < to.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async countForPerson(personId: string, before: Date): Promise<number> {
    return [...this.rows.values()].filter((r) => r.personId === personId && r.createdAt.getTime() < before.getTime()).length;
  }

  async blankPlacesOf(personId: string): Promise<void> {
    for (const r of this.rows.values()) if (r.personId === personId) Object.assign(r, { pickupName: '', dropoffName: '' });
  }
}

type Row = {
  id: string;
  orderId: string;
  cityId: string;
  personId: string;
  bookedBy: string;
  vertical: string;
  pickupId: string;
  pickupName: string;
  dropoffId: string;
  dropoffName: string;
  createdAt: Date;
};

const fromRow = (r: Row): PhoneBookingRecord => ({
  id: r.id,
  orderId: r.orderId,
  cityId: r.cityId,
  personId: r.personId,
  bookedBy: r.bookedBy,
  vertical: verticalOf(r.vertical),
  pickupId: r.pickupId,
  pickupName: r.pickupName,
  dropoffId: r.dropoffId,
  dropoffName: r.dropoffName,
  createdAt: r.createdAt,
});

export class PrismaPhoneBookingsRepository implements PhoneBookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async add(b: NewPhoneBooking, tx?: Tx): Promise<PhoneBookingRecord> {
    const row = await this.db(tx).phoneBooking.upsert({
      where: { orderId: b.orderId },
      create: { ...b, updatedAt: b.createdAt },
      update: {},
    });
    return fromRow(row);
  }

  async byOrder(orderId: string, tx?: Tx): Promise<PhoneBookingRecord | null> {
    const row = await this.db(tx).phoneBooking.findUnique({ where: { orderId } });
    return row ? fromRow(row) : null;
  }

  async inCity(cityId: string, from: Date, to: Date): Promise<PhoneBookingRecord[]> {
    const rows = await this.prisma.prisma.phoneBooking.findMany({ where: { cityId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'desc' } });
    return rows.map(fromRow);
  }

  async countForPerson(personId: string, before: Date): Promise<number> {
    return this.prisma.prisma.phoneBooking.count({ where: { personId, createdAt: { lt: before } } });
  }

  async blankPlacesOf(personId: string): Promise<void> {
    await this.prisma.prisma.phoneBooking.updateMany({ where: { personId }, data: { pickupName: '', dropoffName: '' } });
  }
}
