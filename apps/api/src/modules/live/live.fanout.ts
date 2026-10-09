import {
  ChatThreadKind,
  OrderState,
  liveChannel,
  type LiveBusEvent,
  type LiveKey,
} from '@driver/contracts';

/**
 * Outbox event → live events per channel (pure, given the lookups). Compact on purpose: ids and
 * the query keys that changed, plus a minimal patch where the client can use one (the new order
 * state, a new order for the kitchen's ring, a chat message). Anything not covered here is still
 * caught by the clients' slow safety refetch.
 */

/** The slice of a stored outbox event the fan-out reads. */
export interface FanoutInput {
  type: string;
  aggregate: string;
  aggregateId: string;
  orderId?: string | undefined;
  tripId?: string | undefined;
  payload: Record<string, unknown>;
}

export interface FanoutLookups {
  order(orderId: string): Promise<{ cityId: string; merchantOrgId: string | null } | null>;
  /** The courier carrying the order now (or last), if any. */
  courierOf(orderId: string): Promise<string | null>;
  trip(
    tripId: string,
  ): Promise<{ cityId: string; courierId: string | null; orderIds: string[] } | null>;
}

export interface Publication {
  channel: string;
  event: LiveBusEvent;
}

const MERCHANT_CHAT_KINDS: ReadonlySet<ChatThreadKind> = new Set([
  'merchant_courier',
  'customer_merchant',
]);
/** Events after which a driver's cash held / today's earnings may have moved. */
const DRIVER_MONEY =
  /^(order\.(cash_collected|closed|delivered|completed)|stop\.completed|trip\.completed|ops\.|merchant\.paid_by_courier|wallet\.|cash\.)/;

/** Collects invalidations per channel (merged keys) and patches, in order. */
class Out {
  private readonly keys = new Map<
    string,
    { keys: Set<LiveKey>; ids: { orderId?: string; tripId?: string } }
  >();
  private readonly patches: Publication[] = [];

  constructor(private readonly cause: string) {}

  invalidate(
    channel: string,
    keys: readonly LiveKey[],
    ids: { orderId?: string | undefined; tripId?: string | undefined } = {},
  ): void {
    let row = this.keys.get(channel);
    if (!row) this.keys.set(channel, (row = { keys: new Set(), ids: {} }));
    for (const k of keys) row.keys.add(k);
    if (ids.orderId && !row.ids.orderId) row.ids.orderId = ids.orderId;
    if (ids.tripId && !row.ids.tripId) row.ids.tripId = ids.tripId;
  }

  patch(channel: string, event: LiveBusEvent): void {
    this.patches.push({ channel, event });
  }

  list(): Publication[] {
    const inv: Publication[] = [...this.keys.entries()].map(([channel, row]) => ({
      channel,
      event: {
        type: 'invalidate',
        keys: [...row.keys],
        cause: this.cause,
        ...(row.ids.orderId ? { orderId: row.ids.orderId } : {}),
        ...(row.ids.tripId ? { tripId: row.ids.tripId } : {}),
      },
    }));
    // Patches first: the merchant's ring (`new_order`) and the new state land before the re-read.
    return [...this.patches, ...inv];
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

export async function fanout(e: FanoutInput, look: FanoutLookups): Promise<Publication[]> {
  const out = new Out(e.type);
  const p = e.payload ?? {};

  // ── chat ──
  if (e.type === 'chat.message_sent') {
    const orderId = str(p['orderId']) ?? e.orderId ?? null;
    const kind = ChatThreadKind.safeParse(p['kind']);
    const threadId = str(p['threadId']) ?? e.aggregateId;
    if (!orderId || !kind.success) return [];
    if (kind.data === 'rider_driver') {
      // A Baghdad/Kut pair thread (step 4c): its own channel; the other side's badges re-read.
      const trip = p['trip'] && typeof p['trip'] === 'object' ? (p['trip'] as Record<string, unknown>) : {};
      const partyId = str(trip['partyId']);
      if (!partyId) return [];
      out.patch(liveChannel.tripChat(orderId, partyId), {
        type: 'chat',
        orderId,
        kind: kind.data,
        threadId,
        seq: typeof p['seq'] === 'number' ? p['seq'] : 0,
        partyId,
      });
      for (const to of strs(p['recipientIds']))
        out.invalidate(liveChannel.driver(to), ['chat.trip.threads'], { orderId });
      return out.list();
    }
    out.patch(liveChannel.chat(orderId, kind.data), {
      type: 'chat',
      orderId,
      kind: kind.data,
      threadId,
      seq: typeof p['seq'] === 'number' ? p['seq'] : 0,
    });
    out.invalidate(liveChannel.order(orderId), ['chat.threads'], { orderId });
    for (const to of strs(p['recipientIds']))
      out.invalidate(liveChannel.driver(to), ['chat.threads'], { orderId });
    if (MERCHANT_CHAT_KINDS.has(kind.data)) {
      const order = await look.order(orderId);
      if (order?.merchantOrgId)
        out.invalidate(liveChannel.merchant(order.merchantOrgId), ['chat.threads'], { orderId });
    }
    return out.list();
  }

  // ── merchant store (open/closed, busy, printer, menu, deals) ──
  if (e.aggregate === 'merchant')
    out.invalidate(liveChannel.merchant(e.aggregateId), ['merchant.storeStatus', 'merchant.board']);

  // ── a person's own state (roles, check-in gate, verification, wallet) → his partner status ──
  if (e.aggregate === 'person')
    out.invalidate(liveChannel.driver(e.aggregateId), ['partner.status']);

  // ── money moved for a named courier/driver ──
  for (const id of [str(p['courierId']), str(p['driverId'])])
    if (id && DRIVER_MONEY.test(e.type)) out.invalidate(liveChannel.driver(id), ['partner.status']);

  // ── dispatch: offers to drivers, the board ──
  if (e.type.startsWith('dispatch.') || e.type.startsWith('substitute.')) {
    const drivers = new Set([
      ...strs(p['driverIds']),
      ...[str(p['driverId'])].filter((x): x is string => x !== null),
    ]);
    for (const d of drivers)
      out.invalidate(liveChannel.driver(d), ['partner.currentOffer', 'partner.activeJob'], {
        tripId: e.tripId,
      });
    const cityId = str(p['cityId']);
    if (cityId)
      out.invalidate(
        liveChannel.city(cityId),
        ['dispatch.board', 'trips.board', 'console.rightNow', 'dispatch.drivers'],
        { tripId: e.tripId },
      );
    // Ride step 3 (n3): the rider's list of the drivers sent his ride (sent, seen, declined, nudged…).
    const vertical = str(p['vertical']);
    if (e.tripId && (vertical === 'taxi' || vertical === 'tuktuk')) {
      const trip = await look.trip(e.tripId);
      for (const id of trip?.orderIds ?? [])
        out.invalidate(liveChannel.order(id), ['dispatch.myRideOffers'], { orderId: id, tripId: e.tripId });
    }
  }

  // ── a trip moved: its courier, its orders' customers and kitchens, the city board ──
  const tripId = e.tripId ?? (e.aggregate === 'trip' ? e.aggregateId : undefined);
  const orderIds = new Set<string>();
  if (
    tripId &&
    (e.type.startsWith('trip.') || e.type.startsWith('stop.') || e.type.startsWith('khat.'))
  ) {
    const trip = await look.trip(tripId);
    if (trip) {
      if (trip.courierId)
        out.invalidate(
          liveChannel.driver(trip.courierId),
          [
            'partner.activeJob',
            'partner.status',
            ...(e.type === 'trip.accepted' ? (['partner.currentOffer'] as const) : []),
          ],
          { tripId },
        );
      for (const id of trip.orderIds) orderIds.add(id);
      out.invalidate(
        liveChannel.city(trip.cityId),
        ['trips.board', 'dispatch.board', 'console.rightNow', 'dispatch.drivers'],
        { tripId },
      );
    }
    for (const id of orderIds)
      out.invalidate(liveChannel.order(id), ['orders.track', 'orders.courierPosition'], {
        orderId: id,
        tripId,
      });
  }

  // ── an order moved: its customer, kitchen, courier and the city board ──
  const orderId = e.orderId ?? (e.aggregate === 'order' ? e.aggregateId : undefined);
  if (orderId) orderIds.add(orderId);
  for (const id of orderIds) {
    const order = await look.order(id);
    if (!order) continue;
    if (order.merchantOrgId) {
      out.invalidate(liveChannel.merchant(order.merchantOrgId), ['merchant.board'], {
        orderId: id,
      });
      if (e.type === 'order.offered_to_merchant' && p['autoAccept'] !== true)
        out.patch(liveChannel.merchant(order.merchantOrgId), {
          type: 'new_order',
          orderId: id,
          merchantOrgId: order.merchantOrgId,
        });
    }
    if (id !== orderId) continue;
    // Only order events carry an order state in `to` (trip events carry trip states).
    const to = e.type.startsWith('order.') ? OrderState.safeParse(p['to']) : null;
    if (to?.success)
      out.patch(liveChannel.order(id), {
        type: 'order_state',
        orderId: id,
        state: to.data,
        cause: e.type,
      });
    out.invalidate(liveChannel.order(id), ['orders.track', 'orders.mine'], { orderId: id });
    out.invalidate(liveChannel.city(order.cityId), ['orders.listActive', 'console.rightNow'], {
      orderId: id,
    });
    if (e.type.startsWith('order.')) {
      const courier = await look.courierOf(id);
      if (courier)
        out.invalidate(
          liveChannel.driver(courier),
          DRIVER_MONEY.test(e.type)
            ? ['partner.activeJob', 'partner.status']
            : ['partner.activeJob'],
          { orderId: id },
        );
    }
  }

  return out.list();
}
