import type { Order, OrderHistoryRow } from '@driver/contracts';
import { followsInTrackV2 } from '@/features/track/track-v2';
import { canReorder, isRunning, shortStatus, type ShortStatus } from './history';

/**
 * «طلباتي» redesigned (after-order design Step 4, switch `orders_v2`): the pure parts. Kitchen orders
 * get the new rows (a dish picture, a saffron «اطلبه مرة ثانية», a paper receipt); rides, الرجعة seats
 * and parcels keep their own rows and colours (the taxi and trips threads own those). Nothing here
 * decides money or a status: every amount and state is the order's, as the server sent it.
 */

/** Rows the new look draws: kitchen orders (food, grocery); everything else keeps its row. */
export function drawsAsFood(row: Pick<OrderHistoryRow, 'order'>): boolean {
  return followsInTrackV2(row.order.type);
}

/** The dish whose picture stands for the order (o1): its first dish, as the live screen's kitchen card. */
export function rowDish(row: Pick<OrderHistoryRow, 'order' | 'items'>): { id: string; name: string } {
  const first = row.items[0];
  return { id: first?.lineId ?? row.order.id, name: first?.name ?? '' };
}

/**
 * «اطلبه مرة ثانية» on a row (o3): a kitchen order that reached the door, placed by this person (one
 * he only ate from is someone else's to repeat). Same rule as the old list.
 */
export function canOrderAgain(row: Pick<OrderHistoryRow, 'order'>, me: string | null): boolean {
  return canReorder(row.order) && (!me || row.order.ordererId === me);
}

/**
 * The one word a finished kitchen row still says (o1): nothing for one that arrived (the picture and
 * «اطلبه مرة ثانية» say it), else what happened («انلغى», «رجعت فلوسك», «بالمراجعة»).
 */
export function rowWord(o: Pick<Order, 'state' | 'type'>): ShortStatus | null {
  if (isRunning(o)) return shortStatus(o);
  const s = shortStatus(o);
  return s === 'delivered' || s === 'done' ? null : s;
}

/**
 * Where tapping a kitchen row goes (o7): a running order to its live screen, a finished one to its
 * receipt («الوصل»).
 */
export function rowOpens(o: Pick<Order, 'state'>): 'live' | 'receipt' {
  return isRunning(o) ? 'live' : 'receipt';
}

/**
 * The stamp across a finished receipt: the one word for an order that did not end as a normal
 * delivery («انلغى», «انرفض», «رجعت فلوسه», «شكوى مفتوحة», «ما كمل»); null when it arrived.
 */
export type ReceiptStamp = Extract<ShortStatus, 'cancelled' | 'rejected' | 'refunded' | 'disputed' | 'failed'> | null;

export function receiptStamp(o: Pick<Order, 'state' | 'type'>): ReceiptStamp {
  const s = shortStatus(o);
  return s === 'cancelled' || s === 'rejected' || s === 'refunded' || s === 'disputed' || s === 'failed' ? s : null;
}
