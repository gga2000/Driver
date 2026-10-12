import type { DeliveryPoint, LatLng, Order, PlaceOrderInput } from '@driver/contracts';

/** Orders, as parcels uses them: the server's fare, placing the courier order once the door is set. */
export interface ParcelsOrdersPort {
  /** The cash fare of a parcel from `pickup` to `dropoff` (the order quote's total; nothing stored). */
  fare(senderId: string, input: { cityId: string; pickup: DeliveryPoint; dropoff: DeliveryPoint }): Promise<number>;
  place(senderId: string, input: PlaceOrderInput): Promise<Order>;
  order(orderId: string): Promise<Order | null>;
  cancel(senderId: string, orderId: string): Promise<Order>;
  /** Who carries the order now (trip and courier), null before a courier took it. */
  courierOf(orderId: string): Promise<{ tripId: string; courierId: string } | null>;
  /** The courier's last live fix on that trip (server-known, never the client's word). */
  lastFix(tripId: string): Promise<LatLng | null>;
  /** The trip back after a refusal (orders' `returnParcel`, lane A); absent until bound: the refusal is only recorded. */
  returnTrip?(courierId: string, orderId: string): Promise<void>;
  /** The courier's photo upload ids at pickup and at the door, once taken (trip stop proofs). */
  proofs(orderId: string): Promise<{ pickup: string | null; dropoff: string | null }>;
}

/** People, read from the vault with every read logged. */
export interface ParcelsPeoplePort {
  firstName(personId: string, accessorId: string, purpose: string): Promise<string | null>;
  phoneMasked(personId: string, accessorId: string, purpose: string): Promise<string | null>;
}

/** Zones and photos. */
export interface ParcelsPlacesPort {
  /** The server's zone for a pin (null outside the service area). */
  zoneOf(cityId: string, pin: LatLng): string | null;
  zone(cityId: string, zoneKey: string): { name: string; centre: LatLng } | null;
  photoOwned(uploadId: string, personId: string): Promise<boolean>;
  photoUrl(uploadId: string): string;
}

/** The base of the receiver's door link (`<base>/p/<token>`), the company's own customer web address; null when unset. */
export type ParcelLinkBase = string | null;

export const PARCELS_ORDERS = Symbol('PARCELS_ORDERS');
export const PARCELS_PEOPLE = Symbol('PARCELS_PEOPLE');
export const PARCELS_PLACES = Symbol('PARCELS_PLACES');
export const PARCELS_RIDERS = Symbol('PARCELS_RIDERS');
export const PARCELS_LINK_BASE = Symbol('PARCELS_LINK_BASE');

/** Vault reads: the receiver's name and number for the sender's parcel page; the sender's first name for the receiver's page. */
export const PARCEL_READ_PURPOSE = 'parcel_view';
export const PARCEL_DOOR_PURPOSE = 'parcel_door_page';
