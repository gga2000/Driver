import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type CancelOrderInput,
  type CancellationFee,
  type ComingOutResult,
  type ListActiveOrdersInput,
  type MerchantRejectInput,
  type OpenDisputeInput,
  type Order,
  type OrderQuote,
  type OrdersPort,
  type PlaceOrderInput,
  type RateOrderInput,
  type RespondPartialInput,
  type RideSwitchQuote,
  type ComplimentInput,
  type ComplimentOffer,
  type ComplimentResult,
  type TipOffer,
  type TipOrderInput,
  type TipResult,
  type RoleKind,
  type MerchantAcceptInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CONSOLE_ORDER_RECIPIENT_PURPOSE } from '../identity/index.js';
import { ORDERS_TRIPS, OrdersService, type OrdersTripsPort } from './orders.service.js';
import { OrderTipsService } from './tips.js';
import { OrderComplimentsService } from './compliments.js';

/** Live role checks, optionally scoped to an org (merchant staff of *this* restaurant). */
export interface OrgRoleChecker {
  hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean>;
}

export const ORDERS_ROLE_CHECKER = Symbol('ORDERS_ROLE_CHECKER');

const OPS: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];
const MERCHANT: readonly RoleKind[] = ['merchant_staff', 'merchant_owner'];

/**
 * `OrdersPort` for the tRPC router: maps the authenticated actor onto `OrdersService` and enforces
 * who may see or act on an order — orderer, rider/participant, the merchant's own staff, the
 * courier on its trip, or ops.
 */
@Injectable()
export class OrdersRpc implements OrdersPort {
  constructor(
    private readonly orders: OrdersService,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    @Inject(ORDERS_ROLE_CHECKER) private readonly roles: OrgRoleChecker,
    @Optional() private readonly tips?: OrderTipsService,
    @Optional() private readonly compliments?: OrderComplimentsService,
  ) {}

  /** «شنو عجبك بـ حيدر؟»: the orderer only (checked by the compliments service). */
  complimentOptions(actor: Actor, input: { orderId: string }): Promise<ComplimentOffer> {
    if (!this.compliments) throw new DriverError('internal');
    return this.compliments.options(actor.personId, input.orderId);
  }

  compliment(actor: Actor, input: ComplimentInput): Promise<ComplimentResult> {
    if (!this.compliments) throw new DriverError('internal');
    return this.compliments.send(actor.personId, input);
  }

  /** «تحب تكرم عباس؟»: the orderer only (checked by the tips service). */
  tipOptions(actor: Actor, input: { orderId: string }): Promise<TipOffer> {
    if (!this.tips) throw new DriverError('internal');
    return this.tips.options(actor.personId, input.orderId);
  }

  tip(actor: Actor, input: TipOrderInput): Promise<TipResult> {
    if (!this.tips) throw new DriverError('internal');
    return this.tips.tip(actor.personId, input);
  }

  place(actor: Actor, input: z.infer<typeof PlaceOrderInput>): Promise<Order> {
    return this.orders.place(actor.personId, input);
  }

  quote(actor: Actor, input: z.infer<typeof PlaceOrderInput>): Promise<OrderQuote> {
    return this.orders.quote(actor.personId, input);
  }

  async get(actor: Actor, input: { orderId: string }): Promise<Order> {
    const agg = await this.orders.aggregate(input.orderId);
    const o = agg.order;
    const own = o.ordererId === actor.personId || agg.participants.some((p) => p.personId === actor.personId);
    // SEC-14: the courier and the desk read the recipient's name (vault, logged); the kitchen does not.
    // The desk's read is a Console staff read, so it fails closed (STAFF_READ_PURPOSES); the courier's fails open.
    const carrier = !own && (await this.trips.activeForOrder(o.id))?.courierId === actor.personId;
    const desk = !own && !carrier && (await this.any(actor, OPS));
    const allowed = own || carrier || desk || (o.merchantOrgId !== null && (await this.merchantOf(actor, o.merchantOrgId)));
    if (!allowed) throw new DriverError('forbidden');
    // c9/s3: a ride for someone else names its rider for whoever may read the order.
    const [order] = await this.orders.withRiders([await this.orders.get(o.id)], actor.personId);
    const purpose = carrier ? 'partner_recipient' : desk ? CONSOLE_ORDER_RECIPIENT_PURPOSE : null;
    return purpose ? (await this.orders.withRecipients([order!], actor.personId, purpose))[0]! : order!;
  }

  async mine(actor: Actor): Promise<Order[]> {
    return this.orders.withRiders(await this.orders.listForPerson(actor.personId), actor.personId);
  }

  async listActive(actor: Actor, input: ListActiveOrdersInput): Promise<Order[]> {
    if (await this.any(actor, OPS)) return this.orders.listActive(input);
    if (!input.merchantOrgId || !(await this.merchantOf(actor, input.merchantOrgId))) throw new DriverError('forbidden');
    return this.orders.listActive({ merchantOrgId: input.merchantOrgId });
  }

  async cancellationPreview(actor: Actor, input: { orderId: string }): Promise<CancellationFee> {
    const { order } = await this.orders.aggregate(input.orderId);
    if (order.ordererId !== actor.personId && !(await this.any(actor, OPS))) throw new DriverError('forbidden');
    return this.orders.cancellationPreview(input.orderId);
  }

  cancel(actor: Actor, input: CancelOrderInput): Promise<Order> {
    return this.orders.cancel(actor.personId, input);
  }

  respondPartial(actor: Actor, input: RespondPartialInput): Promise<Order> {
    return this.orders.respondPartial(actor.personId, input);
  }

  openDispute(actor: Actor, input: OpenDisputeInput): Promise<Order> {
    return this.orders.openDispute(actor.personId, input);
  }

  rate(actor: Actor, input: RateOrderInput): Promise<Order> {
    return this.orders.rate(actor.personId, input);
  }

  confirmRideArrived(actor: Actor, input: { orderId: string }): Promise<Order> {
    return this.orders.confirmRideArrived(actor.personId, input);
  }

  comingOut(actor: Actor, input: { orderId: string }): Promise<ComingOutResult> {
    return this.orders.comingOut(actor.personId, input);
  }

  rideSwitchQuote(actor: Actor, input: { orderId: string; doorPickup: boolean }): Promise<RideSwitchQuote> {
    return this.orders.rideSwitchQuote(actor.personId, input);
  }

  switchRideVehicle(actor: Actor, input: { orderId: string; doorPickup: boolean; fareIqd: number; clientRequestId: string }): Promise<Order> {
    return this.orders.switchRideVehicle(actor.personId, input);
  }

  async merchantAccept(actor: Actor, input: z.infer<typeof MerchantAcceptInput>): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.merchantAccept(actor.personId, input);
  }

  async merchantReject(actor: Actor, input: MerchantRejectInput): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.merchantReject(actor.personId, input);
  }

  async markPreparing(actor: Actor, input: { orderId: string }): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.markPreparing(actor.personId, input);
  }

  async markReady(actor: Actor, input: { orderId: string }): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.markReady(actor.personId, input);
  }

  async merchantExtendPrep(actor: Actor, input: { orderId: string }): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.merchantExtendPrep(actor.personId, input);
  }

  async merchantHandOver(actor: Actor, input: { orderId: string }): Promise<Order> {
    await this.assertMerchantStaff(actor, input.orderId);
    return this.orders.merchantHandOver(actor.personId, input);
  }

  async merchantHeartbeat(actor: Actor, input: { merchantOrgId: string }): Promise<{ ok: true }> {
    if (!(await this.merchantOf(actor, input.merchantOrgId))) throw new DriverError('forbidden');
    await this.orders.merchantHeartbeat(input.merchantOrgId);
    return { ok: true };
  }

  private async assertMerchantStaff(actor: Actor, orderId: string): Promise<void> {
    const { order } = await this.orders.aggregate(orderId);
    if (!order.merchantOrgId || !(await this.merchantOf(actor, order.merchantOrgId))) throw new DriverError('forbidden');
  }

  private async merchantOf(actor: Actor, orgId: string): Promise<boolean> {
    for (const k of MERCHANT) if (await this.roles.hasRole(actor.personId, k, orgId)) return true;
    return false;
  }

  private async any(actor: Actor, kinds: readonly RoleKind[]): Promise<boolean> {
    for (const k of kinds) if (await this.roles.hasRole(actor.personId, k)) return true;
    return false;
  }
}
