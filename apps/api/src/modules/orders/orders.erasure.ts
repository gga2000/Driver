import { TERMINAL_ORDER_STATES, type OrderState } from '@driver/contracts';
import { ErasureNotReady, type ErasureStep } from '../identity/index.js';
import type { TripsService } from '../trips/index.js';
import type { OrdersRepository } from './orders.repository.js';

/** Done with: nothing left for him, the kitchen or the courier to do (a dispute is still open, so it blocks). */
const FINISHED: ReadonlySet<OrderState> = new Set<OrderState>([...TERMINAL_ORDER_STATES, 'delivered', 'completed']);

/**
 * W7 account deletion, the orders module's part (docs/api/account-deletion.md). An order still on its
 * way (or under dispute) stops the deletion. Afterwards his orders stay (money records, the kitchen's
 * and the courier's history) but lose what leads to him: notes, the drop-off's place and door, a
 * blurred pin on the order and its stops, and the names, notes and number hashes of its participants.
 */
export function ordersErasure(repo: OrdersRepository, trips: Pick<TripsService, 'blurStopsOf'>): ErasureStep {
  return {
    owner: 'orders',
    tables: ['public.orders', 'public.order_lines', 'public.participants', 'public.stops'],
    blockers: async (personId) => {
      const open = (await repo.statesOfOrderer(personId)).filter((o) => !FINISHED.has(o.state)).length;
      return open > 0 ? [{ kind: 'open_order', count: open }] : [];
    },
    erase: async (personId) => {
      const mine = await repo.statesOfOrderer(personId);
      if (mine.some((o) => !FINISHED.has(o.state))) throw new ErasureNotReady('an order is still open');
      const ids = mine.map((o) => o.id);
      await repo.blurForErasure(personId, ids);
      await trips.blurStopsOf(ids);
    },
  };
}
