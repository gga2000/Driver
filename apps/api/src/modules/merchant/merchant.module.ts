import { RoutingModule } from '../routing/index.js';
import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { BLOB_STORE, ownsStoredUpload, PlacesModule, type BlobStore } from '../places/index.js';
import { COURIER_VEHICLES, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { ControlsModule, ControlsService } from '../controls/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { ZonesModule, ZonesService } from '../zones/index.js';
import { foodDeliveryFee } from './area.js';
import { MERCHANT_SETUP_CATALOG, MerchantSetupService, setupCatalogOf, type SetupCatalogPort } from './setup.service.js';
import {
  MERCHANT_AREA,
  MERCHANT_CATALOG,
  MERCHANT_EVENTS,
  MERCHANT_ORDERS,
  MERCHANT_PEOPLE,
  MERCHANT_PHOTOS,
  MERCHANT_SETUP_LINE,
  MERCHANT_STORES,
  MERCHANT_TRIPS,
  MerchantService,
  type MerchantAreaPort,
  type MerchantCatalogPort,
  type MerchantEventsPort,
  type MerchantPeoplePort,
  type MerchantPhotosPort,
} from './merchant.service.js';

/**
 * Driver Merchant (`merchant.*`): the kitchen's stores, live board and status header. A read side and
 * a few switches over other modules' public services — orders (active orders), trips (courier state),
 * identity (role grants, courier first name), orgs (store settings: busy, early close, printer),
 * catalog (item names), places (pickup-spot photos in the blob store), and for the delivery map zones
 * (outlines), pricing (checkout's fee quote) and controls (switched-off zones). Owns no tables: the switches and
 * the pickup spot live on the org's merchant settings, which the orders module reads for busy mode
 * (+10 min prep) and early close.
 */
@Module({
  imports: [OrdersModule, TripsModule, IdentityModule, OrgsModule, CatalogModule, EventsModule, TrackingModule, RoutingModule, PlacesModule, ZonesModule, PricingModule, ControlsModule],
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
        courierVehicle: async (courierId, vehicleId) => {
          const v = await vehicles.forCourier(courierId, vehicleId);
          return v ? { vehicleClass: v.vehicleClass, plate: v.plate } : null;
        },
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
        storefrontTags: async (orgId) => (await catalog.storefront(orgId))?.tags ?? null,
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
    // Delivery area (maps program r5): the zones every map draws, checkout's fee quote and the switches
    // `orders.place` obeys, so the kitchen's map can't disagree with what customers are charged.
    {
      provide: MERCHANT_AREA,
      useFactory: (zones: ZonesService, pricing: PricingService, controls: ControlsService): MerchantAreaPort => ({
        zones: (cityId) => zones.list(cityId),
        foodDeliveryFee: (cityId, kitchenZone, dropoffZone, at) => foodDeliveryFee(pricing, cityId, kitchenZone, dropoffZone, at),
        pausedZones: async (cityId, merchantOrgId, kitchenZone, zoneKeys) => {
          const paused = new Set<string>();
          for (const key of zoneKeys) {
            if (await controls.blockingSwitch({ cityId, vertical: 'food', zones: [kitchenZone, key], merchantOrgId })) paused.add(key);
          }
          return paused;
        },
      }),
      inject: [ZonesService, PricingService, ControlsService],
    },
    // Pickup-spot photos (maps program r7): uploads in the places blob store, read through signed links.
    {
      provide: MERCHANT_PHOTOS,
      useFactory: (blobs: BlobStore): MerchantPhotosPort => ({
        owns: (id, personId) => ownsStoredUpload(blobs, id, personId),
        readUrl: (id) => blobs.readUrl(id),
        remove: (id) => blobs.remove(id),
      }),
      inject: [BLOB_STORE],
    },
    // «جهّز محلك»: dishes, photos, the menu-photo draft and the storefront through the catalog's own calls.
    {
      provide: MERCHANT_SETUP_CATALOG,
      useFactory: (catalog: CatalogService): SetupCatalogPort => setupCatalogOf(catalog),
      inject: [CatalogService],
    },
    MerchantSetupService,
    { provide: MERCHANT_SETUP_LINE, useExisting: MerchantSetupService },
    MerchantService,
  ],
  exports: [MerchantService, MerchantSetupService],
})
export class MerchantModule {}
