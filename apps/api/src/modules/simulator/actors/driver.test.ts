import { describe, expect, it } from 'vitest';
import type { HotWaitRecord } from '../context.js';
import { recordDepartures } from './driver.js';

const min = (m: number) => m * 60_000;
type Bag = Parameters<typeof recordDepartures>[1]['bag'];
type Item = Bag extends Map<string, infer V> ? V : never;

/** A bag item picked up at `pickedUpT`; a late kitchen tapped ready `lateMs` after its promise and held him `heldMs` from `heldFromMs`. */
function item(over: Partial<Item> & Pick<Item, 'readyAtMs' | 'pickedUpT'>): Item {
  return { lateMs: 0, heldMs: 0, heldFromMs: 0, batched: true, offline: false, departed: false, ...over };
}

function depart(t: number, bag: Array<[string, Item]>): HotWaitRecord[] {
  const ctx = { t, hotWaits: [] as HotWaitRecord[] };
  recordDepartures(ctx, { personId: 'k1', bag: new Map(bag) });
  return ctx.hotWaits;
}

describe('batched hot wait: what late kitchens cost an item is taken off', () => {
  it('a late kitchen picked up before it: the time it held the courier (simulator near-miss, 10.3 min)', () => {
    // Replayed from the run that waited 10.3 min: B ready 19:08:08; batching planned to leave at 19:17:45
    // (9.6 min). A's kitchen, promised 19:13:30, was ready only at 19:15:18; he stood there from 19:14:33.
    const at = (h: number, m: number, s: number) => ((h * 60 + m) * 60 + s) * 1000;
    const a = item({ readyAtMs: at(19, 15, 18), lateMs: at(19, 15, 18) - at(19, 13, 30), heldFromMs: at(19, 14, 33), heldMs: at(19, 15, 18) - at(19, 14, 33), pickedUpT: at(19, 15, 18) });
    const b = item({ readyAtMs: at(19, 8, 8), pickedUpT: at(19, 18, 23) });
    const [ra, rb] = depart(at(19, 18, 28), [['A', a], ['B', b]]);
    expect(rb).toMatchObject({ orderId: 'B', rawWaitMin: 10.3, kitchenLateMin: 0.8, waitMin: 9.6 });
    expect(ra).toMatchObject({ orderId: 'A', kitchenLateMin: 0, waitMin: 3.2 }); // B's kitchen was on time
  });

  it('only the part of the hold after the item was ready counts', () => {
    const a = item({ readyAtMs: min(14), lateMs: min(4), heldFromMs: min(10), heldMs: min(4), pickedUpT: min(14) });
    const b = item({ readyAtMs: min(12), pickedUpT: min(20) });
    expect(depart(min(21), [['A', a], ['B', b]])[1]).toMatchObject({ rawWaitMin: 9, kitchenLateMin: 2, waitMin: 7 });
  });

  it('on-time kitchens take nothing off; a later late kitchen takes its lateness off as before', () => {
    const a = item({ readyAtMs: min(0), pickedUpT: min(3) });
    const b = item({ readyAtMs: min(6), lateMs: min(2), heldFromMs: min(4), heldMs: min(2), pickedUpT: min(6) });
    const [ra, rb] = depart(min(11), [['A', a], ['B', b]]);
    expect(ra).toMatchObject({ rawWaitMin: 11, kitchenLateMin: 2, waitMin: 9 });
    expect(rb).toMatchObject({ rawWaitMin: 5, kitchenLateMin: 0, waitMin: 5 });
  });
});
