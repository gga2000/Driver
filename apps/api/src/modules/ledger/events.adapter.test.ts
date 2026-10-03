import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { EventsServiceLedgerBus } from './events.adapter.js';

describe('EventsServiceLedgerBus on the real outbox', () => {
  function setup() {
    const clock = new FakeClock('2026-10-03T12:00:00Z');
    const detached = new Map<string, Date>();
    const h = createInMemoryEvents({ clock, tripOrders: { detachedAt: async (t, o) => detached.get(`${t}/${o}`) ?? null } });
    const bus = new EventsServiceLedgerBus(h.events);
    const got: Array<{ payload: Record<string, unknown>; type: string }> = [];
    bus.subscribe('ledger:order.cash_collected', 'order.cash_collected', async (payload, meta) => {
      got.push({ payload, type: meta.type });
    });
    return { ...h, clock, detached, bus, got };
  }

  it('handlers get the producer payload with actor, device time and top-level ids underneath', async () => {
    const h = setup();
    await h.bus.emit(undefined, { type: 'order.cash_collected', actorId: 'd1', occurredAt: h.clock.now(), tripId: 't1', orderId: 'o1', payload: { kind: 'order', amountIqd: 5000 } }, { name: 'order', id: 'o1' });
    expect(h.got).toEqual([
      { type: 'order.cash_collected', payload: { actorId: 'd1', occurredAt: '2026-10-03T12:00:00.000Z', tripId: 't1', orderId: 'o1', kind: 'order', amountIqd: 5000 } },
    ]);
    expect(h.registry.names()).toContain('ledger:order.cash_collected');
  });

  it('a late replay of cash collection is stored but never settled', async () => {
    const h = setup();
    h.detached.set('t1/o1', new Date('2026-10-03T11:55:00Z'));
    const ev = await h.bus.emit(
      undefined,
      { type: 'order.cash_collected', actorId: 'd1', occurredAt: new Date('2026-10-03T11:50:00Z'), tripId: 't1', orderId: 'o1', deviceUptimeMs: 1, payload: { kind: 'order' } },
      { name: 'order', id: 'o1' },
    );
    expect(ev.quarantined).toBe(true);
    expect(h.got).toEqual([]);
  });
});
