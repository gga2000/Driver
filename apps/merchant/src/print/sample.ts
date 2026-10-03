import type { BoardOrder } from '@driver/contracts';

/** A test ticket ("اطبع وصل تجربة"): two people, a note, cash — exercises every receipt line. */
export function sampleOrder(names: { item1: string; item2: string; item3: string; note: string; person: string }, now: Date = new Date()): BoardOrder {
  const line = (lineId: string, name: string, qty: number, unit: number, note: string | null = null) => ({
    lineId,
    name,
    qty,
    modifiers: [],
    note,
    unitPriceIqd: unit,
    totalIqd: unit * qty,
    availability: 'available' as const,
  });
  return {
    id: 'test-ticket',
    number: '0000',
    column: 'preparing',
    state: 'preparing',
    type: 'food',
    placedAt: now,
    offeredAt: now,
    acceptBy: null,
    acceptedAt: now,
    promisedReadyAt: new Date(now.getTime() + 15 * 60_000),
    readyAt: null,
    scheduledFor: null,
    prepMinutes: 15,
    paymentMethod: 'cash',
    itemsTotalIqd: 13000,
    totalIqd: 14500,
    collectCashIqd: 14500,
    itemCount: 4,
    groups: [
      { key: 'orderer', kind: 'orderer', label: null, note: null, itemCount: 2, lines: [line('t1', names.item1, 2, 2500, names.note)] },
      { key: 'p', kind: 'participant', label: names.person, note: null, itemCount: 2, lines: [line('t2', names.item2, 1, 7000), line('t3', names.item3, 1, 1000)] },
    ],
    note: null,
    partial: null,
    courier: { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null },
    late: false,
    catering: false,
  };
}
