import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { COURIER_VEHICLES, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import {
  MERCHANT_CATALOG,
  MERCHANT_EVENTS,
  MERCHANT_ORDERS,
  MERCHANT_PEOPLE,
  MERCHANT_STORES,
  MERCHANT_TRIPS,
  MerchantService,
  type MerchantCatalogPort,
  type MerchantEventsPort,
  type MerchantPeoplePort,
} from './merchant.service.js';

/**
 * Driver Merchant (`merchant.*`): the kitchen's stores, live board and status header. A read side and
 * a few switches over other modules' public services — orders (active orders), trips (courier state),
 * identity (role grants, courier first name), orgs (store settings: busy, early close, printer),
 * catalog (item names). Owns no tables: the switches live on the org's merchant settings, which the
 * orders module reads for busy mode (+10 min prep) and early close.
 */
@Module({
  imports: [OrdersModule, TripsModule, IdentityModule, OrgsModule, CatalogModule, EventsModule, TrackingModule],
  providers: [
    { provide: MERCHANT_ORDERS, useExisting: OrdersService },
    { provide: MERCHANT_TRIPS, useExisting: TripsService },
    { provide: MERCHANT_STORES, useExisting: OrgsService },
    {
      provide: MERCHANT_PEOPLE,
      useFactory: (identity: IdentityService, vehicles: CourierVehicleDirectory): MerchantPeoplePort => ({
        grants: async (personId) => (await identity.me({ personId, sessionId: 'merchant:stores' })).roles,
        hasRole: (personId, kind, orgId) => identity.hasRole(personId, kind, orgId),
        courierFirstName: async (courierId, accessorId) => (await identity.courierCard(courierId, accessorId)).firstName,
        courierVehicle: async (courierId, vehicleId) => (await vehicles.forCourier(courierId, vehicleId))?.vehicleClass ?? null,
      }),
      inject: [IdentityService, COURIER_VEHICLES],
    },
    {
      provide: MERCHANT_CATALOG,
      useFactory: (catalog: CatalogService): MerchantCatalogPort => ({
        itemNames: async (orgId, ids) => new Map((await catalog.itemsOf(orgId, ids)).map((i) => [i.id, i.nameAr])),
        storefrontHours: async (orgId) =>
          (await catalog.storefront(orgId))?.hours.map((w) => ({
            dow: w.dow,
            start: w.start,
            end: w.end,
          })) ?? null,
        mirrorHours: async (orgId, windows) => {
          const front = await catalog.storefront(orgId);
          if (front)
            await catalog.saveStorefront({
              ...front,
              hours: windows.map((w) => ({ dow: w.dow, start: w.start, end: w.end })),
            });
        },
      }),
      inject: [CatalogService],
    },
    {
      provide: MERCHANT_EVENTS,
      useFactory: (events: EventsService, clock: Clock): MerchantEventsPort => ({
        record: async (type, actorId, merchantOrgId, payload) => {
          await events.emit(undefined, { actorId, type, occurredAt: clock.now(), payload }, { name: 'merchant', id: merchantOrgId });
        },
      }),
      inject: [EventsService, CLOCK],
    },
    MerchantService,
  ],
  exports: [MerchantService],
})
export class MerchantModule {}
