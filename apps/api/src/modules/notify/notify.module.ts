import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { smsPortFromEnv } from '../../shared/messaging/sms.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { ControlsModule, ControlsService } from '../controls/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PlacesModule, PlacesService } from '../places/index.js';
import { DeparturesService, GARAGES, CORRIDORS, RoutesModule, bookingTotal } from '../routes/index.js';
import { COURIER_VEHICLES, ShareLinksService, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { DEFAULT_ENGINE_OPTIONS, NotifyEngine, type NotifyContacts, type NotifyJob } from './notify.engine.js';
import { cityNameAr, kmBetween, NOTIFY_LOOKUPS, type NotifyLookups } from './notify.lookups.js';
import { InMemoryNotifyRepository, NOTIFY_REPOSITORY, PrismaNotifyRepository, type NotifyRepository } from './notify.repository.js';
import { emergencyContactOwner, NOTIFY_ENGINE, NotifyService, trustedContactOwner } from './notify.service.js';
import { registerNotifySubscribers } from './notify.subscribers.js';
import { pushPortsFromEnv } from './providers/push.js';
import { whatsAppPortFromEnv } from './providers/whatsapp.js';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller.js';

export const NOTIFY_QUEUE = Symbol('NOTIFY_QUEUE');
export const NOTIFY_QUEUE_NAME = 'notify';

const ZONE_AR = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z.name_ar]));
const zoneName = (key: string) => ZONE_AR.get(key) ?? cityNameAr(key);

/** Failures in a lookup answer null: the subscriber then skips the message instead of failing. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Notification delivery (domain §8). Providers by env — push: PUSH_PROVIDER=dev|expo (EXPO_ACCESS_TOKEN)
 * plus FCM HTTP v1 for raw FCM tokens (FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON); SMS: the shared
 * SmsPort (SMS_PROVIDER=dev|http|twilio); WhatsApp: WHATSAPP_PROVIDER=dev|meta (WHATSAPP_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, statuses via the webhook with WHATSAPP_APP_SECRET). With nothing set,
 * every channel is a dev provider that logs.
 *
 * Tables `push_tokens`, `notify_preferences`, `notify_deliveries` (Prisma with DATABASE_URL, in
 * memory otherwise); sends, retries, receipt polls and SMS twins run on the `notify` BullMQ queue
 * (REDIS_URL) or an in-process queue polled every second. The outbox subscriber `notify:deliveries`
 * turns domain events into notifications.
 */
@Module({
  imports: [ControlsModule, EventsModule, IdentityModule, OrdersModule, OrgsModule, PlacesModule, RoutesModule, TrackingModule, TripsModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    {
      provide: NOTIFY_REPOSITORY,
      useFactory: (prisma: PrismaService): NotifyRepository => (prisma.configured ? new PrismaNotifyRepository(prisma) : new InMemoryNotifyRepository()),
      inject: [PrismaService],
    },
    {
      provide: NOTIFY_QUEUE,
      useFactory: (f: BullMqQueueFactory, clock: Clock): Queue<NotifyJob> => (f.configured ? f.queue<NotifyJob>(NOTIFY_QUEUE_NAME) : new InMemoryQueue<NotifyJob>(NOTIFY_QUEUE_NAME, () => clock.now())),
      inject: [BullMqQueueFactory, CLOCK],
    },
    {
      provide: NOTIFY_LOOKUPS,
      useFactory: (
        orders: OrdersService,
        orgs: OrgsService,
        identity: IdentityService,
        departures: DeparturesService,
        trips: TripsService,
        places: PlacesService,
        shares: ShareLinksService,
        vehicles: CourierVehicleDirectory,
      ): NotifyLookups => ({
        order: (orderId) =>
          orNull(async () => {
            const o = await orders.get(orderId);
            const riderId = o.participants.find((p) => p.role === 'rider' && p.personId)?.personId ?? null;
            return { id: o.id, type: o.type, customerId: o.ordererId, merchantOrgId: o.merchantOrgId, totalIqd: o.totalIqd, itemCount: o.lines.reduce((n, l) => n + l.qty, 0), riderId };
          }),
        storeName: (orgId) => orNull(async () => (await orgs.get(orgId)).name),
        orgPeople: async (orgId, kinds) => (await orNull(async () => (await identity.orgRoleHolders(orgId, kinds)).filter((r) => !r.frozen).map((r) => r.personId))) ?? [],
        firstName: (personId, purpose) => orNull(async () => (await identity.firstNamesFor([personId], 'system:notify', purpose))[personId] ?? null),
        booking: (bookingId) =>
          orNull(async () => {
            const b = await departures.booking(bookingId);
            const dep = await departures.departure(b.departureId);
            const corridor = CORRIDORS.find((c) => c.id === dep.corridorId);
            const garage = GARAGES.find((g) => g.id === dep.garageId);
            const vehicle = [dep.vehicle.model, dep.vehicle.plate].filter(Boolean).join(' · ');
            return {
              riderId: b.riderId,
              seats: b.seatIds.join('، '),
              departAt: dep.departAt,
              route: `${cityNameAr(dep.fromCityId)} ← ${cityNameAr(dep.toCityId)}`,
              place:
                b.pickup.kind === 'meeting_point'
                  ? (corridor?.meetingPoints.find((m) => m.id === b.pickup.meetingPointId)?.nameAr ?? garage?.nameAr ?? '')
                  : b.pickup.kind === 'door'
                    ? 'باب البيت'
                    : b.pickup.kind === 'pin'
                      ? (b.pickup.note ?? t('rajaa.pickup_pin_fallback', {}, 'ar-IQ'))
                      : (garage?.nameAr ?? ''),
              vehicle,
              pin: b.pin,
              ...(b.seatIds[0] ? { firstSeat: b.seatIds[0] } : {}),
            };
          }),
        departurePasses: (departureId) =>
          orNull(async () => {
            const dep = await departures.departure(departureId);
            const corridor = CORRIDORS.find((c) => c.id === dep.corridorId);
            const garage = GARAGES.find((g) => g.id === dep.garageId);
            const car = dep.lastPosition;
            return (await departures.bookings(departureId)).map((b) => ({
              bookingId: b.id,
              riderId: b.riderId,
              state: b.state,
              departAt: dep.departAt,
              stop:
                b.pickup.kind === 'meeting_point'
                  ? (corridor?.meetingPoints.find((m) => m.id === b.pickup.meetingPointId)?.nameAr ?? garage?.nameAr ?? '')
                  : b.pickup.kind === 'door'
                    ? 'باب البيت'
                    : b.pickup.kind === 'pin'
                      ? (b.pickup.note ?? t('rajaa.pickup_pin_fallback', {}, 'ar-IQ'))
                      : (garage?.nameAr ?? ''),
              // Step 4: an agreed pin on the way boards like a road stop («أني بنقطة الصعود»).
              pickupKind: b.pickup.kind === 'pin' ? 'meeting_point' : b.pickup.kind,
              toCity: cityNameAr(dep.toCityId),
              seatIds: [...b.seatIds],
              pin: b.pin,
              carKm: car ? kmBetween(car, b.pickup) : null,
              fareIqd: bookingTotal(b),
            }));
          }),
        // w9: the switches and how many trusted people (no names or numbers leave identity here).
        safety: (personId) => orNull(async () => ({ prefs: await identity.safetyPrefsOf(personId), contacts: await identity.trustedContactCount(personId) })),
        // s2: «وصل بالسلامة» reaches only trusted people with an account (identity matches their numbers).
        trustedAccounts: async (personId, purpose) => (await orNull(() => identity.trustedContactAccounts(personId, 'system:notify', purpose))) ?? [],
        // w9 auto-share: the same signed link the rider's own «شارك» makes, created for the rider.
        shareLink: (personId, subject) =>
          orNull(async () => {
            const link = await shares.createShareLink({ personId, sessionId: 'system:notify' }, subject);
            return `${(process.env['SHARE_LINK_BASE_URL'] ?? 'https://driver.iq').replace(/\/$/, '')}${link.path}`;
          }),
        // c9/s3: the name the booker gave the rider («ماما»), read from identity's vault for this message.
        riderName: (orderId) => orNull(async () => (await orders.riderOf(orderId, 'system:notify', 'notify_ride_for_rider'))?.name ?? null),
        // c9 + night start code: the code the rider tells the driver (null when the ride has none).
        startCode: (orderId) => orNull(() => orders.startCodeOf(orderId)),
        // c9: what the rider looks for at the door — the car (model · colour, else its kind) and the plate.
        driverCar: (tripId, driverId) =>
          orNull(async () => {
            const v = await vehicles.forCourier(driverId, (await trips.get(tripId)).vehicleId);
            return v ? { car: v.label ?? t(v.vehicleClass === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi'), plate: v.plate } : null;
          }),
        child: (childRef) => orNull(() => identity.childNotice(childRef)),
        stopPlace: (tripId, stopId) =>
          orNull(async () => {
            const trip = await trips.get(tripId);
            const stop = trip.stops.find((s) => s.id === stopId);
            if (!stop) return null;
            const place = stop.placeId ? await places.get(stop.placeId) : undefined;
            return place?.name ?? zoneName(stop.zoneKey);
          }),
        tripZones: (tripId) =>
          orNull(async () => {
            const trip = await trips.get(tripId);
            const pickup = trip.stops.find((s) => s.type === 'pickup') ?? trip.stops[0];
            const dropoff = [...trip.stops].reverse().find((s) => s.type === 'dropoff') ?? trip.stops[trip.stops.length - 1];
            if (!pickup || !dropoff) return null;
            return { pickup: zoneName(pickup.zoneKey), dropoff: zoneName(dropoff.zoneKey) };
          }),
      }),
      inject: [OrdersService, OrgsService, IdentityService, DeparturesService, TripsService, PlacesService, ShareLinksService, COURIER_VEHICLES],
    },
    {
      provide: NOTIFY_ENGINE,
      useFactory: (repo: NotifyRepository, queue: Queue<NotifyJob>, clock: Clock, identity: IdentityService, controls: ControlsService) => {
        const contacts: NotifyContacts = {
          contact: async (to, opts) => {
            // SOS: `ec:<personId>` is that person's emergency contact — a number, not an account
            // (logged vault read against the person, accessor system:notify).
            const trusted = trustedContactOwner(to);
            if (trusted) {
              // w9: a trusted person of the safety page, by list position (logged vault read).
              if (!opts.phone) return { locale: 'ar-IQ', phoneE164: null };
              const list = await identity.trustedContactsOf(trusted.personId, 'system:notify', opts.purpose);
              const c = list[trusted.index];
              return c ? { locale: 'ar-IQ', phoneE164: c.phoneE164 } : null;
            }
            const owner = emergencyContactOwner(to);
            if (!owner) return identity.notifyContact(to, opts);
            if (!opts.phone) return { locale: 'ar-IQ', phoneE164: null };
            const ec = await identity.emergencyContactOf(owner, 'system:notify', opts.purpose);
            return ec ? { locale: 'ar-IQ', phoneE164: ec.phoneE164 } : null;
          },
        };
        return new NotifyEngine(
          repo,
          { push: pushPortsFromEnv(), sms: smsPortFromEnv(), whatsapp: whatsAppPortFromEnv() },
          contacts,
          queue,
          clock,
          {
            retryBaseMs: envInt('NOTIFY_RETRY_BASE_MS', DEFAULT_ENGINE_OPTIONS.retryBaseMs),
            maxAttempts: envInt('NOTIFY_MAX_ATTEMPTS', DEFAULT_ENGINE_OPTIONS.maxAttempts),
            receiptDelaySec: envInt('NOTIFY_RECEIPT_DELAY_SEC', DEFAULT_ENGINE_OPTIONS.receiptDelaySec),
          },
          // Seasons set in the Console: no offers on mourning days, none in the minutes before iftar (J1a, J6).
          (at) => controls.promoHold(at),
        );
      },
      inject: [NOTIFY_REPOSITORY, NOTIFY_QUEUE, CLOCK, IdentityService, ControlsService],
    },
    NotifyService,
  ],
  exports: [NotifyService],
})
export class NotifyModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NotifyModule');
  private poller: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private draining = false;

  constructor(
    @Inject(NOTIFY_QUEUE) private readonly queue: Queue<NotifyJob>,
    @Inject(NOTIFY_ENGINE) private readonly engine: NotifyEngine,
    @Inject(NOTIFY_REPOSITORY) private readonly repo: NotifyRepository,
    @Inject(NOTIFY_LOOKUPS) private readonly lookups: NotifyLookups,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    this.queue.process(async (job) => this.engine.process(job.data));
    this.unsubscribe = registerNotifySubscribers(this.events, {
      engine: this.engine,
      repo: this.repo,
      lookups: this.lookups,
      receiptBaseUrl: process.env['NOTIFY_RECEIPT_BASE_URL'] ?? 'https://driver.iq/r/',
    });
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        if (this.draining) return;
        this.draining = true;
        q.drain()
          .catch((err: unknown) => this.logger.error(`notify job failed: ${(err as Error).message}`))
          .finally(() => {
            this.draining = false;
          });
      }, 1000);
      this.poller.unref();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.poller) clearInterval(this.poller);
  }
}
