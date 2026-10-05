import type { DisputeKind, Order, OrderType } from '@driver/contracts';

/**
 * Which "عندي مشكلة" an order gets (audit C-13), mirroring what `orders.openDispute` accepts: a
 * complaint while it is delivered/completed (the API's dispute window, before it closes), a note
 * that one is already open, a pointer to the live screen while it runs, and WhatsApp with the order
 * number once it is closed or was cancelled.
 */
export type HelpCase = 'dispute' | 'disputed' | 'running' | 'closed' | 'cancelled';

export function helpCase(o: Pick<Order, 'state'>): HelpCase {
  switch (o.state) {
    case 'delivered':
    case 'completed':
      return 'dispute';
    case 'disputed':
      return 'disputed';
    case 'closed':
    case 'refunded':
      return 'closed';
    case 'merchant_rejected':
    case 'customer_cancelled':
    case 'platform_cancelled':
    case 'failed':
      return 'cancelled';
    default:
      return 'running';
  }
}

/** The kinds offered (same copy as the order screen's report panel). */
export function issueKinds(type: OrderType): ReadonlyArray<{ kind: DisputeKind; key: string }> {
  if (type === 'ride') return [
    { kind: 'ride_fare', key: 'dispute.reason_fare' },
    { kind: 'other', key: 'dispute.reason_other' },
  ];
  return [
    { kind: 'cold_or_late', key: 'dispute.reason_late' },
    { kind: 'missing_item', key: 'dispute.reason_missing' },
    { kind: 'wrong_item', key: 'dispute.reason_wrong' },
    { kind: 'not_delivered', key: 'dispute.reason_not_delivered' },
    { kind: 'other', key: 'dispute.reason_other' },
  ];
}
