import { AZIZIYAH_ZONES, type PartnerJob, type PartnerJobStop, type PartnerPayKey, type VehicleClass, type Vertical } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { toWesternDigits } from '@/lib/phone';

/**
 * Pure rules behind the Partner screens (plain Node: no React Native here, unit-tested).
 */

export type Locale = 'ar-IQ' | 'en';
type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Zone display name with Western digits ("شارع 30"); the centre reads as "المركز". */
export function zoneName(zoneId: string, locale: Locale = 'ar-IQ', t?: T): string {
  if (zoneId === 'centre' && t) return t('partner.zone_centre_short');
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneId);
  if (!z) return zoneId;
  return locale === 'en' ? z.name_en : toWesternDigits(z.name_ar);
}

/** "بالمركز" / "بالهاشمي" / "بشارع 30" — the `{where}` of the demand hint. */
export function inZone(zoneId: string, t: T, locale: Locale = 'ar-IQ'): string {
  return t('partner.in_zone', { zone: zoneName(zoneId, locale, t) });
}

/** Iraqi number agreement for counted nouns: واحد · 2–10 plural · 11+ singular ("14 طلب"). */
export type PluralForm = 'zero' | 'one' | 'few' | 'many';
export function pluralForm(n: number): PluralForm {
  if (n <= 0) return 'zero';
  if (n === 1) return 'one';
  if (n <= 10) return 'few';
  return 'many';
}

/** "12,500 · 6 طلبات" with Iraqi number agreement (طلب واحد · 3–10 طلبات · 11+ طلب). */
export function todayKey(jobs: number): MessageKey {
  return ({ zero: 'partner.today_zero', one: 'partner.today_one', few: 'partner.today_few', many: 'partner.today_many' } as const)[pluralForm(jobs)];
}

/** "7 طلبات" / "طلب واحد" / "14 طلب". */
export function jobsKey(n: number): MessageKey {
  return ({ zero: 'partner.today_zero', one: 'partner.jobs_one', few: 'partner.jobs_count', many: 'partner.jobs_many' } as const)[pluralForm(n)];
}

/** Demand detail: "3 طلبات تنتظر" and "سايق واحد قريب". */
export function waitingKey(n: number): MessageKey {
  return ({ zero: 'partner.waiting_one', one: 'partner.waiting_one', few: 'partner.waiting_few', many: 'partner.waiting_many' } as const)[pluralForm(n)];
}
export function driversKey(n: number): MessageKey {
  return ({ zero: 'partner.drivers_zero', one: 'partner.drivers_one', few: 'partner.drivers_few', many: 'partner.drivers_many' } as const)[pluralForm(n)];
}

/** 0..1 of the cash cap in use, for the mini bar. */
export function capShare(owedIqd: number, capIqd: number): number {
  if (capIqd <= 0) return 0;
  return Math.max(0, Math.min(1, owedIqd / capIqd));
}

export const VEHICLE_KEY: Record<VehicleClass, MessageKey> = {
  bike: 'partner.vehicle_bike',
  tuktuk: 'partner.vehicle_tuktuk',
  car: 'partner.vehicle_car',
  suv: 'partner.vehicle_suv',
  van: 'partner.vehicle_van',
  intercity: 'partner.vehicle_intercity',
};

export const VEHICLE_ICON: Record<VehicleClass, 'bike' | 'tuktuk' | 'car'> = {
  bike: 'bike',
  tuktuk: 'tuktuk',
  car: 'car',
  suv: 'car',
  van: 'car',
  intercity: 'car',
};

export const KIND_KEY: Record<Vertical, MessageKey> = {
  food: 'partner.kind_food',
  grocery: 'partner.kind_grocery',
  errand: 'partner.kind_errand',
  parcel: 'partner.kind_parcel',
  taxi: 'partner.kind_taxi',
  tuktuk: 'partner.kind_tuktuk',
  intercity: 'partner.kind_intercity',
  khat: 'partner.kind_khat',
};

export const PAY_KEY: Record<PartnerPayKey, MessageKey> = {
  delivery: 'partner.pay_delivery',
  fare: 'partner.pay_fare',
  distance: 'partner.pay_distance',
  wait: 'partner.pay_wait',
  batch_bonus: 'partner.pay_batch_bonus',
  pickup_compensation: 'partner.pay_pickup_compensation',
  night: 'partner.pay_night',
  weather: 'partner.pay_weather',
  peak: 'partner.pay_peak',
  door_pickup: 'partner.pay_door_pickup',
  tip: 'partner.pay_tip',
};

export function isRide(vertical: Vertical): boolean {
  return vertical === 'taxi' || vertical === 'tuktuk' || vertical === 'intercity' || vertical === 'khat';
}

/** Seconds left on an offer ring (never negative, rounded up like the ring's number). */
export function secondsLeft(expiresAt: Date, now: number): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000));
}

/** Offers count as seen after 3 s in the foreground (edge-case §6). */
export const OFFER_SEEN_AFTER_MS = 3_000;

/** Signature S-1: in the last 5 seconds a `warning` haptic every second, on top of the looping sound. */
export const OFFER_WARN_FROM_S = 5;
export function offerWarnTick(secondsLeftNow: number): boolean {
  return secondsLeftNow > 0 && secondsLeftNow <= OFFER_WARN_FROM_S;
}

/** Keep the screen on while he can get an offer or is on a job (P-01). */
export function keepScreenOn(s: { online: boolean; activeTripId: string | null } | undefined): boolean {
  return Boolean(s && (s.online || s.activeTripId));
}

/**
 * The one button on the job screen: what it says and what it does for the current stop.
 * pending → "وصلت للمطعم/للزبون" (trips.arrive); arrived → "استلمت/سلّمت" (trips.completeStop).
 */
export interface JobAction {
  kind: 'arrive' | 'complete';
  label: MessageKey;
  /** Headline of the task card ("روح للمطعم", "إنت عند الزبون"). */
  title: MessageKey;
  /** A dropoff completion that takes cash first (cash sheet). */
  needsCash: boolean;
  /** The handover photo is asked for at a dropoff before "سلّمت". */
  wantsPhoto: boolean;
}

export function jobAction(stop: Pick<PartnerJobStop, 'type' | 'state' | 'collectIqd'>, vertical: Vertical): JobAction {
  const ride = isRide(vertical);
  const pickup = stop.type === 'pickup' || stop.type === 'shop';
  const arrived = stop.state === 'arrived';
  if (pickup) {
    return arrived
      ? { kind: 'complete', label: ride ? 'partner.action_rider_in' : 'partner.action_picked_up', title: ride ? 'partner.task_go_rider' : 'partner.task_at_pickup', needsCash: false, wantsPhoto: false }
      : { kind: 'arrive', label: ride ? 'partner.action_arrived_rider' : 'partner.action_arrived_pickup', title: ride ? 'partner.task_go_rider' : 'partner.task_go_pickup', needsCash: false, wantsPhoto: false };
  }
  return arrived
    ? {
        kind: 'complete',
        label: ride ? 'partner.complete_trip' : 'partner.action_delivered',
        title: ride ? 'partner.task_go_destination' : 'partner.task_at_dropoff',
        needsCash: !ride && stop.collectIqd > 0,
        wantsPhoto: !ride,
      }
    : { kind: 'arrive', label: ride ? 'partner.action_arrived_destination' : 'partner.action_arrived_dropoff', title: ride ? 'partner.task_go_destination' : 'partner.task_go_dropoff', needsCash: false, wantsPhoto: false };
}

/** Position of the current stop among the job's open-or-done stops: "مهمة 2 من 3". */
export function taskProgress(job: Pick<PartnerJob, 'stops' | 'currentStopId'>): { n: number; total: number } {
  const stops = job.stops.filter((s) => s.state !== 'skipped');
  const i = stops.findIndex((s) => s.stopId === job.currentStopId);
  return { n: i < 0 ? stops.length : i + 1, total: stops.length };
}

/** Unreachable protocol (domain §2): dispatcher at 3:00, the driver may end it at 5:00. */
export interface UnreachablePhase {
  elapsedMs: number;
  /** Until the driver may end the job. */
  remainingMs: number;
  dispatcherAlerted: boolean;
  canFail: boolean;
}

export function unreachablePhase(u: { startedAt: Date; escalateAt: Date; failAllowedAt: Date }, now: number): UnreachablePhase {
  return {
    elapsedMs: Math.max(0, now - u.startedAt.getTime()),
    remainingMs: Math.max(0, u.failAllowedAt.getTime() - now),
    dispatcherAlerted: now >= u.escalateAt.getTime(),
    canFail: now >= u.failAllowedAt.getTime(),
  };
}

/** `m:ss` for countdowns (voice guide §5). */
export function clock(ms: number): { minutes: string; seconds: string } {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return { minutes: String(Math.floor(s / 60)), seconds: String(s % 60).padStart(2, '0') };
}

/** One decimal, Western digits, no trailing ".0" ("0.8", "2", "12.4"). */
export function km(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Deep link that opens the phone's maps app at a pin (Google Maps works on both platforms and the web). */
export function mapsUrl(pin: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}&travelmode=driving`;
}

// ───────────────────────── wallet top-up on a job ─────────────────────────

/**
 * "الزبون يريد يشحن محفظته" shows while a courier carries a live order: a delivery (not a ride) with
 * a drop-off still to do. The API checks the same (`topup_courier_not_assigned`), and only couriers
 * may confirm (`partner.confirmTopUp`).
 */
export function canTopUpOnJob(
  job: Pick<PartnerJob, 'vertical' | 'stops'> | null | undefined,
  roles: readonly string[],
): boolean {
  if (!job || !roles.includes('courier') || isRide(job.vertical)) return false;
  return job.stops.some(
    (s) =>
      s.type === 'dropoff' &&
      s.orderId !== null &&
      s.state !== 'completed' &&
      s.state !== 'skipped',
  );
}

/**
 * The cash cap before and after taking a top-up in cash (money §4: it counts until he settles). The
 * bar is cash in hand against the cap; "over" follows the server's maths (owed, net of what we owe him).
 */
export function topUpCapEffect(
  cash: { heldIqd: number; owedIqd: number; capIqd: number },
  amountIqd: number,
): { heldIqd: number; afterIqd: number; capIqd: number; overCap: boolean } {
  const add = Math.max(0, amountIqd);
  // P-05 one cash truth: the cap counts what he must hand over (`owedIqd`), so the top-up adds to that.
  return {
    heldIqd: cash.heldIqd,
    afterIqd: cash.owedIqd + add,
    capIqd: cash.capIqd,
    overCap: cash.capIqd > 0 && cash.owedIqd + add > cash.capIqd,
  };
}
