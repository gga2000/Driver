import { Module } from '@nestjs/common';
import { EtaService, RoutingModule } from '../routing/index.js';
import { AZIZIYAH_MONEY_RULES, type RoleKind, type Vertical } from '@driver/contracts';
import { ClimateChecks, DispatchModule, DispatchService, type BookedJobInfo } from '../dispatch/index.js';
import { DriverAccountModule, DriverAccountService } from '../driver-account/index.js';
import { FleetModule, FleetService } from '../fleet/index.js';
import { IdentityModule, ROLE_READER, type RoleReader } from '../identity/index.js';
import { Accounts, CapsService, LedgerModule, LedgerService } from '../ledger/index.js';
import { MerchantModule, MerchantService } from '../merchant/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { COURIER_VEHICLES, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { WAITING_STATUSES, type TakeRule } from './logic.js';
import { PartnerService } from './partner.service.js';
import { PlacesModule, SavedPlacesService } from '../places/index.js';
import { PARTNER_DEPS, type PartnerBookedRecord, type PartnerDeps } from './ports.js';

/** Take rules by vertical (money & ops §3): rides and parcels; food, grocery and errand fees pass through. */
function takeFor(vertical: Vertical): TakeRule | null {
  const take = AZIZIYAH_MONEY_RULES.take;
  if (vertical === 'tuktuk') return take.tuktuk;
  if (vertical === 'taxi') return take.car;
  // The ledger books a parcel as its fare less the parcel take (`postRideCompleted`), so the offer shows the same.
  if (vertical === 'parcel') return take.parcel;
  return null;
}

/**
 * Driver Partner read side (`ctx.partner`): composes the public services of dispatch, trips,
 * orders, orgs, pricing, the ledger, identity's role reader, the courier vehicle registry, the
 * customer's door (places), the kitchen's pickup spot (merchant) and the driver account's online gate into one narrow port (`PARTNER_DEPS`). Owns no tables and writes only
 * presence, through dispatch.
 */
@Module({
  imports: [DispatchModule, TripsModule, OrdersModule, OrgsModule, PricingModule, LedgerModule, IdentityModule, TrackingModule, DriverAccountModule, FleetModule, RoutingModule, PlacesModule, MerchantModule],
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
        eta: EtaService,
        places: SavedPlacesService,
        merchant: MerchantService,
        climate: ClimateChecks,
      ): PartnerDeps => ({
        roads: { path: (points) => eta.path(points) },
        presence: {
          get: (id) => dispatch.presence.get(id),
          online: (id, input) => dispatch.presence.online(id, input),
          offline: (id) => dispatch.presence.offline(id),
          zones: async (cityId) => (await dispatch.presence.list(cityId)).map((p) => p.zoneId),
        },
        dispatch: {
          openOffer: (id, cityId) => dispatch.openOffer(id, cityId),
          bookedJobs: async (id, cityId) => {
            const found = await dispatch.bookedJobs(id, cityId);
            const record = (i: BookedJobInfo): PartnerBookedRecord => ({
              request: i.request,
              scheduledFor: new Date(i.job.scheduledFor),
              confirmBy: new Date(i.job.confirmBy),
              startFrom: i.startFrom,
              showBy: i.showBy,
              favourite: i.favourite,
              held: i.job.driverId === id,
            });
            return { online: found.online, mine: found.mine.map(record), open: found.open.map(record) };
          },
          answerBookedJob: (id, tripId, answer) => dispatch.answerBookedJob(id, tripId, answer),
          waitingZones: async (cityId) => {
            try {
              return (await dispatch.board(cityId)).cards.filter((c) => WAITING_STATUSES.has(c.status)).map((c) => c.zoneId);
            } catch {
              return [];
            }
          },
        },
        trips: { forDriver: (id) => trips.forDriver(id), get: (tripId) => trips.get(tripId), lastPosition: (tripId) => trips.lastPosition(tripId), pickupsByZone: (cityId, from, to) => trips.pickupsByZone(cityId, from, to) },
        orders: {
          get: (orderId) => orders.get(orderId).catch(() => null),
          startCodeRequired: async (orderId) => (await orders.startCodeOf(orderId)) !== null,
          // c9/s3: who he picks up when the ride was booked for someone else (a logged vault read).
          riderName: async (orderId, driverId) => (await orders.riderOf(orderId, driverId, 'partner_rider'))?.name ?? null,
          // SEC-14: whom he hands it to when someone else receives it (a logged vault read).
          recipientName: async (orderId, driverId) => {
            const [o] = await orders.withRecipients([await orders.get(orderId)], driverId, 'partner_recipient');
            return o?.participants.find((p) => p.role === 'recipient')?.label ?? null;
          },
          riderTrips: (orderId) => orders.finishedRidesBefore(orderId),
        },
        merchants: {
          name: async (orgId) => (await orgs.find(orgId))?.name ?? null,
        },
        quotes: {
          quote: ({ cityId, vertical, pickupZone, dropoffZone, at }) =>
            pricing.quote({ cityId, vertical, stops: [{ zoneId: pickupZone, type: 'pickup' }, { zoneId: dropoffZone, type: 'dropoff' }], options: { frontSeat: false, doorPickup: false, streetHandover: false, waitMinutes: 0, promoIqd: 0 }, at }),
        },
        money: {
          // Speed x2: his limit (role and tier) is kept a few minutes for the app's own reads; cash is read every time.
          cap: (id) => caps.status(id, { keptLimit: true }),
          driverLines: async (id, from) => (await ledger.statement(Accounts.driver(id), { from })).lines,
          batchShare: AZIZIYAH_MONEY_RULES.batchedSecondCourierShare,
          take: takeFor,
        },
        roles: { activeRoles: (id): Promise<RoleKind[]> => roles.activeRoles(id) },
        // The registered vehicle (review #20): the vehicle registry the courier card reads (`vehicles`
        // with a database, the in-process registry otherwise), else the fleet's own registry.
        vehicles: { vehicleOf: async (id) => (await vehicles.forCourier(id, null))?.vehicleClass ?? (await fleet.activeVehicleOf(id))?.vehicleClass ?? null },
        // Maps program SP3d: the customer's door (note, photos, first visit) on drop-offs at saved places.
        places: { courierDoor: (placeId, input) => places.courierDoor(placeId, input), dropoffsAt: (placeId, tripId) => trips.dropoffsAt(placeId, tripId) },
        // Maps program r7: the kitchen's pickup spot (note, photos) on pickups still to do.
        pickupSpots: { forCourier: (merchantOrgId, input) => merchant.courierPickupSpot(merchantOrgId, input) },
        // Ride idea x1: the shift's AC / heating question, on what the car check confirmed for his car.
        climate: {
          check: async (id) => climate.checkFor(id, (await fleet.activeVehicleOf(id))?.featuresConfirmed ?? []),
          answer: async (id, working) => climate.answer(id, (await fleet.activeVehicleOf(id))?.featuresConfirmed ?? [], working),
        },
        gate: {
          onlineGate: async (id) => {
            const g = await account.onlineGateFor(id);
            return { canGoOnline: g.canGoOnline, reasons: g.reasons };
          },
        },
      }),
      inject: [DispatchService, TripsService, OrdersService, OrgsService, PricingService, CapsService, LedgerService, ROLE_READER, COURIER_VEHICLES, DriverAccountService, FleetService, EtaService, SavedPlacesService, MerchantService, ClimateChecks],
    },
    PartnerService,
  ],
  exports: [PartnerService],
})
export class PartnerModule {}
