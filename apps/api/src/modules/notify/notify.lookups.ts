import type { RoleKind } from '@driver/contracts';

export interface OrderFacts {
  id: string;
  type: string;
  customerId: string;
  merchantOrgId: string | null;
  totalIqd: number;
  itemCount: number;
}

export interface BookingFacts {
  riderId: string;
  seats: string;
  departAt: Date;
  route: string;
  place: string;
  vehicle: string;
  pin: string;
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
  child(childRef: string): Promise<{ guardianId: string; childFirstName: string } | null>;
  /** The name of a trip stop's place (school, home landmark), or its zone. */
  stopPlace(tripId: string, stopId: string): Promise<string | null>;
  /** Pickup and drop-off zone names of a trip (the partner's offer push). */
  tripZones(tripId: string): Promise<{ pickup: string; dropoff: string } | null>;
}

export const NOTIFY_LOOKUPS = Symbol('NOTIFY_LOOKUPS');

const CITY_AR: Record<string, string> = { aziziyah: 'العزيزية', baghdad: 'بغداد', kut: 'الكوت' };

export function cityNameAr(cityId: string): string {
  return CITY_AR[cityId] ?? cityId;
}
