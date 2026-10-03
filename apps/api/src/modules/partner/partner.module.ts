import { Module } from '@nestjs/common';
import { AZIZIYAH_MONEY_RULES, type RoleKind, type Vertical } from '@driver/contracts';
import { DispatchModule, DispatchService } from '../dispatch/index.js';
import { DriverAccountModule, DriverAccountService } from '../driver-account/index.js';
import { FleetModule, FleetService } from '../fleet/index.js';
import { IdentityModule, ROLE_READER, type RoleReader } from '../identity/index.js';
import { Accounts, CapsService, LedgerModule, LedgerService } from '../ledger/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { COURIER_VEHICLES, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { WAITING_STATUSES, type TakeRule } from './logic.js';
import { PartnerService } from './partner.service.js';
import { PARTNER_DEPS, type PartnerDeps } from './ports.js';

/** Ride take rules by vertical (money & ops §3); deliveries pass through and have none. */
function takeFor(vertical: Vertical): TakeRule | null {
  const take = AZIZIYAH_MONEY_RULES.take;
  if (vertical === 'tuktuk') return take.tuktuk;
  if (vertical === 'taxi') return take.car;
  return null;
}

/**
 * Driver Partner read side (`ctx.partner`): composes the public services of dispatch, trips,
 * orders, orgs, pricing, the ledger, identity's role reader, the courier vehicle registry and the
 * driver account's online gate into one narrow port (`PARTNER_DEPS`). Owns no tables and writes only
 * presence, through dispatch.
 */
@Module({
  imports: [DispatchModule, TripsModule, OrdersModule, OrgsModule, PricingModule, LedgerModule, IdentityModule, TrackingModule, DriverAccountModule, FleetModule],
  providers: [
    {
      provide: PARTNER_DEPS,
      useFactory: (
        dispatch: DispatchService,
        trips: TripsService,
        orders: OrdersService,
        orgs: OrgsService,
        pricing: PricingService,
        caps: CapsService,
        ledger: LedgerService,
        roles: RoleReader,
        vehicles: CourierVehicleDirectory,
        account: DriverAccountService,
        fleet: FleetService,
      ): PartnerDeps => ({
        presence: {
          get: (id) => dispatch.presence.get(id),
          online: (id, input) => dispatch.presence.online(id, input),
          offline: (id) => dispatch.presence.offline(id),
          zones: async (cityId) => (await dispatch.presence.list(cityId)).map((p) => p.zoneId),
        },
        dispatch: {
          openOffer: (id, cityId) => dispatch.openOffer(id, cityId),
          waitingZones: async (cityId) => {
            try {
              return (await dispatch.board(cityId)).cards.filter((c) => WAITING_STATUSES.has(c.status)).map((c) => c.zoneId);
            } catch {
              return [];
            }
          },
        },
        trips: { forDriver: (id) => trips.forDriver(id), get: (tripId) => trips.get(tripId) },
        orders: { get: (orderId) => orders.get(orderId).catch(() => null) },
        merchants: {
          name: async (orgId) => (await orgs.find(orgId))?.name ?? null,
        },
        quotes: {
          quote: ({ cityId, vertical, pickupZone, dropoffZone, at }) =>
            pricing.quote({ cityId, vertical, stops: [{ zoneId: pickupZone, type: 'pickup' }, { zoneId: dropoffZone, type: 'dropoff' }], options: { frontSeat: false, doorPickup: false, streetHandover: false, waitMinutes: 0, promoIqd: 0 }, at }),
        },
        money: {
          cap: (id) => caps.status(id),
          driverLines: async (id, from) => (await ledger.statement(Accounts.driver(id), { from })).lines,
          batchShare: AZIZIYAH_MONEY_RULES.batchedSecondCourierShare,
          take: takeFor,
        },
        roles: { activeRoles: (id): Promise<RoleKind[]> => roles.activeRoles(id) },
        // The registered vehicle (review #20): the vehicle registry the courier card reads (`vehicles`
        // with a database, the in-process registry otherwise), else the fleet's own registry.
        vehicles: { vehicleOf: async (id) => (await vehicles.forCourier(id, null))?.vehicleClass ?? (await fleet.activeVehicleOf(id))?.vehicleClass ?? null },
        gate: {
          onlineGate: async (id) => {
            const g = await account.onlineGateFor(id);
            return { canGoOnline: g.canGoOnline, reasons: g.reasons };
          },
        },
      }),
      inject: [DispatchService, TripsService, OrdersService, OrgsService, PricingService, CapsService, LedgerService, ROLE_READER, COURIER_VEHICLES, DriverAccountService, FleetService],
    },
    PartnerService,
  ],
  exports: [PartnerService],
})
export class PartnerModule {}
