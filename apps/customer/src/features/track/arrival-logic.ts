import type { DeliveryPoint, Order, SavedPlaceView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/** A saved place this close to the order's drop-off pin is the place it went to. */
export const SAME_PLACE_M = 150;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * C-11: the gate photo the customer saved for the place this order went to — the nearest saved place
 * (within 150 m of the drop-off pin) that has a photo. Null when none: the arrival screen then shows
 * no door card at all, never a placeholder.
 */
export function gatePhotoFor(dropoff: DeliveryPoint | null, places: ReadonlyArray<Pick<SavedPlaceView, 'pin' | 'photos'>>): string | null {
  const pin = dropoff?.pin;
  if (!pin) return null;
  let best: { d: number; url: string } | null = null;
  for (const p of places) {
    const url = p.photos[0]?.url;
    if (!url) continue;
    const d = metres(pin, p.pin);
    if (d <= SAME_PLACE_M && (!best || d < best.d)) best = { d, url };
  }
  return best?.url ?? null;
}

/** Opening a delivered order this soon after delivery still plays the moment (joy f2, L-04). */
export const ARRIVAL_REPLAY_MS = 10 * 60_000;

/** Storage key marking that this phone already played an order's delivered moment. */
export function arrivalSeenKey(orderId: string): string {
  return `driver.customer.arrival-seen.${orderId.replace(/[^\w.-]/g, '_')}`;
}

/**
 * Joy f2 (L-04): the delivered moment is a peak, so it plays once per order — when the screen saw it
 * happen, or when the customer opens the order within ten minutes of delivery (he tapped the push).
 * Once played on this phone it never replays; afterwards the order opens on its calm receipt.
 */
export function arrivalPlays(i: { seen: boolean; liveTransition: boolean; deliveredAt: Date | null; now: number }): boolean {
  if (i.seen) return false;
  if (i.liveTransition) return true;
  return i.deliveredAt !== null && i.now - i.deliveredAt.getTime() <= ARRIVAL_REPLAY_MS;
}

/**
 * C-11 / d-1: what the customer hands over at the door. Cash: the order's total (already rounded up
 * to 250 by the server) and the change in it that comes back to his wallet ("الباقي رصيد"). Wallet:
 * nothing to hand over.
 *
 * "الخردة علينا": `tender` is the note he said he will pay with and the change the courier brings for
 * it (null when he said none or the exact amount); `creditedIqd` is what landed in his wallet at the
 * door because the courier had no change (0 = none), and `paidIqd` the whole note he handed over then.
 */
export function cashAtDoor(
  order: Pick<Order, 'paymentMethod' | 'totalIqd' | 'changeIqd'> & Partial<Pick<Order, 'statedTenderIqd' | 'changeToWalletIqd'>>,
):
  | { kind: 'cash'; cashIqd: number; priceIqd: number; changeIqd: number; tender: { tenderIqd: number; changeIqd: number } | null; creditedIqd: number; paidIqd: number }
  | { kind: 'paid'; amountIqd: number } {
  if (order.paymentMethod !== 'cash') return { kind: 'paid', amountIqd: order.totalIqd };
  const changeIqd = order.changeIqd ?? 0;
  const t = order.statedTenderIqd ?? null;
  const creditedIqd = order.changeToWalletIqd ?? 0;
  return {
    kind: 'cash',
    cashIqd: order.totalIqd,
    priceIqd: order.totalIqd - changeIqd,
    changeIqd,
    tender: t !== null && t > order.totalIqd ? { tenderIqd: t, changeIqd: t - order.totalIqd } : null,
    creditedIqd,
    paidIqd: order.totalIqd + creditedIqd,
  };
}

/**
 * The «almost there» / «at the door» card's words (HUNT-02): an order placed «بالشارع» (the server's
 * `streetHandover`, −250) asks the customer out to the street near the pin, where the courier calls
 * him, instead of «عند بابك». The door card's body (cash to hand over / paid) is the same either way.
 */
export function doorCardKeys(order: Pick<Order, 'paymentMethod'> & Partial<Pick<Order, 'streetHandover'>>, atDoor: boolean): { title: MessageKey; body: MessageKey } {
  const cash = order.paymentMethod === 'cash';
  const street = order.streetHandover === true;
  if (atDoor) return { title: street ? 'track.door_title_street' : 'track.door_title', body: cash ? 'track.door_cash' : 'track.door_paid' };
  if (street) return { title: 'track.near_title', body: cash ? 'track.near_street_cash' : 'track.near_street_paid' };
  return { title: 'track.near_title', body: cash ? 'track.cash_ready' : 'track.near_paid' };
}
