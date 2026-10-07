import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { buildRidePlaceInput } from './logic';
import { recentRiders, riderChipId, riderInput, riderName, riderOptions, RIDER_ME, typedRider } from './rider';
import { createRideStore, EMPTY_DRAFT } from './store';

type RideRow = Pick<Order, 'id' | 'type' | 'placedAt' | 'rider' | 'participants'>;

const at = (h: number) => new Date(Date.UTC(2026, 9, 7, h));
const rideFor = (id: string, h: number, personId: string, name: string): RideRow => ({
  id,
  type: 'ride',
  placedAt: at(h),
  rider: { name },
  participants: [{ id: `pt_${id}`, role: 'rider', personId, label: null, note: null }] as Order['participants'],
});
const own = (id: string, h: number): RideRow => ({ id, type: 'ride', placedAt: at(h), participants: [] });

describe('«لمنو المشوار؟» (ride ideas c9/s3)', () => {
  it('earlier riders: newest first, one per person, at most four, never his own rides', () => {
    const rows = [rideFor('r1', 8, 'mum', 'ماما'), rideFor('r2', 10, 'mum', 'أمي'), own('r3', 11), rideFor('r4', 9, 'dad', 'بابا'), rideFor('r5', 7, 'a', 'أ'), rideFor('r6', 6, 'b', 'ب'), rideFor('r7', 5, 'c', 'ج')];
    const out = recentRiders(rows);
    expect(out.map((o) => [o.id, o.name])).toEqual([
      ['recent:r2', 'أمي'],
      ['recent:r4', 'بابا'],
      ['recent:r5', 'أ'],
      ['recent:r6', 'ب'],
    ]);
    expect(out[0]!.pick).toEqual({ kind: 'recent', orderId: 'r2', name: 'أمي' });
  });

  it('the sheet: earlier riders, trusted people, then the household without himself; a name once', () => {
    const options = riderOptions({
      orders: [rideFor('r1', 8, 'mum', 'ماما')],
      trusted: [
        { name: 'ماما', phoneMasked: '+96477*****33', relation: 'mother' },
        { name: 'أختي', phoneMasked: '+96478*****11', relation: 'sibling' },
      ],
      household: {
        id: 'h1',
        members: [
          { personId: 'me', name: 'علي', phoneMasked: '0770…', role: 'payer', spendingLimitIqd: null, isMe: true, monthlyBudgetIqd: null, monthSpentIqd: null },
          { personId: 'kid', name: null, phoneMasked: '0780 ••• ••12', role: 'member', spendingLimitIqd: null, isMe: false, monthlyBudgetIqd: null, monthSpentIqd: null },
        ],
      },
    });
    expect(options.map((o) => [o.id, o.name])).toEqual([
      ['recent:r1', 'ماما'],
      ['trusted:1', 'أختي'],
      ['household:kid', '0780 ••• ••12'],
    ]);
    expect(options[1]!.pick).toEqual({ kind: 'trusted', index: 1, name: 'أختي' });
    expect(options[2]!.pick).toEqual({ kind: 'household', householdId: 'h1', personId: 'kid', name: '0780 ••• ••12' });
    expect(riderOptions({ orders: [], trusted: undefined, household: null })).toEqual([]);
  });

  it('a typed person needs a name and an Iraqi mobile number', () => {
    expect(typedRider('  ماما ', '0770 555 4433')).toEqual({ pick: { kind: 'typed', name: 'ماما', phone: '+9647705554433' } });
    expect(typedRider('', '0770 555 4433')).toEqual({ errors: ['name'] });
    expect(typedRider('ماما', '0770 555')).toEqual({ errors: ['phone'] });
    expect(typedRider(' ', '12')).toEqual({ errors: ['name', 'phone'] });
    expect(typedRider('ماما', '٠٧٧٠ ٥٥٥ ٤٤٣٣')).toMatchObject({ pick: { phone: '+9647705554433' } });
  });

  it('what orders.place gets, the name shown and the chip of each pick', () => {
    expect(riderInput(RIDER_ME)).toBeUndefined();
    expect(riderName(RIDER_ME)).toBeNull();
    expect(riderInput({ kind: 'typed', name: 'ماما', phone: '+9647705554433' })).toEqual({ from: 'typed', name: 'ماما', phone: '+9647705554433' });
    expect(riderInput({ kind: 'recent', orderId: 'r1', name: 'ماما' })).toEqual({ from: 'recent', orderId: 'r1' });
    expect(riderInput({ kind: 'trusted', index: 0, name: 'أختي' })).toEqual({ from: 'trusted', index: 0 });
    expect(riderInput({ kind: 'household', householdId: 'h1', personId: 'kid', name: 'حسين' })).toEqual({ from: 'household', householdId: 'h1', personId: 'kid' });
    expect(riderName({ kind: 'trusted', index: 0, name: 'أختي' })).toBe('أختي');
    expect([RIDER_ME, { kind: 'typed', name: 'x', phone: 'y' } as const, { kind: 'recent', orderId: 'r1', name: 'ماما' } as const].map(riderChipId)).toEqual(['me', 'other', 'recent:r1']);
    const input = buildRidePlaceInput({ vertical: 'taxi', pickup: { zoneId: 'centre', pin: { lat: 32.9, lng: 45.06 } }, dropoff: { zoneId: 'zakur', pin: { lat: 32.91, lng: 45.07 } }, doorPickup: false, fareIqd: 3000, paymentMethod: 'cash', rider: { from: 'recent', orderId: 'r1' } });
    expect(input.rider).toEqual({ from: 'recent', orderId: 'r1' });
    expect('rider' in buildRidePlaceInput({ vertical: 'taxi', pickup: { zoneId: 'centre', pin: { lat: 32.9, lng: 45.06 } }, dropoff: { zoneId: 'zakur', pin: { lat: 32.91, lng: 45.07 } }, doorPickup: false, fareIqd: 3000, paymentMethod: 'cash' })).toBe(false);
  });

  it('every booking starts at «إلي», and a placed ride goes back to it', async () => {
    const mem = new Map<string, string>();
    const store = createRideStore({ getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v), removeItem: async (k) => void mem.delete(k) });
    expect(EMPTY_DRAFT.rider).toEqual(RIDER_ME);
    store.update({ rider: { kind: 'typed', name: 'ماما', phone: '+9647705554433' } });
    store.start('taxi');
    expect(store.getSnapshot().draft.rider).toEqual(RIDER_ME);
    store.update({ rider: { kind: 'recent', orderId: 'r1', name: 'ماما' } });
    store.placed('o9', { vertical: 'taxi', from: 'البيت', to: 'السوق' }, { title: 'السوق', zoneId: 'centre', pin: { lat: 32.9, lng: 45.06 } } as never);
    expect(store.getSnapshot().draft.rider).toEqual(RIDER_ME);
    // Nobody's number is kept on the phone.
    expect([...mem.values()].join('')).not.toContain('7705554433');
  });
});
