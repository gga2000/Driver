import type { OrderState } from '@driver/contracts';
import type { MerchantProfile } from './merchants.port.js';
import type { OrdersRepository } from './orders.repository.js';

/** Shop rules Ali set on 2026-10-08 (decision card "Use my picks", the shop rules page). */
export const SHOP_LOAD_RULES = {
  /**
   * h5 ("After 5 minutes offline"): a shop whose tablet has sent no heartbeat for this long takes no
   * new orders (a power cut would otherwise ring nowhere and time out on the shop). A shop whose
   * tablet never connected is not paused by this (it has no heartbeat to lose).
   */
  offlinePauseAfterMin: 5,
  /**
   * l4 ("At 15 waiting orders"): from this many orders not yet ready, new customers see the shop as
   * busy (the card's «مزدحم» and the busy extra on its ETA) before they order.
   */
  busyAtWaitingOrders: 15,
} as const;

/** Orders the kitchen still has to make (scheduled ones not yet due are not waiting). */
const WAITING: readonly OrderState[] = ['placed', 'merchant_accepted', 'preparing'];

/** h5: the shop's tablet went silent more than 5 minutes ago. */
export function tabletOffline(profile: Pick<MerchantProfile, 'lastHeartbeatAt'> | null | undefined, at: Date): boolean {
  const last = profile?.lastHeartbeatAt;
  return last != null && at.getTime() - last.getTime() > SHOP_LOAD_RULES.offlinePauseAfterMin * 60_000;
}

/**
 * l4: how many orders a shop has waiting, read at most once per `ttlMs` per shop on this instance (the
 * restaurant list asks for every card).
 */
export class ShopLoad {
  private readonly cache = new Map<string, { at: number; n: number }>();

  constructor(
    private readonly orders: Pick<OrdersRepository, 'findMany'>,
    private readonly ttlMs = 20_000,
  ) {}

  async waiting(merchantOrgId: string, at: Date): Promise<number> {
    const hit = this.cache.get(merchantOrgId);
    if (hit && at.getTime() - hit.at >= 0 && at.getTime() - hit.at < this.ttlMs) return hit.n;
    const live = await this.orders.findMany({ merchantOrgId, states: WAITING });
    const n = live.filter((o) => !o.scheduledFor || o.scheduledFor.getTime() <= at.getTime()).length;
    this.cache.set(merchantOrgId, { at: at.getTime(), n });
    return n;
  }

  async crowded(merchantOrgId: string, at: Date): Promise<boolean> {
    return (await this.waiting(merchantOrgId, at)) >= SHOP_LOAD_RULES.busyAtWaitingOrders;
  }
}
