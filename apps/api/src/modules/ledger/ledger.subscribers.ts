import {
  CancellationPayload,
  CashCollectedPayload,
  DepartureCancelledPayload,
  LateMeterPayload,
  MerchantSettlementRequestedPayload,
  OrderClosedPayload,
  SeatMoneyPayload,
  SubscriptionChargePayload,
  TripCompletedPayload,
} from '@driver/contracts';
import type { LedgerEventBus, LedgerHandler } from './events.adapter.js';
import type { MerchantCashService } from './merchant-cash.service.js';
import type { PostingService } from './posting.service.js';

/**
 * How the ledger reacts to domain events (plan Step 6). Each handler parses the plain payload
 * from contracts and records one idempotent posting group set, so a redelivered event is a no-op.
 * Producers (orders, trips, routes, merchant) own the payloads; the ledger never reads their tables.
 */
export function ledgerSubscribers(posting: PostingService, merchantCash: MerchantCashService): Record<string, LedgerHandler> {
  return {
    /** Cash in the courier's hand: money posts now so the merchant's live balance and the courier's cap move immediately. */
    'cash.collected': async (payload) => {
      const p = CashCollectedPayload.parse(payload);
      if (p.kind === 'order') await posting.orderMoney(p.order);
      else if (p.kind === 'errand') await posting.errandMoney(p.errand);
      else if (p.kind === 'ride') await posting.ride(p.ride);
      else await posting.seat(p.seat, { completed: false });
    },
    /** Money settles on closed (domain §2): money if not yet posted, then points on revenue and the referral check. */
    'order.closed': async (payload) => {
      const p = OrderClosedPayload.parse(payload);
      if (p.kind === 'order') await posting.orderClosed(p.order);
      else await posting.errandClosed(p.errand);
    },
    /** Rides and parcels; food trips carry no `ride` and are settled by their order. */
    'trip.completed': async (payload) => {
      const p = TripCompletedPayload.parse(payload);
      if (p.ride) await posting.ride(p.ride);
    },
    'order.cancelled': async (payload) => {
      await posting.cancellation(CancellationPayload.parse(payload));
    },
    'seat.completed': async (payload) => {
      await posting.seat(SeatMoneyPayload.parse(payload), { completed: true });
    },
    'seat.no_show': async (payload) => {
      await posting.seat(SeatMoneyPayload.parse(payload), { completed: false });
    },
    'seat.late_meter_settled': async (payload) => {
      await posting.lateMeter(LateMeterPayload.parse(payload));
    },
    'departure.cancelled': async (payload) => {
      await posting.departureCancelled(DepartureCancelledPayload.parse(payload));
    },
    'subscription.started': async (payload) => {
      await posting.subscription(SubscriptionChargePayload.parse(payload));
    },
    'subscription.renewed': async (payload) => {
      await posting.subscription(SubscriptionChargePayload.parse(payload));
    },
    'subscription.prorated': async (payload) => {
      await posting.subscription(SubscriptionChargePayload.parse({ ...payload, prorated: true }));
    },
    /** A request from any origin (Merchant app, exposure cap, mode schedule) gets routed and announced. */
    'merchant.settlement_requested': async (payload) => {
      const p = MerchantSettlementRequestedPayload.parse(payload);
      await merchantCash.assign(p.merchantId, p.reason);
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
