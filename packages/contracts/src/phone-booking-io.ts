import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { CityId, Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { CancellationFee } from './order.js';

/**
 * «حجز بالتلفون» (taxi/tuktuk step 4, idea v4): someone without the app calls, ops book the ride
 * from the Console on their number, and they hear of the driver by SMS. The ride is an ordinary
 * cash ride of that number's person (same quote, dispatch and rules as one booked in the app); the
 * Console only adds who booked it. Support, dispatchers and admins take the calls.
 */
export const PHONE_BOOKING_ROLES: readonly RoleKind[] = ['support', 'dispatcher', 'admin'];

export const PHONE_BOOKING_RULES = {
  /** What the caller said their name is ("أم علي", "حسين كاظم"): kept in the vault when the number has none. */
  nameMaxChars: 60,
  /** For the driver ("يم باب الجامع، لابس أبيض"): the ride's note, as in the app. */
  noteMaxChars: 300,
  /** How often the Console refreshes today's list (a driver taking a ride shows within this). */
  listRefreshMs: 10_000,
} as const;

export const PhoneBookingVertical = z.enum(['taxi', 'tuktuk']);
export type PhoneBookingVertical = z.infer<typeof PhoneBookingVertical>;

/** The number as staff typed it (`0770 123 4567`, `+964…`, Arabic digits); the server normalises it (`phone_invalid`). */
const CallerPhone = z.string().trim().min(4).max(30);

/** Who is on the line: a number the platform already knows (their name, if they gave one) or a new one. */
export const PhoneBookingCallerInput = z.object({ phone: CallerPhone });
export type PhoneBookingCallerInput = z.input<typeof PhoneBookingCallerInput>;

export const PhoneBookingCaller = z.object({
  /** The number has a person behind it (an app account, an earlier phone booking, a household invite…). */
  known: z.boolean(),
  /** Their name as the vault has it, staff-short ("علي ح."); null when none was ever given. */
  name: z.string().nullable(),
  /** Rides booked for this number by phone before today's call. */
  phoneRides: z.number().int().nonnegative(),
});
export type PhoneBookingCaller = z.infer<typeof PhoneBookingCaller>;

/** A landmark from `places.landmarks` (garages, meeting points, verified places): the server reads its pin and zone. */
const LandmarkId = z.string().min(1).max(120);

export const PhoneBookingQuoteInput = z
  .object({ cityId: CityId.default('aziziyah'), pickupId: LandmarkId, dropoffId: LandmarkId })
  .refine((v) => v.pickupId !== v.dropoffId, { message: 'pickup and drop-off are the same place', path: ['dropoffId'] });
export type PhoneBookingQuoteInput = z.input<typeof PhoneBookingQuoteInput>;

export const PhoneBookingPlace = z.object({ id: z.string(), name_ar: z.string(), zoneId: z.string(), zoneName_ar: z.string() });
export type PhoneBookingPlace = z.infer<typeof PhoneBookingPlace>;

/** One vehicle at the server's price now: what the app's choose screen would show for the same two places. */
export const PhoneBookingOption = z.object({
  vertical: PhoneBookingVertical,
  /** The fare `orders.place` checks (`price_changed` when it moved): send it back with the booking. */
  fareIqd: Iqd.min(0),
  /** What the caller hands the driver in cash (the fare rounded up to 250, as for an app ride). */
  totalIqd: Iqd.min(0),
  /** The ride itself, pickup to drop-off, in town traffic (the learned ETA). */
  rideMin: z.number().int().nonnegative(),
});
export type PhoneBookingOption = z.infer<typeof PhoneBookingOption>;

export const PhoneBookingQuote = z.object({
  pickup: PhoneBookingPlace,
  dropoff: PhoneBookingPlace,
  /** Taxi first, then tuktuk. */
  options: z.array(PhoneBookingOption),
  quotedAt: z.coerce.date(),
});
export type PhoneBookingQuote = z.infer<typeof PhoneBookingQuote>;

export const BookByPhoneInput = z.object({
  cityId: CityId.default('aziziyah'),
  phone: CallerPhone,
  name: z.string().trim().min(1).max(PHONE_BOOKING_RULES.nameMaxChars),
  pickupId: LandmarkId,
  dropoffId: LandmarkId,
  vertical: PhoneBookingVertical,
  /** The quoted fare staff read out; a different server fare is `price_changed` (quote again, tell the caller). */
  fareIqd: Iqd.min(0),
  note: z.string().trim().max(PHONE_BOOKING_RULES.noteMaxChars).optional(),
  /** One per booking attempt, re-sent on a retry: a double click books one ride. */
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type BookByPhoneInput = z.input<typeof BookByPhoneInput>;

/** Where the ride stands, in the Console's words. */
export const PhoneBookingStatus = z.enum(['searching', 'driver_coming', 'driver_arrived', 'on_trip', 'done', 'cancelled']);
export type PhoneBookingStatus = z.infer<typeof PhoneBookingStatus>;

export const PhoneBookingDriver = z.object({
  firstName: z.string().nullable(),
  /** "Toyota Corolla · أبيض"; null when the registry has no model. */
  vehicleLabel: z.string().nullable(),
  plate: z.string().nullable(),
});
export type PhoneBookingDriver = z.infer<typeof PhoneBookingDriver>;

export const PhoneBookingRow = z.object({
  orderId: z.string(),
  /** The order's short number ("#4821"), as on every other Console screen. */
  ticket: z.string(),
  placedAt: z.coerce.date(),
  /** The caller, staff-short ("علي ح."); null when the vault has no name. */
  callerName: z.string().nullable(),
  /** "0770 ••• 4567". */
  phoneHint: z.string(),
  vertical: PhoneBookingVertical,
  pickupName: z.string(),
  dropoffName: z.string(),
  /** What the caller pays the driver in cash. */
  totalIqd: Iqd.min(0),
  status: PhoneBookingStatus,
  /** When the current status began (booked, accepted, arrived, picked up, finished or cancelled). */
  since: z.coerce.date(),
  /** The driver who took it; null while searching (and after a cancel before anyone did). */
  driver: PhoneBookingDriver.nullable(),
  /** Staff who booked it, staff-short. */
  bookedByName: z.string().nullable(),
  /** Searching, or the driver still on his way / waiting: staff may cancel for the caller. */
  cancellable: z.boolean(),
  note: z.string().nullable(),
});
export type PhoneBookingRow = z.infer<typeof PhoneBookingRow>;

export const PhoneBookingsTodayInput = z.object({ cityId: CityId.default('aziziyah') });
export type PhoneBookingsTodayInput = z.input<typeof PhoneBookingsTodayInput>;

export const PhoneBookingOrderInput = z.object({ orderId: z.string().min(1) });
export type PhoneBookingOrderInput = z.input<typeof PhoneBookingOrderInput>;

/** `phoneBookings.*` behind `ctx.phoneBookings` (`modules/phone-booking`). */
export interface PhoneBookingPort {
  caller(actor: Actor, input: z.output<typeof PhoneBookingCallerInput>): Promise<PhoneBookingCaller>;
  quote(actor: Actor, input: z.output<typeof PhoneBookingQuoteInput>): Promise<PhoneBookingQuote>;
  book(actor: Actor, input: z.output<typeof BookByPhoneInput>): Promise<PhoneBookingRow>;
  today(actor: Actor, input: z.output<typeof PhoneBookingsTodayInput>): Promise<PhoneBookingRow[]>;
  /** What cancelling costs the caller now (the app's own cancellation rules). */
  cancelPreview(actor: Actor, input: z.output<typeof PhoneBookingOrderInput>): Promise<CancellationFee>;
  cancel(actor: Actor, input: z.output<typeof PhoneBookingOrderInput>): Promise<PhoneBookingRow>;
}

/** The SMS phone bookings get (and the delivery log names): the driver on his way, then at the pickup. */
export const PHONE_BOOKING_SMS = { matched: 'phone_ride_matched', arrived: 'phone_driver_arrived' } as const;
