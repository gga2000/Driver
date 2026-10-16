import { describe, expect, it } from 'vitest';
import { AZIZIYAH_CENTRE } from '@driver/contracts';
import { tripsHarness } from '../trips/test-harness.js';
import { canBatch, type BatchOrder } from './batching.js';
import { north } from './test-harness.js';

const MIN = 60_000;
const RULES = { maxBatch: 2, maxDetourMin: 10, maxHotWaitMin: 10 };

/**
 * The sim's p_67 (seed 1, 2,000 orders): a free courier took two kitchens' jobs in the same instant.
 * Batching checked the hot wait with the job he held first, then the new one; he drove them the other
 * way round and both meals waited 10.2 min. The order he works his jobs in (trips' `jobOrder`, what the
 * Partner app and the simulator follow) must be the order the check planned.
 */
describe('a batched courier drives the pickups in the order batching checked', () => {
  it('two jobs taken in the same millisecond: worked in the order taken, and the hot wait holds along that route', async () => {
    const h = tripsHarness();
    // Created first (the lower trip id), taken second: kitchen B, 1.5 km south, ready in 6 min.
    const b = await h.foodTrip('ord_b');
    // Created second, taken first: kitchen A, 1 km north, ready in 4 min.
    const a = await h.foodTrip('ord_a');
    await h.trips.offer(a.id, { driverIds: ['d1'] });
    await h.trips.accept(a.id, 'd1', { vehicleClass: 'bike' });
    await h.trips.offer(b.id, { driverIds: ['d1'] });
    await h.trips.accept(b.id, 'd1', { vehicleClass: 'bike' }, { assignedByDispatch: true });

    const worked = await h.trips.forDriver('d1');
    expect(worked.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(worked[1]!.acceptedAt!.getTime()).toBeGreaterThan(worked[0]!.acceptedAt!.getTime());

    const now = h.clock.now();
    const kitchens: Record<string, BatchOrder> = {
      [a.id]: { tripId: a.id, pickup: north(1), dropoffZoneId: 'centre', readyAt: new Date(now.getTime() + 4 * MIN), hot: true },
      [b.id]: { tripId: b.id, pickup: north(-1.5), dropoffZoneId: 'centre', readyAt: new Date(now.getTime() + 6 * MIN), hot: true },
    };
    const ctx = { now, courierAt: AZIZIYAH_CENTRE, isAdjacent: () => true };
    // What dispatch checked when he took B: A (held) first, then B.
    const planned = canBatch([kitchens[a.id]!], kitchens[b.id]!, RULES, ctx);
    expect(planned.ok).toBe(true);
    // The route he works: the same order, so the same verdict.
    const [first, second] = worked.map((t) => kitchens[t.id]!);
    expect(canBatch([first!], second!, RULES, ctx)).toEqual(planned);
    // The other way round (what the courier drove before): A's meal waits over 10 minutes.
    expect(canBatch([kitchens[b.id]!], kitchens[a.id]!, RULES, ctx)).toMatchObject({ ok: false, reason: 'hot_wait_too_long' });
  });
});
