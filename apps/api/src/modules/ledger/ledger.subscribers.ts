import { decodeDomainEvent } from '@driver/contracts';
import type { LedgerEventBus, LedgerHandler } from './events.adapter.js';
import type { MerchantCashService } from './merchant-cash.service.js';
import type { PostingService } from './posting.service.js';

/**
 * How the ledger reacts to domain events (plan Step 6). Each handler decodes its payload with the
 * shared contract (`@driver/contracts` domain-events — the same schema the producer encoded it
 * with) and records one idempotent posting group set, so a redelivered event is a no-op. The
 * ledger never reads producers' tables. Rides settle through their order (`order.cash_collected`
 * kind `ride`, then `order.closed`), not `trip.completed`: trips know no money.
 */
export function ledgerSubscribers(posting: PostingService, merchantCash: MerchantCashService): Record<string, LedgerHandler> {
  return {
    /** Cash in the courier's (driver's) hand: money posts now so the merchant's live balance and the courier's cap move immediately. */
    'order.cash_collected': async (payload) => {
      const p = decodeDomainEvent('order.cash_collected', payload);
      if (p.kind === 'order') await posting.orderMoney(p.order);
      else if (p.kind === 'errand') await posting.errandMoney(p.errand);
      else await posting.rideMoney(p.ride);
    },
    /** Money settles on closed (domain §2): money if not yet posted, then points on revenue and the referral check. */
    'order.closed': async (payload) => {
      const p = decodeDomainEvent('order.closed', payload);
      if (p.kind === 'order') await posting.orderClosed(p.order);
      else if (p.kind === 'errand') await posting.errandClosed(p.errand);
      else await posting.ride(p.ride);
    },
    'order.cancelled': async (payload) => {
      await posting.cancellation(decodeDomainEvent('order.cancelled', payload));
    },
    'seat.completed': async (payload) => {
      await posting.seat(decodeDomainEvent('seat.completed', payload), { completed: true });
    },
    'seat.no_show': async (payload) => {
      await posting.seat(decodeDomainEvent('seat.no_show', payload), { completed: false });
    },
    'seat.late_meter_settled': async (payload) => {
      await posting.lateMeter(decodeDomainEvent('seat.late_meter_settled', payload));
    },
    'departure.cancelled': async (payload) => {
      await posting.departureCancelled(decodeDomainEvent('departure.cancelled', payload));
    },
    'subscription.started': async (payload) => {
      await posting.subscription(decodeDomainEvent('subscription.started', payload));
    },
    'subscription.renewed': async (payload) => {
      await posting.subscription(decodeDomainEvent('subscription.renewed', payload));
    },
    'subscription.prorated': async (payload) => {
      await posting.subscription(decodeDomainEvent('subscription.prorated', { ...payload, prorated: true }));
    },
    /** A request from any origin (Merchant app, exposure cap, mode schedule) gets routed and announced. */
    'merchant.settlement_requested': async (payload) => {
      const p = decodeDomainEvent('merchant.settlement_requested', payload);
      await merchantCash.assign(p.merchantId, p.reason, p.reference);
    },
  };
}

export const LEDGER_SUBSCRIBED_EVENTS = Object.keys(ledgerSubscribers({} as PostingService, {} as MerchantCashService));

/** Registers every handler on the bus under a stable name (`ledger:<event type>`). */
export function registerLedgerSubscribers(bus: LedgerEventBus, posting: PostingService, merchantCash: MerchantCashService): string[] {
  const handlers = ledgerSubscribers(posting, merchantCash);
  for (const [type, handler] of Object.entries(handlers)) bus.subscribe(`ledger:${type}`, type, handler);
  return Object.keys(handlers);
}
