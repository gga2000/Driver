import { randomBytes } from 'node:crypto';

/**
 * The store reviewers' test kitchen (launch plan W5, BENCH-04, decision D-4). An order the
 * store-reviewer account places at the hidden test kitchen, and the trip that carries it, get ids
 * that start with `TEST_ID_PREFIX`. The id itself says "test", so it can never be lost on the way:
 * the event registry hands events of a test order or trip only to the subscribers that opted in (the
 * order's own flow, live updates, pushes), never to dispatch, the ledger, the ETA learner or any
 * other real-world effect. `orders.is_test` / `orgs.is_test` carry the same fact for queries.
 */
export const TEST_ID_PREFIX = 'test_';

/**
 * The test kitchen's crew: one server-side person (no phone, no vault identity, so no sign-in and no
 * message can ever reach it) who owns the test kitchen and carries its orders as the courier.
 */
export const TEST_CREW_ID = 'test_crew';

/** Whether this order, trip or aggregate id belongs to the store reviewers' test kitchen. */
export function isTestId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(TEST_ID_PREFIX);
}

/** A fresh test-kitchen id: the prefix and 24 random hex digits. */
export function newTestId(): string {
  return `${TEST_ID_PREFIX}${randomBytes(12).toString('hex')}`;
}

/**
 * Whether an event belongs to the test kitchen: its order or trip is a test one. Only order and trip
 * ids count (both are always made by the server), so no id a client chose can ever turn a real event
 * into a test one.
 */
export function isTestEvent(e: {
  aggregate: string;
  aggregateId: string;
  orderId?: string | undefined;
  tripId?: string | undefined;
}): boolean {
  return (
    isTestId(e.orderId) ||
    isTestId(e.tripId) ||
    ((e.aggregate === 'order' || e.aggregate === 'trip') && isTestId(e.aggregateId))
  );
}
