import type { AppliedDiscount, DeliveryPoint, OrderRating, OrderState, OrderType, ParticipantRole, PaymentMethod, RefundState, VehicleClass } from '@driver/contracts';
import { Prisma } from '@driver/db';
import { isAfterCursor, newestFirst } from './history.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/**
 * The orders module's persistence port: `orders`, `order_lines`, `participants` — its own tables
 * only. `PrismaOrdersRepository` is bound when DATABASE_URL is set; `InMemoryOrdersRepository`
 * (same contract) serves tests, the simulator and a database-less dev API.
 */

export interface OrderRecord {
  id: string;
  cityId: string;
  type: OrderType;
  state: OrderState;
  ordererId: string;
  merchantOrgId: string | null;
  householdOrgId: string | null;
  quoteId: string | null;
  paymentMethod: PaymentMethod;
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
  serviceFeeIqd: number;
  discountIqd: number;
  /** The server-resolved promotion behind `discountIqd` (`orders.promotion_id`); null = no discount. */
  promotionId: string | null;
  /** The discount line (`orders.discount_meta`): funder, what it comes off, labels. Absent on old rows = platform promo. */
  discountMeta?: DiscountMeta | null;
  tipIqd: number;
  totalIqd: number;
  receiptTotalIqd: number | null;
  refundState: RefundState;
  note: string | null;
  scheduledFor: Date | null;
  merchantOfferedAt: Date | null;
  promisedReadyAt: Date | null;
  minVehicleClass: VehicleClass | null;
  /** Customer's delivery point (`orders.dropoff`, JSON); dispatch builds the courier trip's drop-off stop from it. */
  dropoff: DeliveryPoint | null;
  placedAt: Date;
  acceptedAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  cancellationFeeIqd: number;
  ratedAt: Date | null;
  /** Customer app §4 two-tap rating (`orders.rating`, JSON); absent/null until rated. */
  rating?: OrderRating | null;
}

/** `orders.discount_meta`: the applied discount without its amount and promotion id (those are columns). */
export type DiscountMeta = Omit<AppliedDiscount, 'promotionId' | 'amountIqd'>;

/** Partial-accept marker kept in `order_lines.substitution` (review A.4). */
export interface LineUnavailability {
  kind: 'unavailable';
  state: 'proposed' | 'removed' | 'restored';
  proposedAt: string;
  prepMinutes: number;
  /** Merchant deal on the order: the discount the reduced basket keeps (set on the proposal; the approval uses it). */
  reducedDiscountIqd?: number;
}

export interface OrderLineRecord {
  id: string;
  orderId: string;
  catalogItemId: string | null;
  freeText: string | null;
  qty: number;
  unitPriceIqd: number;
  modifiers: Array<{ priceIqd?: number } & Record<string, unknown>>;
  participantId: string | null;
  note: string | null;
  pointsEligible: boolean;
  substitution: LineUnavailability | null;
}

export interface ParticipantRecord {
  id: string;
  orderId: string;
  role: ParticipantRole;
  personId: string | null;
  phoneHash: string | null;
  label: string | null;
  note: string | null;
}

export type NewOrder = Omit<
  OrderRecord,
  | 'id'
  | 'state'
  | 'acceptedAt'
  | 'preparingAt'
  | 'readyAt'
  | 'pickedUpAt'
  | 'deliveredAt'
  | 'closedAt'
  | 'cancelledAt'
  | 'cancellationReason'
  | 'cancellationFeeIqd'
  | 'ratedAt'
  | 'rating'
  | 'merchantOfferedAt'
  | 'promisedReadyAt'
  | 'refundState'
  | 'receiptTotalIqd'
>;

export type NewParticipant = Omit<ParticipantRecord, 'id' | 'orderId'> & { ref: string };
export type NewLine = Omit<OrderLineRecord, 'id' | 'orderId' | 'participantId' | 'substitution'> & { participantRef: string | null };
export type OrderPatch = Partial<Omit<OrderRecord, 'id' | 'cityId' | 'type' | 'ordererId' | 'placedAt'>>;

export interface OrderAggregate {
  order: OrderRecord;
  lines: OrderLineRecord[];
  participants: ParticipantRecord[];
}

export interface OrdersRepository {
  create(order: NewOrder, lines: readonly NewLine[], participants: readonly NewParticipant[], tx?: Tx): Promise<OrderAggregate>;
  find(id: string, tx?: Tx): Promise<OrderAggregate | null>;
  update(id: string, patch: OrderPatch, tx?: Tx): Promise<OrderRecord>;
  /** Conditional update (… WHERE state = expect); null when the order moved meanwhile. */
  updateIf(id: string, expectState: OrderState, patch: OrderPatch, tx?: Tx): Promise<OrderRecord | null>;
  updateLine(id: string, patch: { substitution: LineUnavailability | null }, tx?: Tx): Promise<OrderLineRecord>;
  findMany(filter: { cityId?: string; merchantOrgId?: string; states?: readonly OrderState[] }, tx?: Tx): Promise<OrderRecord[]>;
  /**
   * One merchant's orders placed in `[from, to)`, with their lines and participants, oldest first
   * (placedAt, id) — one bounded read on `(merchant_org_id, placed_at)` (review 2026-10-04 #11).
   */
  merchantOrdersBetween(merchantOrgId: string, from: Date, to: Date, tx?: Tx): Promise<OrderAggregate[]>;
  /** Orders a person placed or takes part in. */
  forPerson(personId: string, tx?: Tx): Promise<OrderRecord[]>;
  /** Console history: newest first (placedAt, id descending), strictly after `after`, at most `limit`. */
  search(filter: OrderSearchFilter, tx?: Tx): Promise<OrderRecord[]>;
  /** Orders placed in the city at or after `since`. */
  countPlacedSince(cityId: string, since: Date, tx?: Tx): Promise<number>;
}

export interface OrderSearchFilter {
  cityId: string;
  states?: readonly OrderState[] | undefined;
  type?: OrderType | undefined;
  merchantOrgId?: string | undefined;
  /** Case-insensitive substring of the order, orderer or merchant id, or the note. */
  text?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  after?: { placedAt: Date; id: string } | null | undefined;
  limit: number;
}

export const ORDERS_REPOSITORY = Symbol('ORDERS_REPOSITORY');

// ───────────────────────── Prisma implementation ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
function orderFromRow(r: any): OrderRecord {
  return {
    id: r.id,
    cityId: r.cityId,
    type: r.type,
    state: r.state,
    ordererId: r.ordererId,
    merchantOrgId: r.merchantOrgId,
    householdOrgId: r.householdOrgId,
    quoteId: r.quoteId,
    paymentMethod: r.paymentMethod,
    itemsTotalIqd: r.itemsTotalIqd,
    deliveryFeeIqd: r.deliveryFeeIqd,
    serviceFeeIqd: r.serviceFeeIqd,
    discountIqd: r.discountIqd,
    promotionId: r.promotionId ?? null,
    discountMeta: (r.discountMeta as DiscountMeta | null) ?? null,
    tipIqd: r.tipIqd,
    totalIqd: r.totalIqd,
    receiptTotalIqd: r.receiptTotalIqd,
    refundState: r.refundState,
    note: r.note,
    scheduledFor: r.scheduledFor,
    merchantOfferedAt: r.merchantOfferedAt,
    promisedReadyAt: r.promisedReadyAt,
    minVehicleClass: r.minVehicleClass,
    dropoff: (r.dropoff as DeliveryPoint | null) ?? null,
    placedAt: r.placedAt,
    acceptedAt: r.acceptedAt,
    preparingAt: r.preparingAt,
    readyAt: r.readyAt,
    pickedUpAt: r.pickedUpAt,
    deliveredAt: r.deliveredAt,
    closedAt: r.closedAt,
    cancelledAt: r.cancelledAt,
    cancellationReason: r.cancellationReason,
    cancellationFeeIqd: r.cancellationFeeIqd,
    ratedAt: r.ratedAt,
    rating: ratingFromJson(r.rating),
  };
}

function ratingFromJson(v: any): OrderRating | null {
  if (!v || typeof v !== 'object') return null;
  return { delivery: v.delivery ?? null, food: v.food ?? null, tags: Array.isArray(v.tags) ? v.tags : [], note: v.note ?? null, ratedAt: new Date(v.ratedAt) };
}

function lineFromRow(r: any): OrderLineRecord {
  return {
    id: r.id,
    orderId: r.orderId,
    catalogItemId: r.catalogItemId,
    freeText: r.freeText,
    qty: r.qty,
    unitPriceIqd: r.unitPriceIqd,
    modifiers: Array.isArray(r.modifiers) ? r.modifiers : [],
    participantId: r.participantId,
    note: r.note,
    pointsEligible: r.pointsEligible,
    substitution: (r.substitution as LineUnavailability | null) ?? null,
  };
}

function participantFromRow(r: any): ParticipantRecord {
  return { id: r.id, orderId: r.orderId, role: r.role, personId: r.personId, phoneHash: r.phoneHash, label: r.label, note: r.note };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A patch as Prisma wants it: JSON columns take `Prisma.DbNull`, not `null`. */
function toData(patch: OrderPatch) {
  const { dropoff, rating, discountMeta, ...rest } = patch;
  const data: Record<string, unknown> = dropoff === undefined ? rest : { ...rest, dropoff: dropoff ? (dropoff as unknown as Prisma.InputJsonObject) : Prisma.DbNull };
  if (discountMeta !== undefined) data['discountMeta'] = discountMeta ? (discountMeta as unknown as Prisma.InputJsonObject) : Prisma.DbNull;
  if (rating !== undefined) data['rating'] = rating ? ({ ...rating, ratedAt: rating.ratedAt.toISOString() } as unknown as Prisma.InputJsonObject) : Prisma.DbNull;
  return data;
}

/** Bound when DATABASE_URL is set. Touches only orders, order_lines and participants. */
export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(order: NewOrder, lines: readonly NewLine[], participants: readonly NewParticipant[], tx?: Tx): Promise<OrderAggregate> {
    const db = this.db(tx);
    const { discountMeta, ...fields } = order;
    const row = await db.order.create({
      data: {
        ...fields,
        dropoff: order.dropoff ? (order.dropoff as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
        discountMeta: discountMeta ? (discountMeta as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
      },
    });
    const byRef = new Map<string, string>();
    for (const p of participants) {
      const created = await db.participant.create({ data: { orderId: row.id, role: p.role, personId: p.personId, phoneHash: p.phoneHash, label: p.label, note: p.note } });
      byRef.set(p.ref, created.id);
    }
    for (const l of lines) {
      await db.orderLine.create({
        data: {
          orderId: row.id,
          catalogItemId: l.catalogItemId,
          freeText: l.freeText,
          qty: l.qty,
          unitPriceIqd: l.unitPriceIqd,
          modifiers: l.modifiers as object[],
          participantId: l.participantRef ? (byRef.get(l.participantRef) ?? null) : null,
          note: l.note,
          pointsEligible: l.pointsEligible,
        },
      });
    }
    return (await this.find(row.id, tx))!;
  }

  async find(id: string, tx?: Tx): Promise<OrderAggregate | null> {
    const row = await this.db(tx).order.findUnique({ where: { id }, include: { lines: { orderBy: { createdAt: 'asc' } }, participants: { orderBy: { createdAt: 'asc' } } } });
    if (!row) return null;
    return { order: orderFromRow(row), lines: row.lines.map(lineFromRow), participants: row.participants.map(participantFromRow) };
  }

  async update(id: string, patch: OrderPatch, tx?: Tx): Promise<OrderRecord> {
    return orderFromRow(await this.db(tx).order.update({ where: { id }, data: toData(patch) }));
  }

  async updateIf(id: string, expectState: OrderState, patch: OrderPatch, tx?: Tx): Promise<OrderRecord | null> {
    const res = await this.db(tx).order.updateMany({ where: { id, state: expectState }, data: toData(patch) });
    if (res.count === 0) return null;
    return (await this.find(id, tx))!.order;
  }

  async updateLine(id: string, patch: { substitution: LineUnavailability | null }, tx?: Tx): Promise<OrderLineRecord> {
    const row = await this.db(tx).orderLine.update({ where: { id }, data: { substitution: patch.substitution === null ? Prisma.DbNull : (patch.substitution as unknown as Prisma.InputJsonObject) } });
    return lineFromRow(row);
  }

  async findMany(filter: { cityId?: string; merchantOrgId?: string; states?: readonly OrderState[] }, tx?: Tx): Promise<OrderRecord[]> {
    const rows = await this.db(tx).order.findMany({
      where: {
        ...(filter.cityId ? { cityId: filter.cityId } : {}),
        ...(filter.merchantOrgId ? { merchantOrgId: filter.merchantOrgId } : {}),
        ...(filter.states ? { state: { in: [...filter.states] } } : {}),
      },
      orderBy: { placedAt: 'asc' },
    });
    return rows.map(orderFromRow);
  }

  async merchantOrdersBetween(merchantOrgId: string, from: Date, to: Date, tx?: Tx): Promise<OrderAggregate[]> {
    const rows = await this.db(tx).order.findMany({
      where: { merchantOrgId, placedAt: { gte: from, lt: to } },
      include: { lines: { orderBy: { createdAt: 'asc' } }, participants: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ order: orderFromRow(row), lines: row.lines.map(lineFromRow), participants: row.participants.map(participantFromRow) }));
  }

  async forPerson(personId: string, tx?: Tx): Promise<OrderRecord[]> {
    const rows = await this.db(tx).order.findMany({
      where: { OR: [{ ordererId: personId }, { participants: { some: { personId } } }] },
      orderBy: { placedAt: 'desc' },
    });
    return rows.map(orderFromRow);
  }

  async search(f: OrderSearchFilter, tx?: Tx): Promise<OrderRecord[]> {
    const and: Prisma.OrderWhereInput[] = [{ cityId: f.cityId }];
    if (f.states && f.states.length > 0) and.push({ state: { in: [...f.states] } });
    if (f.type) and.push({ type: f.type });
    if (f.merchantOrgId) and.push({ merchantOrgId: f.merchantOrgId });
    if (f.from || f.to) and.push({ placedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } });
    if (f.text) {
      const contains = { contains: f.text, mode: 'insensitive' as const };
      and.push({ OR: [{ id: contains }, { ordererId: contains }, { merchantOrgId: contains }, { note: contains }] });
    }
    if (f.after) and.push({ OR: [{ placedAt: { lt: f.after.placedAt } }, { placedAt: f.after.placedAt, id: { lt: f.after.id } }] });
    const rows = await this.db(tx).order.findMany({ where: { AND: and }, orderBy: [{ placedAt: 'desc' }, { id: 'desc' }], take: f.limit });
    return rows.map(orderFromRow);
  }

  async countPlacedSince(cityId: string, since: Date, tx?: Tx): Promise<number> {
    return this.db(tx).order.count({ where: { cityId, placedAt: { gte: since } } });
  }
}

// ───────────────────────── In-memory twin ─────────────────────────

export class InMemoryOrdersRepository implements OrdersRepository {
  readonly orders = new Map<string, OrderRecord>();
  readonly lines: OrderLineRecord[] = [];
  readonly participants: ParticipantRecord[] = [];
  private seq = 0;
  // Per-order indexes (the simulator reads every live order every tick).
  private readonly linesByOrder = new Map<string, OrderLineRecord[]>();
  private readonly participantsByOrder = new Map<string, ParticipantRecord[]>();

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async create(order: NewOrder, lines: readonly NewLine[], participants: readonly NewParticipant[]): Promise<OrderAggregate> {
    const record: OrderRecord = {
      ...order,
      id: this.id('ord'),
      state: 'placed',
      acceptedAt: null,
      preparingAt: null,
      readyAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      closedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      cancellationFeeIqd: 0,
      ratedAt: null,
      merchantOfferedAt: null,
      promisedReadyAt: null,
      refundState: 'none',
      receiptTotalIqd: null,
    };
    this.orders.set(record.id, record);
    const byRef = new Map<string, string>();
    for (const p of participants) {
      const { ref, ...rest } = p;
      const rec: ParticipantRecord = { ...rest, id: this.id('par'), orderId: record.id };
      this.participants.push(rec);
      this.participantsByOrder.set(record.id, [...(this.participantsByOrder.get(record.id) ?? []), rec]);
      byRef.set(ref, rec.id);
    }
    for (const l of lines) {
      const { participantRef, ...rest } = l;
      const line: OrderLineRecord = { ...rest, id: this.id('line'), orderId: record.id, participantId: participantRef ? (byRef.get(participantRef) ?? null) : null, substitution: null };
      this.lines.push(line);
      this.linesByOrder.set(record.id, [...(this.linesByOrder.get(record.id) ?? []), line]);
    }
    return (await this.find(record.id))!;
  }

  async find(id: string): Promise<OrderAggregate | null> {
    const order = this.orders.get(id);
    if (!order) return null;
    return {
      order: { ...order },
      lines: (this.linesByOrder.get(id) ?? []).map((l) => ({ ...l })),
      participants: (this.participantsByOrder.get(id) ?? []).map((p) => ({ ...p })),
    };
  }

  async update(id: string, patch: OrderPatch): Promise<OrderRecord> {
    const o = this.orders.get(id);
    if (!o) throw new Error(`order ${id} not found`);
    const next = { ...o, ...patch };
    this.orders.set(id, next);
    return { ...next };
  }

  async updateIf(id: string, expectState: OrderState, patch: OrderPatch): Promise<OrderRecord | null> {
    const o = this.orders.get(id);
    if (!o || o.state !== expectState) return null;
    return this.update(id, patch);
  }

  async updateLine(id: string, patch: { substitution: LineUnavailability | null }): Promise<OrderLineRecord> {
    const l = this.lines.find((x) => x.id === id);
    if (!l) throw new Error(`line ${id} not found`);
    l.substitution = patch.substitution;
    return { ...l };
  }

  async findMany(filter: { cityId?: string; merchantOrgId?: string; states?: readonly OrderState[] }): Promise<OrderRecord[]> {
    return [...this.orders.values()]
      .filter((o) => (!filter.cityId || o.cityId === filter.cityId) && (!filter.merchantOrgId || o.merchantOrgId === filter.merchantOrgId) && (!filter.states || filter.states.includes(o.state)))
      .map((o) => ({ ...o }));
  }

  async merchantOrdersBetween(merchantOrgId: string, from: Date, to: Date): Promise<OrderAggregate[]> {
    const out: OrderAggregate[] = [];
    for (const o of this.orders.values()) {
      if (o.merchantOrgId !== merchantOrgId || o.placedAt < from || o.placedAt >= to) continue;
      out.push({
        order: { ...o },
        lines: (this.linesByOrder.get(o.id) ?? []).map((l) => ({ ...l })),
        participants: (this.participantsByOrder.get(o.id) ?? []).map((p) => ({ ...p })),
      });
    }
    return out.sort((a, b) => a.order.placedAt.getTime() - b.order.placedAt.getTime() || a.order.id.localeCompare(b.order.id));
  }

  async forPerson(personId: string): Promise<OrderRecord[]> {
    const viaParticipant = new Set(this.participants.filter((p) => p.personId === personId).map((p) => p.orderId));
    return [...this.orders.values()]
      .filter((o) => o.ordererId === personId || viaParticipant.has(o.id))
      .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
      .map((o) => ({ ...o }));
  }

  async search(f: OrderSearchFilter): Promise<OrderRecord[]> {
    const text = f.text?.toLowerCase();
    return [...this.orders.values()]
      .filter((o) => o.cityId === f.cityId)
      .filter((o) => !f.states || f.states.length === 0 || f.states.includes(o.state))
      .filter((o) => !f.type || o.type === f.type)
      .filter((o) => !f.merchantOrgId || o.merchantOrgId === f.merchantOrgId)
      .filter((o) => (!f.from || o.placedAt >= f.from) && (!f.to || o.placedAt < f.to))
      .filter((o) => !text || [o.id, o.ordererId, o.merchantOrgId ?? '', o.note ?? ''].some((v) => v.toLowerCase().includes(text)))
      .filter((o) => !f.after || isAfterCursor(o, f.after))
      .sort(newestFirst)
      .slice(0, f.limit)
      .map((o) => ({ ...o }));
  }

  async countPlacedSince(cityId: string, since: Date): Promise<number> {
    return [...this.orders.values()].filter((o) => o.cityId === cityId && o.placedAt >= since).length;
  }
}
