import type { NotifyTemplateId, OrderState } from '@driver/contracts';

/**
 * W2: what the customer hears at every turn of an order — one line per transition of each order family
 * (`order.machine.ts`). A turn either names the templates its event can send (one of them goes out;
 * `event` when the turn is announced by an event other than the transition's own), or says, in words,
 * why it is silent. `notify.matrix.test.ts` fails when the machine gains a transition this table does
 * not answer, and runs every templated line through the real subscribers.
 */
export type NotifyMatrixEntry = { templates: readonly NotifyTemplateId[]; event?: string } | { silent: string };

export type NotifyFamily = 'merchant' | 'courier' | 'ride';
export type TransitionKey = `${OrderState}>${OrderState}`;

const OWN_CANCEL = { silent: 'his own cancel: the app shows it as he taps' } as const;
const WE_CANCELLED = { templates: ['order_cancelled', 'order_payer_declined', 'order_payer_no_answer', 'order_partial_no_answer'] } as const;
const REJECTED = { templates: ['order_rejected', 'order_kitchen_no_answer', 'order_rejected_credit'] } as const;
const KITCHEN_WORKING = { silent: 'the kitchen at work: shown live on the order screen; the next message is the pickup' } as const;
const DISPUTE = { silent: 'a dispute: support answers in the app (W3 staff tools own the message)' } as const;
const REFUND = { silent: 'a refund: its credit message comes from the ledger posting (NTF-11)' } as const;
const CLOSED = { silent: 'closing the books: nothing new for him' } as const;
const FAILED = { silent: 'the door clock already told him twice (courier_unreachable + reminder); the outcome is a dispute' } as const;

const AFTER_CLOSE: Partial<Record<TransitionKey, NotifyMatrixEntry>> = {
  'closed>disputed': DISPUTE,
  'closed>refunded': REFUND,
  'disputed>closed': { silent: 'the dispute is settled in its own support thread' },
  'disputed>refunded': REFUND,
};
const AFTER_DELIVERY: Partial<Record<TransitionKey, NotifyMatrixEntry>> = { 'delivered>closed': CLOSED, 'delivered>disputed': DISPUTE, ...AFTER_CLOSE };

export const ORDER_NOTIFY_MATRIX: Record<NotifyFamily, Partial<Record<TransitionKey, NotifyMatrixEntry>>> = {
  merchant: {
    'placed>merchant_accepted': { templates: ['order_accepted'] },
    'placed>merchant_rejected': REJECTED,
    'placed>customer_cancelled': OWN_CANCEL,
    'placed>platform_cancelled': WE_CANCELLED,
    'merchant_accepted>preparing': KITCHEN_WORKING,
    'merchant_accepted>ready': KITCHEN_WORKING,
    'merchant_accepted>merchant_rejected': REJECTED,
    'merchant_accepted>customer_cancelled': OWN_CANCEL,
    'merchant_accepted>platform_cancelled': WE_CANCELLED,
    'preparing>ready': KITCHEN_WORKING,
    'preparing>merchant_rejected': REJECTED,
    'preparing>customer_cancelled': OWN_CANCEL,
    'preparing>platform_cancelled': WE_CANCELLED,
    'ready>picked_up': { templates: ['order_picked_up', 'order_on_the_way'] },
    'ready>customer_cancelled': OWN_CANCEL,
    'ready>platform_cancelled': WE_CANCELLED,
    'picked_up>delivered': { templates: ['order_receipt'] },
    'picked_up>disputed': DISPUTE,
    'picked_up>failed': FAILED,
    ...AFTER_DELIVERY,
  },
  courier: {
    'placed>picked_up': { templates: ['order_picked_up', 'order_on_the_way'] },
    'placed>customer_cancelled': OWN_CANCEL,
    'placed>platform_cancelled': WE_CANCELLED,
    'picked_up>delivered': { templates: ['order_receipt'] },
    'picked_up>disputed': DISPUTE,
    'picked_up>failed': FAILED,
    ...AFTER_DELIVERY,
  },
  ride: {
    'placed>matched': { templates: ['ride_matched'] },
    'placed>customer_cancelled': OWN_CANCEL,
    'placed>platform_cancelled': WE_CANCELLED,
    // The driver dropped it: the ride goes back to the search, and «حيدر لغى المشوار» says so.
    'matched>placed': { templates: ['ride_driver_cancelled', 'ride_driver_cancelled_credit'], event: 'order.driver_cancelled' },
    'matched>completed': { templates: ['ride_receipt'] },
    'matched>customer_cancelled': OWN_CANCEL,
    'matched>platform_cancelled': WE_CANCELLED,
    'matched>disputed': DISPUTE,
    'matched>failed': { silent: 'a ride stopped on the road: he is in the car and the app shows it; ops follow up' },
    'completed>closed': CLOSED,
    'completed>disputed': DISPUTE,
    ...AFTER_CLOSE,
  },
};
