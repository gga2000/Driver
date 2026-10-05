import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DevCallBridge, isDevEnvironment, ProxyCallBridge } from '../chat/index.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { LiveModule } from '../live/index.js';
import { emergencyContactOwner, NotifyModule } from '../notify/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { DeparturesService, RequestBoardService, RoutesModule } from '../routes/index.js';
import { COURIER_VEHICLES, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { InMemorySafetyRepository, PrismaSafetyRepository, SAFETY_REPOSITORY, type SafetyRepository } from './safety.repository.js';
import { SAFETY_CALLS, SAFETY_CONFIG, SAFETY_SOURCES, SafetyService, type SafetyCallPort, type SafetyConfig } from './safety.service.js';
import type { SafetySources } from './safety.subjects.js';

async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * SOS (scoring & safety §3). Owns `safety_incidents`, `safety_incident_entries` and
 * `safety_incident_fixes` (Prisma with DATABASE_URL, in memory otherwise). Reads trips, orders,
 * الرجعة departures and private rides through their public services; names, numbers and the
 * emergency contact through identity (logged vault reads); pages and messages through notify; the
 * Console hears it on the live `safety` channel. Masked calls use the chat module's bridge classes
 * (development: the real number, logged; otherwise the platform's proxy number).
 *
 * Env: SAFETY_LINK_BASE_URL (the emergency contact's page, default https://driver.iq/sos/),
 * CONSOLE_BASE_URL (dispatcher WhatsApp link), SAFETY_LINK_SECRET (else SHARE_LINK_SECRET / JWT_SECRET),
 * SAFETY_SWEEP_MS (default 5000; 0 turns the sweep off), SAFETY_TIMERS=0 turns the in-process timers off.
 */
@Module({
  imports: [ControlsModule, EventsModule, IdentityModule, LiveModule, NotifyModule, OrdersModule, RoutesModule, TrackingModule, TripsModule],
  providers: [
    {
      provide: SAFETY_REPOSITORY,
      useFactory: (prisma: PrismaService): SafetyRepository => (prisma.configured ? new PrismaSafetyRepository(prisma) : new InMemorySafetyRepository()),
      inject: [PrismaService],
    },
    {
      provide: SAFETY_SOURCES,
      useFactory: (orders: OrdersService, trips: TripsService, departures: DeparturesService, requests: RequestBoardService, vehicles: CourierVehicleDirectory): SafetySources => ({
        order: (id) => orNull(() => orders.get(id)),
        courierOf: (orderId) => orNull(() => trips.courierOf(orderId)),
        trip: (id) => orNull(() => trips.get(id)),
        departure: (id) =>
          orNull(async () => {
            const d = await departures.departure(id);
            return {
              id: d.id,
              driverId: d.driverId,
              fromCityId: d.fromCityId,
              toCityId: d.toCityId,
              state: d.state,
              departAt: d.departAt,
              arrivedAt: d.arrivedAt,
              closedAt: d.closedAt,
              vehicle: { plate: d.vehicle.plate, model: d.vehicle.model },
              lastPosition: d.lastPosition ? { lat: d.lastPosition.lat, lng: d.lastPosition.lng, at: d.lastPosition.at } : null,
            };
          }),
        riders: async (departureId) => ((await orNull(() => departures.bookings(departureId))) ?? []).map((b) => ({ bookingId: b.id, riderId: b.riderId, state: b.state })),
        booking: (id) =>
          orNull(async () => {
            const b = await departures.booking(id);
            return { id: b.id, departureId: b.departureId, riderId: b.riderId, state: b.state };
          }),
        request: (id) =>
          orNull(async () => {
            const r = await requests.get(id);
            if (!r) return null;
            const picked = r.offers.find((o) => o.id === r.pickedOfferId) ?? null;
            return { id: r.id, riderId: r.riderId, cityId: r.cityId, state: r.state, pickedDriverId: picked?.driverId ?? null, from: r.from.label, to: r.to.label, closedAt: r.closedAt };
          }),
        vehicle: (courierId, vehicleId) => orNull(async () => await vehicles.forCourier(courierId, vehicleId)),
        tripFix: (tripId) =>
          orNull(async () => {
            const p = await trips.lastPosition(tripId);
            return p ? { lat: p.pin.lat, lng: p.pin.lng, at: p.at } : null;
          }),
      }),
      inject: [OrdersService, TripsService, DeparturesService, RequestBoardService, COURIER_VEHICLES],
    },
    {
      provide: SAFETY_CALLS,
      useFactory: (identity: IdentityService): SafetyCallPort => {
        // The callee may be the person's emergency contact (`ec:<personId>`): a logged vault read of it.
        const phones = {
          phoneForCall: async (calleeId: string, callerId: string, purpose: string) => {
            const owner = emergencyContactOwner(calleeId);
            if (!owner) return identity.phoneForCall(calleeId, callerId, purpose);
            return (await identity.emergencyContactOf(owner, callerId, purpose))?.phoneE164 ?? null;
          },
        };
        return isDevEnvironment(process.env['NODE_ENV']) && process.env['CALL_BRIDGE'] !== 'proxy' ? new DevCallBridge(phones) : new ProxyCallBridge(process.env['CALL_PROXY_NUMBER']);
      },
      inject: [IdentityService],
    },
    {
      provide: SAFETY_CONFIG,
      useFactory: (): SafetyConfig => ({
        secret: process.env['SAFETY_LINK_SECRET'] ?? process.env['SHARE_LINK_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex'),
        linkBase: process.env['SAFETY_LINK_BASE_URL'] ?? 'https://driver.iq/sos/',
        consoleBase: process.env['CONSOLE_BASE_URL'] ?? 'https://console.driver.iq',
        timers: process.env['SAFETY_TIMERS'] !== '0',
        sweepMs: envInt('SAFETY_SWEEP_MS', 5_000),
      }),
    },
    SafetyService,
  ],
  exports: [SafetyService],
})
export class SafetyModule {}
