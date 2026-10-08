import type { CancellationBeneficiary, CancellationFee, Order, OrderState, Trip } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { TripEventEnvelope } from './events.adapter.js';
import type { OrderPatch, OrderRecord } from './orders.repository.js';

/**
 * The order internals the W3 staff toolkit (`orders.staff.ts`) drives, handed over by
 * `OrdersService.staffBridge()`, so there is exactly one copy of each move (state machine check,
 * conditional update, event) and of closing (money and points). Nothing else uses it.
 */
export interface OrdersStaffBridge {
  move(order: OrderRecord, to: OrderState, actorId: string, tx: Tx, patch?: OrderPatch, payload?: object, eventType?: string): Promise<OrderRecord>;
  /** `closed`: money settles (the ledger subscribes) and points are allocated. */
  close(order: OrderRecord, actorId: string, reason: string, tx: Tx): Promise<void>;
  /** The courier's drop-off as the trip event would have reported it (cash collected on a cash order). */
  delivered(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown>;
  /** The `order.cancelled` payload fields beyond the transition. */
  cancelled(
    order: OrderRecord,
    c: { by: 'customer' | 'platform'; reason: string; free: boolean; feeIqd: number; beneficiaries?: CancellationBeneficiary[]; tripId?: string | undefined; label_ar?: string; reason_ar?: string },
  ): object;
  /** The fee the customer would pay to cancel now, and the order's active trip. */
  feeFor(order: OrderRecord): Promise<{ fee: CancellationFee; trip: Trip | null }>;
  emit(tx: Tx | undefined, type: string, actorId: string, order: OrderRecord, payload: object): Promise<void>;
  view(orderId: string, tx?: Tx): Promise<Order>;
}

/** W3 M-2 (NTF-11): the free fee when the platform failed this order (null = the normal fee stands). */
export interface PlatformFailurePort {
  freeFeeFor(order: OrderRecord, trip: Trip | null, fee: CancellationFee): Promise<CancellationFee | null>;
}
