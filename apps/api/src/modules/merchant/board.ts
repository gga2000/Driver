import {
  travelMinutes,
  type BoardColumn,
  type BoardCourier,
  type BoardGroup,
  type BoardLine,
  type BoardOrder,
  type LatLng,
  type Order,
  type OrderState,
  type Trip,
} from '@driver/contracts';

/**
 * The kitchen's view of its live orders (Driver Merchant spec): pure, so the column rules, the
 * per-person grouping and the courier state are unit-tested without the rest of the API.
 */

/** Order states that sit on the board, by column. Everything else has left the kitchen. */
const COLUMN_OF: Partial<Record<OrderState, BoardColumn>> = {
  placed: 'new',
  merchant_accepted: 'preparing',
  preparing: 'preparing',
  ready: 'ready',
};

export function boardColumn(state: OrderState): BoardColumn | null {
  return COLUMN_OF[state] ?? null;
}

/**
 * The ticket number the kitchen calls out: four digits derived from the order id (FNV-1a), so it is
 * stable across polls and devices without a per-store counter. Collisions within one evening's
 * board are rare and harmless (the card and receipt also carry the time and the people).
 */
export function ticketNumber(orderId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < orderId.length; i++) {
    h ^= orderId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(1000 + (h % 9000));
}

/** A line's modifiers as names: `{groupId, modifierId, nameAr, priceIqd}` from `orders.place`. */
export function modifierNames(modifiers: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const m of modifiers) {
    const name = m && typeof m === 'object' ? (m as { nameAr?: unknown }).nameAr : null;
    if (typeof name === 'string' && name.trim()) out.push(name.trim());
  }
  return out;
}

function modifiersValue(modifiers: readonly unknown[]): number {
  let sum = 0;
  for (const m of modifiers) {
    const p = m && typeof m === 'object' ? (m as { priceIqd?: unknown }).priceIqd : null;
    if (typeof p === 'number') sum += p;
  }
  return sum;
}

/**
 * Lines grouped by who they are for: the orderer's own lines first (no label — the app says
 * "صاحب الطلب"), then each tagged person in the order the customer added them. People with nothing
 * left on the order (every line removed by a partial accept) are dropped.
 */
export function groupLines(order: Pick<Order, 'lines' | 'participants'>, itemNames: ReadonlyMap<string, string>): BoardGroup[] {
  const toLine = (l: Order['lines'][number]): BoardLine => {
    const unit = l.unitPriceIqd + modifiersValue(l.modifiers);
    return {
      lineId: l.id,
      name: (l.catalogItemId ? itemNames.get(l.catalogItemId) : null) ?? l.freeText ?? '—',
      qty: l.qty,
      modifiers: modifierNames(l.modifiers),
      note: l.note?.trim() ? l.note.trim() : null,
      unitPriceIqd: unit,
      totalIqd: unit * l.qty,
      availability: l.availability,
    };
  };
  const count = (lines: BoardLine[]) => lines.filter((l) => l.availability !== 'removed').reduce((a, l) => a + l.qty, 0);
  const known = new Set(order.participants.map((p) => p.id));
  const mine = order.lines.filter((l) => !l.participantId || !known.has(l.participantId)).map(toLine);
  const groups: BoardGroup[] = [];
  if (mine.length > 0) groups.push({ key: 'orderer', kind: 'orderer', label: null, note: null, itemCount: count(mine), lines: mine });
  for (const p of order.participants) {
    const lines = order.lines.filter((l) => l.participantId === p.id).map(toLine);
    if (lines.length === 0 || lines.every((l) => l.availability === 'removed')) continue;
    groups.push({ key: p.id, kind: 'participant', label: p.label?.trim() || null, note: p.note?.trim() || null, itemCount: count(lines), lines });
  }
  return groups;
}

export interface CourierFacts {
  trip: Pick<Trip, 'state' | 'courierId' | 'stops'> | null;
  /** The courier's last fix, when on his way to the counter. */
  position: LatLng | null;
  kitchen: LatLng | null;
  firstName: string | null;
  vehicleClass: BoardCourier['vehicleClass'];
}

/**
 * Courier state for the card: "ندوّر دليفري" until someone takes the trip; on his way with minutes
 * to the counter (from his last fix); "الدليفري وصل" with the time he got there; gone once he left.
 */
export function courierView(orderId: string, f: CourierFacts): BoardCourier {
  const none: BoardCourier = { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null };
  const t = f.trip;
  if (!t) return none;
  if (!t.courierId || t.state === 'created' || t.state === 'offered' || t.state === 'declined' || t.state === 'timed_out') return { ...none, state: 'searching' };
  const pickup = t.stops.find((s) => s.orderId === orderId && s.type === 'pickup');
  const who = { firstName: f.firstName, vehicleClass: f.vehicleClass };
  if (pickup?.state === 'completed' || t.state === 'in_transit' || t.state === 'arrived_dropoff' || t.state === 'completed') {
    return { ...none, ...who, state: 'picked_up' };
  }
  if (pickup?.state === 'arrived' || t.state === 'arrived_pickup') {
    return { ...none, ...who, state: 'arrived', arrivedAt: pickup?.arrivedAt ?? null };
  }
  const eta = f.position && f.kitchen ? travelMinutes(f.position, f.kitchen, f.vehicleClass ?? 'bike') : null;
  return { ...none, ...who, state: 'on_the_way', etaMinutes: eta };
}

export interface BoardOrderFacts {
  order: Order;
  itemNames: ReadonlyMap<string, string>;
  courier: BoardCourier;
  acceptWindowSec: number;
  now: Date;
}

/** One card on the board, or null when the order is not the kitchen's business any more. */
export function toBoardOrder({ order: o, itemNames, courier, acceptWindowSec, now }: BoardOrderFacts): BoardOrder | null {
  const column = boardColumn(o.state);
  if (!column) return null;
  const groups = groupLines(o, itemNames);
  const itemCount = groups.reduce((a, g) => a + g.itemCount, 0);
  const acceptBy = column === 'new' && o.merchantOfferedAt ? new Date(o.merchantOfferedAt.getTime() + acceptWindowSec * 1000) : null;
  const prepMinutes = o.acceptedAt && o.promisedReadyAt ? Math.max(1, Math.round((o.promisedReadyAt.getTime() - o.acceptedAt.getTime()) / 60_000)) : null;
  return {
    id: o.id,
    number: ticketNumber(o.id),
    column,
    state: o.state,
    type: o.type,
    placedAt: o.placedAt,
    offeredAt: o.merchantOfferedAt,
    acceptBy,
    acceptedAt: o.acceptedAt,
    promisedReadyAt: o.promisedReadyAt,
    readyAt: o.readyAt,
    scheduledFor: o.scheduledFor,
    prepMinutes,
    paymentMethod: o.paymentMethod,
    itemsTotalIqd: o.itemsTotalIqd,
    totalIqd: o.totalIqd,
    collectCashIqd: o.paymentMethod === 'cash' ? o.totalIqd : 0,
    itemCount,
    groups,
    note: o.note?.trim() ? o.note.trim() : null,
    partial: o.partial ? { unavailableLineIds: o.partial.unavailableLineIds, deadline: o.partial.deadline } : null,
    courier,
    late: column === 'preparing' && o.promisedReadyAt !== null && now.getTime() > o.promisedReadyAt.getTime(),
    catering: o.cateringRequest,
  };
}

/**
 * Board order: new orders by how little time is left to accept (oldest first), then preparing by
 * promised time, then ready by when they became ready.
 */
export function sortBoard(orders: BoardOrder[]): BoardOrder[] {
  const rank: Record<BoardColumn, number> = { new: 0, preparing: 1, ready: 2 };
  const key = (o: BoardOrder) =>
    o.column === 'new' ? (o.acceptBy ?? o.placedAt).getTime() : o.column === 'preparing' ? (o.promisedReadyAt ?? o.placedAt).getTime() : (o.readyAt ?? o.placedAt).getTime();
  return [...orders].sort((a, b) => rank[a.column] - rank[b.column] || key(a) - key(b) || a.id.localeCompare(b.id));
}
