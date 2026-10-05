import type { LatLng, Order, PartnerOnlineGate, Quote, RoleKind, Trip, VehicleClass, Vertical } from '@driver/contracts';
import type { TakeRule } from './logic.js';

/**
 * Everything the partner read side needs from the owning modules, as one narrow port. Bound in
 * `partner.module.ts` to dispatch (presence, offers, board), trips, orders, orgs, the ledger,
 * identity's role reader and the courier vehicle registry; faked in unit tests.
 */

export interface PartnerPresence {
  cityId: string;
  lat: number;
  lng: number;
  vehicle: VehicleClass;
  tier: 'bronze' | 'silver' | 'gold';
  zoneId: string | null;
  /** Epoch ms this stretch online began (dispatch presence); absent on older entries. */
  onlineSince?: number | undefined;
}

export interface PartnerOfferRecord {
  id: string;
  tripId: string;
  wave: number;
  state: string;
  distanceKm: number | null;
  compensationIqd: number;
  sentAt: Date;
  seenAt: Date | null;
  expiresAt: Date;
}

export interface PartnerOfferRequest {
  tripId: string;
  vertical: Vertical;
  zoneId: string;
  dropoffZoneId: string | null;
  pickup: LatLng;
}

export interface PartnerCapStatus {
  tier: 'bronze' | 'silver' | 'gold';
  owedIqd: number;
  capIqd: number;
  capRemainingIqd: number;
  overCap: boolean;
  /** `cash:` balance: negative while he holds collected cash. */
  cashIqd: number;
}

export interface PartnerLedgerLine {
  type: string;
  amountIqd: number;
  tripId?: string | undefined;
  orderId?: string | undefined;
}

export interface PartnerDeps {
  presence: {
    get(driverId: string): Promise<PartnerPresence | null>;
    /** `verticals`: what his roles allow on his registered vehicle (dispatch filters offers by it). */
    online(driverId: string, input: { cityId: string; at: LatLng; vehicle: VehicleClass; tier: PartnerPresence['tier']; verticals?: readonly Vertical[] }): Promise<PartnerPresence>;
    offline(driverId: string): Promise<void>;
    /** Online drivers' zones in the city (demand hint). */
    zones(cityId: string): Promise<Array<string | null>>;
  };
  dispatch: {
    openOffer(driverId: string, cityId: string): Promise<{ offer: PartnerOfferRecord; request: PartnerOfferRequest } | null>;
    /** Zones of the city's jobs that are waiting for a driver. */
    waitingZones(cityId: string): Promise<string[]>;
  };
  trips: {
    forDriver(driverId: string): Promise<Trip[]>;
    get(tripId: string): Promise<Trip>;
  };
  orders: { get(orderId: string): Promise<Order | null> };
  merchants: { name(orgId: string): Promise<string | null> | string | null };
  quotes: { quote(input: { cityId: string; vertical: Vertical; pickupZone: string; dropoffZone: string; at: Date }): Quote | null };
  money: {
    cap(driverId: string): Promise<PartnerCapStatus>;
    driverLines(driverId: string, from: Date): Promise<PartnerLedgerLine[]>;
    batchShare: number;
    take(vertical: Vertical): TakeRule | null;
  };
  roles: { activeRoles(personId: string): Promise<RoleKind[]> };
  vehicles: { vehicleOf(driverId: string): Promise<VehicleClass | null> };
  /** `DriverAccountService.onlineGateFor`: daily check-in, lock-out, expired documents (scoring §2). */
  gate: { onlineGate(driverId: string): Promise<PartnerOnlineGate> };
}

export const PARTNER_DEPS = Symbol('PARTNER_DEPS');

/** The city a driver works in when he is offline (single-city launch). */
export const DEFAULT_CITY = 'aziziyah';
