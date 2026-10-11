import type { PartnerOffer, VehicleClass, Vertical } from '@driver/contracts';
import type { PartnerService } from '@driver/design-tokens';
import type { MessageKey } from '@driver/i18n';
import { KIND_KEY, pluralForm } from '@/features/work/logic';
import { rideMinutes } from '@/features/work/offer-layout';
import type { TFn } from '@/lib/i18n';

/**
 * The order slip (partner redesign o1–o15): pure rules behind `app/offer.tsx`, unit-tested.
 */

/** o1 / b9: the slip's colour by service — food saffron, taxi yellow, tuktuk plum, trips brown and gold. */
export function serviceOf(vertical: Vertical): PartnerService {
  if (vertical === 'taxi') return 'taxi';
  if (vertical === 'tuktuk') return 'tuktuk';
  if (vertical === 'intercity' || vertical === 'khat') return 'trips';
  return 'food';
}

/** o10: «أول مشوار له ويانا» / «ركب ويانا 12 مشوار». */
export function riderTripsKey(n: number): MessageKey {
  return ({ zero: 'partner.slip_rider_zero', one: 'partner.slip_rider_one', few: 'partner.slip_rider_few', many: 'partner.slip_rider_many' } as const)[pluralForm(n)];
}

/** Seconds at or under which the time bar turns urgent and ticks softly (o6). */
export const SLIP_URGENT_S = 5;

/** o6: share of the ring still left, 0–1. */
export function timeShare(expiresAt: Date, ringSec: number, now: number): number {
  const total = ringSec * 1000;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (expiresAt.getTime() - now) / total));
}

/**
 * o13: roughly how many minutes a second order on the way adds — its own leg at town speed. Null
 * when it isn't a second order or the leg is unknown.
 */
export function batchMinutes(offer: Pick<PartnerOffer, 'batch' | 'tripKm'>, vehicle: VehicleClass): number | null {
  if (!offer.batch || offer.tripKm === null) return null;
  return rideMinutes(offer.tripKm, vehicle);
}

/**
 * The offer's end on this phone's clock: the time the server said was left (`expiresAt - serverNow`),
 * counted from when the answer reached the phone. A phone whose clock is minutes off still counts the
 * ring right; only the trip over the network is lost.
 */
export function localExpiry(offer: Pick<PartnerOffer, 'expiresAt' | 'serverNow'>, receivedAt: number): Date {
  return new Date(receivedAt + (offer.expiresAt.getTime() - offer.serverNow.getTime()));
}

/**
 * The offer card comes back on top while the offer is still unanswered (he pressed back, or the browser's
 * back): any ringing offer not yet answered or dropped on this phone, unless the card is already showing.
 */
export function shouldOpenOffer(offerId: string | null, top: string | undefined, done: ReadonlySet<string>): boolean {
  return offerId !== null && top !== 'offer' && !done.has(offerId);
}

/** Offers answered, rung out or dropped on this phone: the watcher never brings these back. */
export const finishedOffers = new Set<string>();

/**
 * l8: an offer that was already over when it reached the screen (the phone was offline, or asleep)
 * is dropped quietly — he never gets a surprise order with no time to read it.
 */
export function arrivedTooLate(expiresAt: Date, now: number, minMs = 2_000): boolean {
  return expiresAt.getTime() - now < minMs;
}

/**
 * o4: what is read aloud — the kind, the money and where: «طلب أكل، 1250 دينار، مطعم خالد، كاش
 * 18000». Amounts without separators so every voice reads them as one number.
 */
export function speakText(offer: Pick<PartnerOffer, 'vertical' | 'pay' | 'pickup' | 'collectIqd' | 'merchant'>, place: string, t: TFn, locale: string): string {
  const parts = [t('partner.slip_speak', { kind: t(KIND_KEY[offer.vertical]), amount: String(offer.pay.totalIqd), place })];
  if (offer.merchant && offer.merchant.state === 'preparing' && offer.merchant.readyInMin) parts.push(t('partner.slip_speak_ready', { minutes: offer.merchant.readyInMin }));
  if (offer.collectIqd && offer.collectIqd > 0) parts.push(t('partner.slip_speak_cash', { amount: String(offer.collectIqd) }));
  return parts.join(locale === 'en' ? ', ' : '، ');
}
