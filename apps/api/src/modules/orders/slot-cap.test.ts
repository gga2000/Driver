import { describe, expect, it } from 'vitest';
import { SLOT_CAP_RULES, slotCapFor, slotFull, slotTaken } from './slot-cap.js';
import { ordersHarness } from './test-harness.js';

const at = (iso: string) => new Date(iso);

describe('slot caps (J6)', () => {
  it('are off by default', () => {
    expect(slotCapFor(SLOT_CAP_RULES, 'rest_1')).toBeNull();
    expect(slotFull(SLOT_CAP_RULES, 'rest_1', at('2027-02-08T14:29:00Z'), Array(50).fill(at('2027-02-08T14:29:00Z')))).toBe(false);
  });

  it("a kitchen's own cap overrides the city's, and null switches it off for that kitchen", () => {
    const rules = { perSlot: 10, byMerchant: { rest_1: 4, rest_2: null }, windowMin: 30 };
    expect(slotCapFor(rules, 'rest_1')).toBe(4);
    expect(slotCapFor(rules, 'rest_2')).toBeNull();
    expect(slotCapFor(rules, 'rest_3')).toBe(10);
  });

  it('orders within ±15 minutes share a slot; unscheduled orders never count', () => {
    const slot = at('2027-02-08T14:29:00Z');
    const list = [at('2027-02-08T14:15:00Z'), at('2027-02-08T14:43:59Z'), at('2027-02-08T14:44:00Z'), null];
    expect(slotTaken(list, slot, 30)).toBe(2);
    expect(slotFull({ perSlot: 2, byMerchant: {}, windowMin: 30 }, 'rest_1', slot, list)).toBe(true);
    expect(slotFull({ perSlot: 3, byMerchant: {}, windowMin: 30 }, 'rest_1', slot, list)).toBe(false);
  });

  it('orders.place refuses a full slot with slot_full; another slot or an order for now still goes', async () => {
    const h = ordersHarness('2026-10-03T10:30:00Z');
    h.orders.slotCaps = { perSlot: null, byMerchant: { rest_1: 1 }, windowMin: 30 };
    const slot = new Date('2026-10-03T14:00:00Z');
    await h.orders.place('c1', h.foodInput({ scheduledFor: slot }));
    await expect(h.orders.place('c2', h.foodInput({ scheduledFor: new Date('2026-10-03T14:10:00Z') }))).rejects.toMatchObject({ code: 'slot_full' });
    await expect(h.orders.place('c2', h.foodInput({ scheduledFor: new Date('2026-10-03T14:30:00Z') }))).resolves.toMatchObject({ state: expect.any(String) });
    await expect(h.orders.place('c3', h.foodInput())).resolves.toMatchObject({ state: expect.any(String) });
  });
});
