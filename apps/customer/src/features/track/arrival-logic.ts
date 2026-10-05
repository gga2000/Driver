import type { DeliveryPoint, Order, SavedPlaceView } from '@driver/contracts';

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

/**
 * C-11 / d-1: what the customer hands over at the door. Cash: the order's total (already rounded up
 * to 250 by the server) and the change in it that comes back to his wallet ("الباقي رصيد"). Wallet:
 * nothing to hand over.
 */
export function cashAtDoor(order: Pick<Order, 'paymentMethod' | 'totalIqd' | 'changeIqd'>): { kind: 'cash'; cashIqd: number; priceIqd: number; changeIqd: number } | { kind: 'paid'; amountIqd: number } {
  if (order.paymentMethod !== 'cash') return { kind: 'paid', amountIqd: order.totalIqd };
  const changeIqd = order.changeIqd ?? 0;
  return { kind: 'cash', cashIqd: order.totalIqd, priceIqd: order.totalIqd - changeIqd, changeIqd };
}
