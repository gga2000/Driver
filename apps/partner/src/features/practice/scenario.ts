import type { MessageKey } from '@driver/i18n';
import type { HandoverProof, PartnerJob, PartnerJobStop, PartnerOffer, Trip, VehicleClass } from '@driver/contracts';

/**
 * «البروفة» (partner redesign l4, Ali chose A on 2026-10-08): a pretend order run on the real slip and
 * job screens, so nobody learns the app on a real customer's dinner. Everything lives on this phone:
 * this file is the pretend order and how each tap moves it on; `practice-link.ts` answers the screens'
 * API calls from it, so nothing reaches the server, a customer, a kitchen or the money.
 */

/** Which pretend order: food for a bike (the courier), a ride for a car or a tuktuk. */
export type PracticeKind = 'food' | 'taxi' | 'tuktuk';

export function practiceKindFor(vehicle: VehicleClass | null | undefined): PracticeKind | null {
  if (vehicle === 'bike') return 'food';
  if (vehicle === 'tuktuk') return 'tuktuk';
  if (vehicle === 'car' || vehicle === 'suv' || vehicle === 'van') return 'taxi';
  return null;
}

export type PracticeStage = 'idle' | 'offer' | 'job' | 'done';

/** What he did, for the done screen's four lines. */
export interface PracticeLearned {
  /** Seconds from the ring to his accept. */
  acceptedInSec: number | null;
  /** Food: the cash he took at the door and the note the customer paid with. */
  cashIqd: number | null;
  paidWithIqd: number | null;
  /** Food: a handover photo was taken. */
  photo: boolean;
}

export interface PracticeState {
  kind: PracticeKind;
  stage: PracticeStage;
  /** Rings the pretend order counted: a missed or declined one rings again. */
  round: number;
  offer: PartnerOffer | null;
  job: PartnerJob | null;
  startedAt: number;
  finishedAt: number | null;
  learned: PracticeLearned;
}

export const PRACTICE_RESTAURANT = 'مطعم البروفة';
/** The same ring as a real order: 15 s food, 20 s rides. */
const RING_SEC: Record<PracticeKind, number> = { food: 15, taxi: 20, tuktuk: 20 };

const KITCHEN = { lat: 32.9095, lng: 45.0635 };
const DOOR = { lat: 32.896, lng: 45.0675 };
const RIDER = { lat: 32.905, lng: 45.06 };
const DESTINATION = { lat: 32.9005, lng: 45.0465 };

/** Food: a 14,000 دينار cash order, the customer pays with 20,000 (the change helper's lesson). */
export const PRACTICE_FOOD = { payIqd: 3_000, collectIqd: 14_000, tenderIqd: 20_000, pickupCode: '4417' } as const;
const RIDE_FARE: Record<'taxi' | 'tuktuk', number> = { taxi: 5_000, tuktuk: 2_500 };

export function newPractice(kind: PracticeKind, now: number): PracticeState {
  return { kind, stage: 'idle', round: 0, offer: null, job: null, startedAt: now, finishedAt: null, learned: { acceptedInSec: null, cashIqd: null, paidWithIqd: null, photo: false } };
}

function pay(kind: PracticeKind): PartnerOffer['pay'] {
  if (kind === 'food') return { totalIqd: PRACTICE_FOOD.payIqd, components: [{ key: 'delivery', amountIqd: PRACTICE_FOOD.payIqd }], takePct: null };
  return { totalIqd: RIDE_FARE[kind], components: [{ key: 'fare', amountIqd: RIDE_FARE[kind] }], takePct: null };
}

/** The slip rings: a fresh pretend offer with the real ring time. */
export function ring(s: PracticeState, now: number): PracticeState {
  const food = s.kind === 'food';
  const offer: PartnerOffer = {
    offerId: `practice-offer-${s.round + 1}`,
    tripId: `practice-trip-${s.round + 1}`,
    vertical: food ? 'food' : s.kind,
    wave: 1,
    sentAt: new Date(now),
    expiresAt: new Date(now + RING_SEC[s.kind] * 1000),
    ringSec: RING_SEC[s.kind],
    seen: false,
    pickup: food ? { zoneId: 'street_30', label: PRACTICE_RESTAURANT, pin: KITCHEN, landmark: 'جامع الرسول' } : { zoneId: 'centre', label: null, pin: RIDER, landmark: 'الجامع الكبير' },
    dropoff: food ? { zoneId: 'hashimi', label: null, pin: DOOR, landmark: null } : { zoneId: 'saadouniya', label: null, pin: DESTINATION, landmark: null },
    distanceToPickupKm: 0.6,
    tripKm: food ? 1.6 : 1.4,
    pay: pay(s.kind),
    batch: null,
    merchant: food ? { name: PRACTICE_RESTAURANT, state: 'preparing', readyInMin: 4 } : null,
    collectIqd: s.kind === 'food' ? PRACTICE_FOOD.collectIqd : RIDE_FARE[s.kind],
    favourite: false,
    nudgedAt: null,
    rideCargo: [],
    rider: null,
    climate: null,
    riderTrips: food ? null : 3,
  };
  return { ...s, stage: 'offer', round: s.round + 1, offer, job: null, finishedAt: null };
}

function stops(s: PracticeState): PartnerJobStop[] {
  const food = s.kind === 'food';
  const base = { orderId: null, arrivedAt: null, completedAt: null, landmark: null } as const;
  return [
    {
      ...base,
      stopId: 'practice-pickup',
      seq: 0,
      type: 'pickup',
      state: 'pending',
      zoneId: food ? 'street_30' : 'centre',
      pin: food ? KITCHEN : RIDER,
      label: food ? PRACTICE_RESTAURANT : null,
      note: null,
      collectIqd: 0,
      pickupCode: food ? PRACTICE_FOOD.pickupCode : null,
      landmark: food ? 'جامع الرسول' : 'الجامع الكبير',
    },
    {
      ...base,
      stopId: 'practice-dropoff',
      seq: 1,
      type: 'dropoff',
      state: 'pending',
      zoneId: food ? 'hashimi' : 'saadouniya',
      pin: food ? DOOR : DESTINATION,
      label: null,
      note: food ? 'باب أخضر، الطابق الأول' : null,
      collectIqd: s.kind === 'food' ? PRACTICE_FOOD.collectIqd : RIDE_FARE[s.kind],
      tenderIqd: food ? PRACTICE_FOOD.tenderIqd : null,
    },
  ];
}

/** «ثبّت حتى تقبل» or «مو هسة». A pretend order that is declined, or rings out, rings again from the start. */
export function respond(s: PracticeState, accept: boolean, now: number): PracticeState {
  if (s.stage !== 'offer' || !s.offer) return s;
  if (!accept || now > s.offer.expiresAt.getTime()) return { ...s, stage: 'idle', offer: null };
  const job: PartnerJob = {
    tripId: s.offer.tripId,
    vertical: s.offer.vertical,
    state: 'accepted',
    acceptedAt: new Date(now),
    stops: stops(s),
    currentStopId: 'practice-pickup',
    unreachable: null,
    pay: s.offer.pay,
    merchant: s.offer.merchant ? { ...s.offer.merchant, state: 'ready', readyInMin: 0 } : null,
    rideCargo: [],
  };
  const acceptedInSec = Math.max(0, Math.round((now - s.offer.sentAt.getTime()) / 1000));
  return { ...s, stage: 'job', offer: null, job, learned: { ...s.learned, acceptedInSec } };
}

function nextStop(list: readonly PartnerJobStop[]): string | null {
  return list.find((x) => x.state === 'pending' || x.state === 'arrived')?.stopId ?? null;
}

export function arrive(s: PracticeState, stopId: string, now: number): PracticeState {
  if (!s.job) return s;
  const list = s.job.stops.map((x) => (x.stopId === stopId && x.state === 'pending' ? { ...x, state: 'arrived' as const, arrivedAt: new Date(now) } : x));
  const pickup = list[0]?.state === 'arrived';
  return { ...s, job: { ...s.job, stops: list, state: pickup && list[1]?.state === 'pending' ? 'arrived_pickup' : 'arrived_dropoff', currentStopId: nextStop(list) } };
}

export function complete(s: PracticeState, stopId: string, handover: Partial<HandoverProof> | undefined, now: number): PracticeState {
  if (!s.job) return s;
  const list = s.job.stops.map((x) => (x.stopId === stopId && x.state !== 'completed' ? { ...x, state: 'completed' as const, arrivedAt: x.arrivedAt ?? new Date(now), completedAt: new Date(now), pickupCode: null } : x));
  const current = nextStop(list);
  const merchant = s.job.merchant && list[0]?.state === 'completed' ? { ...s.job.merchant, state: 'picked_up' as const } : s.job.merchant;
  const job: PartnerJob = { ...s.job, stops: list, merchant, currentStopId: current, state: current ? 'in_transit' : 'completed' };
  const stop = s.job.stops.find((x) => x.stopId === stopId);
  const learned =
    stop?.type === 'dropoff' && s.kind === 'food'
      ? { ...s.learned, cashIqd: handover?.cashCollectedIqd ?? stop.collectIqd, paidWithIqd: stop.tenderIqd ?? null, photo: Boolean(handover?.photoUploadId || handover?.note) }
      : s.learned;
  return { ...s, job, stage: current ? 'job' : 'done', finishedAt: current ? null : now, learned };
}

/** What `trips.arrive` / `trips.completeStop` answer: the fields the job screen reads off a trip. */
export function asTrip(s: PracticeState): Trip {
  const job = s.job;
  const at = new Date(s.startedAt);
  return {
    id: job?.tripId ?? 'practice-trip',
    cityId: 'aziziyah',
    vertical: job?.vertical ?? 'food',
    state: job?.state ?? 'accepted',
    courierId: null,
    vehicleId: null,
    quoteId: null,
    batchId: null,
    offeredAt: at,
    acceptedAt: job?.acceptedAt ?? null,
    completedAt: s.finishedAt ? new Date(s.finishedAt) : null,
    cancelledAt: null,
    cancellationReason: null,
    unreachable: null,
    stops: (job?.stops ?? []).map((x) => ({ id: x.stopId, state: x.state, arrivedOutsideGeofence: false })) as unknown as Trip['stops'],
    orders: [],
    createdAt: at,
    updatedAt: at,
  } as Trip;
}

/** The five steps on the band: the ring, then the four taps of the job. */
export const PRACTICE_STEPS = 5;

export function practiceStep(s: PracticeState): number {
  if (s.stage === 'idle' || s.stage === 'offer') return 1;
  if (s.stage === 'done' || !s.job) return PRACTICE_STEPS;
  const [pickup, dropoff] = s.job.stops;
  if (pickup?.state === 'pending') return 2;
  if (pickup?.state === 'arrived') return 3;
  if (dropoff?.state === 'pending') return 4;
  return 5;
}

/** The one purple tip for this step (`partner.practice_tip_*`). */
export function practiceTip(s: PracticeState): MessageKey | null {
  const ride = s.kind !== 'food';
  switch (s.stage === 'done' ? 0 : practiceStep(s)) {
    case 1:
      return 'partner.practice_tip_offer';
    case 2:
      return ride ? 'partner.practice_tip_go_rider' : 'partner.practice_tip_go_kitchen';
    case 3:
      return ride ? 'partner.practice_tip_rider_in' : 'partner.practice_tip_picked_up';
    case 4:
      return ride ? 'partner.practice_tip_go_destination' : 'partner.practice_tip_go_door';
    case 5:
      return ride ? 'partner.practice_tip_end_ride' : 'partner.practice_tip_door';
    default:
      return null;
  }
}

/** Whole minutes it took, at least 1 (the done screen's «سويتها بـ 3 دقايق»). */
export function practiceMinutes(s: PracticeState): number {
  return Math.max(1, Math.round(((s.finishedAt ?? s.startedAt) - s.startedAt) / 60_000));
}
