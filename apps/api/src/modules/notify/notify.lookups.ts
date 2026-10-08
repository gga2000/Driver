import type { RoleKind, SafetyPrefs } from '@driver/contracts';

export interface OrderFacts {
  id: string;
  type: string;
  customerId: string;
  merchantOrgId: string | null;
  totalIqd: number;
  itemCount: number;
  /** A ride booked for someone else (s3): the rider's account, when he has one; null otherwise. */
  riderId?: string | null;
  /** How it is paid (`cash` | `wallet` | `prepaid`); absent = unknown, read as cash. */
  paymentMethod?: string;
}

export interface BookingFacts {
  riderId: string;
  seats: string;
  departAt: Date;
  route: string;
  place: string;
  vehicle: string;
  pin: string;
  /** The booking's first seat id: a booking with several seats completes once per seat. */
  firstSeat?: string;
}

/** One booking on a الرجعة departure as its lock-screen card needs it (customer d-8 follow-up). */
export interface PassFacts {
  bookingId: string;
  riderId: string;
  /** The booking's state now (booked, checked_in, completed, cancelled, moved, no_show…). */
  state: string;
  departAt: Date;
  /** Where he boards: the garage or his meeting point's name ("باب البيت" for a door pickup). */
  stop: string;
  pickupKind: 'garage' | 'meeting_point' | 'door';
  toCity: string;
  seatIds: string[];
  pin: string;
  /** The car's last fix to his stop, km; null before a fix. */
  carKm: number | null;
  fareIqd: number;
}

/**
 * What the notify subscribers read from other modules to fill a template, through their public
 * services (bound in `NotifyModule`). Every lookup answers null when the thing is gone; a failed
 * lookup never fails the outbox delivery (the message is skipped and logged instead).
 */
export interface NotifyLookups {
  order(orderId: string): Promise<OrderFacts | null>;
  storeName(orgId: string): Promise<string | null>;
  /** Live role holders of an org (merchant staff and owners). */
  orgPeople(orgId: string, kinds: readonly RoleKind[]): Promise<string[]>;
  /** A first name for a message, read through identity (vault-logged). */
  firstName(personId: string, purpose: string): Promise<string | null>;
  booking(bookingId: string): Promise<BookingFacts | null>;
  /** Every booking on a departure, for the lock-screen pass updates; null when the departure is gone. */
  departurePasses(departureId: string): Promise<PassFacts[] | null>;
  child(childRef: string): Promise<{ guardianId: string; childFirstName: string } | null>;
  /** The name of a trip stop's place (school, home landmark), or its zone. */
  stopPlace(tripId: string, stopId: string): Promise<string | null>;
  /** Pickup and drop-off zone names of a trip (the partner's offer push). */
  tripZones(tripId: string): Promise<{ pickup: string; dropoff: string } | null>;
  /** Joy w9: the person's safety switches and how many trusted people they have (no names or numbers). */
  safety?(personId: string): Promise<{ prefs: SafetyPrefs; contacts: number } | null>;
  /** s2 «وصل بالسلامة»: the accounts of the person's trusted people who have the app (logged vault read). */
  trustedAccounts?(personId: string, purpose: string): Promise<string[]>;
  /** Joy w9 auto-share: a share-trip link (full URL) on the person's booking or ride; null when it can't be made. */
  shareLink?(personId: string, subject: { bookingId: string } | { orderId: string }): Promise<string | null>;
  /** c9/s3: the name the booker gave the rider of a ride booked for someone else (vault-logged); null otherwise. */
  riderName?(orderId: string): Promise<string | null>;
  /** c9: the car the driver came in — "Toyota Corolla · أبيض" (else تكسي / تكتك) — and its plate. */
  driverCar?(tripId: string, driverId: string): Promise<{ car: string; plate: string } | null>;
  /** W2: when a picked-up delivery reaches the door — the order screen's own ETA; null when it can't say. */
  deliveryEta?(orderId: string, now: Date): Promise<Date | null>;
  /** W2 BENCH-03: the menu names of these lines of an order (free-text lines by their text), in line order. */
  lineNames?(orderId: string, lineIds: readonly string[]): Promise<string[]>;
  /** W2: the order a trip stop serves (an event that names only the stop); null when gone. */
  stopOrder?(tripId: string, stopId: string): Promise<string | null>;
  /** s1: the start code of a night ride, which goes in the rider's SMS; null when the ride has none. */
  startCode?(orderId: string): Promise<string | null>;
}

export const NOTIFY_LOOKUPS = Symbol('NOTIFY_LOOKUPS');

const CITY_AR: Record<string, string> = { aziziyah: 'العزيزية', baghdad: 'بغداد', kut: 'الكوت' };

export function cityNameAr(cityId: string): string {
  return CITY_AR[cityId] ?? cityId;
}

/** Straight-line km between two points (the car to a rider's stop), to 0.1. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}
