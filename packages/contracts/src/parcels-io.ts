import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { RideRiderInput } from './order.js';

/**
 * طرود «دز طرد» (Ali, 2026-10-12: concept A to send, B's tag and delivered moment). A parcel inside
 * Aziziyah: what it is (a photo, a few words, a size, its value), who it is for, and the receiver's door. By
 * default the receiver marks their own door from a text-message link (no app needed), so the parcel waits as
 * `waiting_door` and the courier order is placed only once it is set; the sender may mark it instead.
 * The fare is the city's parcel fare to the receiver's area, quoted by the server and locked when sent. Either
 * side pays it in cash (Ali's card, 00:05Z: the receiver may pay at the door; if the receiver refuses the
 * parcel it comes back and the sender pays both trips). Opens with `parcel` in `launchedVerticals`.
 */

export const PARCEL_RULES = {
  /** The words on the tag («ملابس العيد»). */
  whatMax: 60,
  /** Declared value: new couriers carry up to this (scoring §onboarding: «parcels ≤ 50k declared value»). */
  declaredValueMaxIqd: 50_000,
  /** How long the receiver has to mark their door; then it is cancelled with no fee and the sender is told (lane A rec 2 h; Ali sets it). */
  doorWaitHours: 2,
  /** The receipt code: digits, read out to the courier at the door. */
  pinLength: 4,
  /** Wrong codes before the code locks (the sender is then asked to release the parcel). */
  pinTries: 5,
  /** «رفضت تستلم» counts only at the door: the courier's last fix within this of the drop pin (as a no-show). */
  refuseWithinM: 150,
} as const;

export const ParcelSize = z.enum(['small', 'medium', 'large']);
export type ParcelSize = z.infer<typeof ParcelSize>;

/** Who pays the fare in cash: the sender when the courier takes it, or the receiver at the door. */
export const ParcelPayer = z.enum(['sender', 'receiver']);
export type ParcelPayer = z.infer<typeof ParcelPayer>;

/** The parcel's life, from the sender's side. The courier part mirrors its order. */
export const ParcelState = z.enum([
  /** Sent; the receiver hasn't marked their door yet (no courier order exists). */
  'waiting_door',
  /** The door is set; looking for a courier. */
  'finding_courier',
  /** A courier is on the way to take it. */
  'to_pickup',
  /** He has it; on the way to the receiver. */
  'on_the_way',
  /** Handed over with the receiver's code. */
  'delivered',
  /** The receiver refused it; it is coming back to the sender. */
  'returning',
  /** Back with the sender. */
  'returned',
  /** Cancelled before a courier took it, or the door was never set in time. */
  'cancelled',
]);
export type ParcelState = z.infer<typeof ParcelState>;

/** Who marks the door: the receiver does from the link (default), or the sender on the map now. */
export const ParcelDoorInput = z.discriminatedUnion('by', [
  /** The receiver's area (zone) prices the fare; their pin must land where the fare is the same. */
  z.object({ by: z.literal('receiver'), zoneKey: z.string().min(1) }),
  z.object({ by: z.literal('sender'), dropoff: DeliveryPoint }),
]);
export type ParcelDoorInput = z.infer<typeof ParcelDoorInput>;

/** «دزّه» before sending: the fare for this parcel to the receiver's area (nothing stored). */
export const ParcelQuoteInput = z.object({
  cityId: CityId.default('aziziyah'),
  pickup: DeliveryPoint,
  /** The receiver's area, or the pin's zone when the sender marks the door. */
  dropZoneKey: z.string().min(1),
  size: ParcelSize.default('small'),
});
export type ParcelQuoteInput = z.input<typeof ParcelQuoteInput>;

export const ParcelQuote = z.object({
  /** The cash fare (delivery + door pickup + service, rounded like every cash order). */
  fareIqd: Iqd.positive(),
  zoneKey: z.string(),
  zoneName: z.string(),
});
export type ParcelQuote = z.infer<typeof ParcelQuote>;

export const SendParcelInput = z.object({
  cityId: CityId.default('aziziyah'),
  /** Once per send attempt, re-sent on retries: a repeat returns the parcel already sent. */
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  what: z.string().trim().min(1).max(PARCEL_RULES.whatMax),
  size: ParcelSize.default('small'),
  declaredValueIqd: Iqd.min(0).max(PARCEL_RULES.declaredValueMaxIqd),
  /** The photo uploaded with `account.photoUpload` (the sender's own upload). */
  photoUploadId: z.string().min(1).optional(),
  /** Who it is for: someone typed now, a trusted person or a household member (as «لمنو المشوار؟»). */
  recipient: RideRiderInput,
  /** Where the courier takes it from (the sender's place; the courier comes to the door, +500). */
  pickup: DeliveryPoint,
  door: ParcelDoorInput,
  payer: ParcelPayer.default('sender'),
  /** The fare the sheet showed; a different server figure is `price_changed`. */
  fareIqd: Iqd.positive(),
  courierNote: z.string().max(300).optional(),
});
export type SendParcelInput = z.input<typeof SendParcelInput>;

export const ParcelIdInput = z.object({ parcelId: z.string().min(1) });
export type ParcelIdInput = z.infer<typeof ParcelIdInput>;

/** One moment on the tag's strip, with its real time when it happened. */
export const ParcelStep = z.object({ key: z.enum(['sent', 'door_set', 'picked_up', 'delivered']), at: z.coerce.date().nullable() });
export type ParcelStep = z.infer<typeof ParcelStep>;

/** The parcel's page (B): the tag, the code as its seal, the photos, and the live part's order id. */
export const ParcelView = z.object({
  id: z.string(),
  state: ParcelState,
  what: z.string(),
  size: ParcelSize,
  declaredValueIqd: Iqd,
  /** What we make good if something happens to it: the declared value, up to the cap. */
  coveredIqd: Iqd,
  photoUrl: z.string().nullable(),
  recipientName: z.string(),
  recipientPhoneMasked: z.string(),
  senderName: z.string().nullable(),
  /** The sender's place name / the receiver's area. */
  fromLabel: z.string(),
  toLabel: z.string(),
  payer: ParcelPayer,
  fareIqd: Iqd,
  /** The receipt code, shown to the sender (who may pass it on); null to anyone else. */
  pin: z.string().nullable(),
  /** The link the receiver marks their door from, while waiting (the sender can send it again himself). */
  doorLink: z.string().nullable(),
  doorBy: z.enum(['receiver', 'sender']),
  /** When the door must be marked by, while waiting. */
  doorDueAt: z.coerce.date().nullable(),
  steps: z.array(ParcelStep),
  /** The courier order once placed (the live map and the courier card read it). */
  orderId: z.string().nullable(),
  pickupPhotoUrl: z.string().nullable(),
  dropoffPhotoUrl: z.string().nullable(),
  placedAt: z.coerce.date(),
});
export type ParcelView = z.infer<typeof ParcelView>;

/** The page the receiver opens from the text (public, by its token): who sent what, and the receiver's door. */
export const ParcelDoorPageInput = z.object({ token: z.string().min(16).max(64) });
export type ParcelDoorPageInput = z.infer<typeof ParcelDoorPageInput>;

export const ParcelDoorPage = z.object({
  senderName: z.string(),
  what: z.string(),
  photoUrl: z.string().nullable(),
  zone: z.object({ key: z.string(), name: z.string(), centre: LatLng }),
  /** The receiver pays this at the door (receiver pays), else null («الأجرة مدفوعة»). */
  payAtDoorIqd: Iqd.nullable(),
  /** False once the door is set (the page then says the courier is coming) or the parcel lapsed. */
  open: z.boolean(),
  doorSet: z.boolean(),
  state: ParcelState,
});
export type ParcelDoorPage = z.infer<typeof ParcelDoorPage>;

export const SetParcelDoorInput = ParcelDoorPageInput.extend({
  pin: LatLng,
  /** A short note about the door of the door (an upload made from the page), optional. */
  doorNote: z.string().max(200).optional(),
});
export type SetParcelDoorInput = z.infer<typeof SetParcelDoorInput>;

/** The courier's side of a parcel job (their order id): what it is, who pays, the receipt code check, refusal. */
export const CourierParcelInput = z.object({ orderId: z.string().min(1) });
export type CourierParcelInput = z.infer<typeof CourierParcelInput>;

export const CourierParcelView = z.object({
  parcelId: z.string(),
  what: z.string(),
  size: ParcelSize,
  declaredValueIqd: Iqd,
  photoUrl: z.string().nullable(),
  /** The receiver's first name as the sender gave it. */
  receiverName: z.string(),
  payer: ParcelPayer,
  /** Cash to take at the door when the receiver pays, else 0 (the sender paid at pickup). */
  collectAtDoorIqd: Iqd,
  pinVerified: z.boolean(),
  /** Wrong codes left before the code is locked (then the sender is asked to release it). */
  pinTriesLeft: z.number().int().min(0),
  refused: z.boolean(),
});
export type CourierParcelView = z.infer<typeof CourierParcelView>;

export const CourierParcelPinInput = CourierParcelInput.extend({ pin: z.string().regex(/^\d{4}$/) });
export type CourierParcelPinInput = z.infer<typeof CourierParcelPinInput>;

/** «رفضت تستلم» before the second tap: what the trip back costs and who pays it (always the sender). */
export const CourierParcelRefusal = z.object({ returnFareIqd: Iqd.positive(), totalForSenderIqd: Iqd.positive(), payer: z.literal('sender') });
export type CourierParcelRefusal = z.infer<typeof CourierParcelRefusal>;

export interface ParcelsPort {
  quote(actor: Actor, input: z.output<typeof ParcelQuoteInput>): Promise<ParcelQuote>;
  send(actor: Actor, input: z.output<typeof SendParcelInput>): Promise<ParcelView>;
  get(actor: Actor, input: ParcelIdInput): Promise<ParcelView>;
  mine(actor: Actor): Promise<ParcelView[]>;
  cancel(actor: Actor, input: ParcelIdInput): Promise<ParcelView>;
  /** A fresh link for the receiver (the old one stops opening), for the sender to share. */
  newDoorLink(actor: Actor, input: ParcelIdInput): Promise<ParcelView>;
  doorPage(input: ParcelDoorPageInput): Promise<ParcelDoorPage>;
  setDoor(input: SetParcelDoorInput): Promise<ParcelDoorPage>;
  courierJob(actor: Actor, input: CourierParcelInput): Promise<CourierParcelView>;
  checkPin(actor: Actor, input: CourierParcelPinInput): Promise<CourierParcelView>;
  refusalPreview(actor: Actor, input: CourierParcelInput): Promise<CourierParcelRefusal>;
  refuse(actor: Actor, input: CourierParcelInput): Promise<CourierParcelView>;
}
