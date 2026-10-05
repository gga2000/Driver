import { TOWN_SPEED_KMH, type PartnerOffer, type VehicleClass } from '@driver/contracts';

/**
 * The 2-second offer card (partner S-1, P-03, P-04): pure layout and summary logic, unit-tested.
 * The whole offer — pay, the km/minutes line, cash, pickup → drop-off and the accept bar — must fit
 * a 360×740 phone without scrolling; the map gives way first.
 */

/** Below this window height the map shrinks (P-04: `min(220, 28vh)`). */
export const OFFER_COMPACT_BELOW = 800;
export const OFFER_MAP_FULL = 300;
export const OFFER_MAP_COMPACT_MAX = 220;
/** Never shrink the map below a readable strip (pins plus the decline chip). */
export const OFFER_MAP_MIN = 150;
/** Under this distance to the pickup, say "جنبك" instead of "يبعد 0 كم". */
export const OFFER_NEAR_KM = 0.1;

export interface OfferLayout {
  compact: boolean;
  mapHeight: number;
  /** Pay display size (numeral tokens: 48/64 compact, 56/72 otherwise). */
  payFontSize: number;
  payLineHeight: number;
}

export function offerLayout(windowHeight: number): OfferLayout {
  const compact = windowHeight < OFFER_COMPACT_BELOW;
  const mapHeight = compact ? Math.max(OFFER_MAP_MIN, Math.min(OFFER_MAP_COMPACT_MAX, Math.round(windowHeight * 0.28))) : OFFER_MAP_FULL;
  return { compact, mapHeight, payFontSize: compact ? 48 : 56, payLineHeight: compact ? 60 : 70 };
}

export interface OfferSummary {
  /** Pickup leg + trip, one decimal; null when the server sent neither. */
  totalKm: number | null;
  /** Rough minutes to finish: ride (or wait for the kitchen) to the pickup, then the trip. */
  minutes: number | null;
  /** Pickup is right here ("جنبك"). */
  near: boolean;
  /** Cash he collects at the door; null when prepaid or a ride without cash. */
  collectIqd: number | null;
  /** Food paid online: say so (he collects nothing). */
  prepaid: boolean;
  /** Pay is a single component: its line folds into "تفاصيل" (nothing to explain). */
  singleComponent: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes for `km` in town on `vehicle` (shared dispatch speeds), at least one. */
export function rideMinutes(km: number, vehicle: VehicleClass): number {
  return Math.max(1, Math.round((km / TOWN_SPEED_KMH[vehicle]) * 60));
}

export function offerSummary(offer: Pick<PartnerOffer, 'distanceToPickupKm' | 'tripKm' | 'merchant' | 'collectIqd' | 'pay' | 'vertical'>, vehicle: VehicleClass, ride: boolean): OfferSummary {
  const toPickup = offer.distanceToPickupKm;
  const trip = offer.tripKm;
  const totalKm = toPickup === null && trip === null ? null : round1((toPickup ?? 0) + (trip ?? 0));
  let minutes: number | null = null;
  if (totalKm !== null) {
    const driveToPickup = toPickup !== null ? rideMinutes(toPickup, vehicle) : 0;
    // A courier who gets there early waits for the kitchen: the later of the two counts.
    const ready = !ride && offer.merchant && (offer.merchant.state === 'preparing' || offer.merchant.state === 'waiting') ? (offer.merchant.readyInMin ?? 0) : 0;
    minutes = Math.max(driveToPickup, ready) + (trip !== null ? rideMinutes(trip, vehicle) : 0);
    minutes = Math.max(1, minutes);
  }
  return {
    totalKm,
    minutes,
    near: toPickup !== null && toPickup < OFFER_NEAR_KM,
    collectIqd: offer.collectIqd && offer.collectIqd > 0 ? offer.collectIqd : null,
    prepaid: !ride && !(offer.collectIqd && offer.collectIqd > 0),
    singleComponent: offer.pay.components.length <= 1,
  };
}

/**
 * Whether "تفاصيل الأجرة" starts open: only with more than one component (one line explains
 * nothing) and only when the open list still fits the window above the fold.
 */
export function offerDetailsOpen(l: OfferLayout, o: { batch: boolean; components: number }, windowHeight: number): boolean {
  if (o.components <= 1) return false;
  return l.mapHeight + offerBodyHeight(l, { batch: o.batch, details: true, components: o.components }) <= windowHeight;
}

/**
 * Rough height of the card body under the map at a given layout, used by the test that guards
 * "fits 360×740 without scrolling" (P-04). Numbers mirror the styles in `app/offer.tsx`.
 */
export function offerBodyHeight(l: OfferLayout, o: { batch: boolean; details: boolean; components: number }): number {
  const pad = 20 * 2; // card padding top + bottom
  const gap = l.compact ? 12 : 16;
  const pay = l.payLineHeight;
  const summary = 32; // km · minutes line (title) with the cash chip beside it
  const batch = o.batch ? 56 + gap : 0;
  const route = 2 * 46 + 12; // two nodes (title + caption) and the rail gap
  const details = 44 + (o.details ? o.components * 24 + 8 : 0); // disclosure row (+ lines when open)
  const accept = 72 + 16 * 2; // accept bar + its padding
  const seam = -24; // card overlaps the map
  return seam + pad + pay + gap + summary + batch + gap + route + gap + details + accept;
}
