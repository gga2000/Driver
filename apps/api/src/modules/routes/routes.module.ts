import { Module, type OnModuleInit } from '@nestjs/common';
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { BLOB_STORE, PlacesModule, type BlobStore } from '../places/index.js';
import { AuditLogService, ControlsModule, ControlsService } from '../controls/index.js';
import { LedgerModule, LedgerService } from '../ledger/index.js';
import { DemandService } from './demand.service.js';
import { RoutesDeparturesPort } from './departures.port.js';
import { DeparturesService } from './departures.service.js';
import { DEPARTURES_AUDIT, DeparturesStaffService, GARAGE_WATCH_RULES, garageWatchRulesFromEnv } from './departures.staff.js';
import { EventsServiceAdapter, ROUTES_EVENTS } from './events.adapter.js';
import { INTERCITY_NETWORK, INTERCITY_RULES } from './intercity.config.js';
import { TrailCheckpointWaiver } from './late-meter.js';
import { PrismaRoutesRepository } from './prisma.repository.js';
import { RequestBoardService } from './request-board.service.js';
import { InMemoryRoutesRepository, ROUTES_REPOSITORY } from './routes.repository.js';
import { RoutesRpc } from './routes.rpc.js';
import { RoutesScheduler } from './scheduler.js';
import { randomIds, ROUTES_IDS } from './support.js';
import { callBridgeFor } from '../../shared/call-bridge.js';
import { CHECKPOINT_WAIVER, ROUTES_CALLS, ROUTES_CONTROLS, ROUTES_MONEY_RULES, ROUTES_NETWORK, ROUTES_POINTS, ROUTES_RIDER_NAMES, ROUTES_RULES, type RiderNamesReader, type RoutesCallPort } from './tokens.js';
import { LedgerPoints, LedgerWallet, ROUTES_WALLET } from './wallet.js';
import { RoutesWriter } from './writer.js';

/**
 * الرجعة (intercity): garages, departures, seats, the demand board and the request board.
 *
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory otherwise; events through the
 * outbox (the ledger posts `seat.*`, `departure.cancelled` and the request board's ride facts);
 * the wallet balance from the ledger; Aziziyah money rules for the late meter (the ledger's own
 * figures); the scheduler ticks every 15 s. `RoutesDeparturesPort` is what dispatch binds as its
 * `DEPARTURES` port.
 */
@Module({
  imports: [EventsModule, LedgerModule, IdentityModule, ControlsModule, PlacesModule],
  providers: [
    {
      provide: ROUTES_REPOSITORY,
      useFactory: (prisma: PrismaService) =>
        prisma.configured ? new PrismaRoutesRepository(prisma) : new InMemoryRoutesRepository(),
      inject: [PrismaService],
    },
    {
      provide: ROUTES_EVENTS,
      useFactory: (events: EventsService) => new EventsServiceAdapter(events),
      inject: [EventsService],
    },
    {
      provide: ROUTES_WALLET,
      useFactory: (ledger: LedgerService) => new LedgerWallet(ledger),
      inject: [LedgerService],
    },
    // r2: «+15 نقطة» on the safe-arrival card, read from where the ledger posted the seat's points.
    { provide: ROUTES_POINTS, useFactory: (ledger: LedgerService) => new LedgerPoints(ledger), inject: [LedgerService] },
    { provide: ROUTES_NETWORK, useValue: INTERCITY_NETWORK },
    { provide: ROUTES_RULES, useValue: INTERCITY_RULES },
    { provide: ROUTES_MONEY_RULES, useValue: AZIZIYAH_MONEY_RULES },
    { provide: CHECKPOINT_WAIVER, useClass: TrailCheckpointWaiver },
    { provide: ROUTES_IDS, useValue: randomIds },
    {
      provide: ROUTES_RIDER_NAMES,
      useFactory: (identity: IdentityService, blobs: BlobStore): RiderNamesReader => ({
        firstNamesFor: (ids, accessorId, purpose) => identity.firstNamesFor(ids, accessorId, purpose),
        memberCards: (ids, accessorId, purpose) => identity.memberCards(ids, accessorId, purpose),
        driverPhotoUrls: async (ids, accessorId, purpose) => Object.fromEntries(Object.entries(await identity.mainPhotoRefs(ids, accessorId, purpose)).map(([id, ref]) => [id, blobs.readUrl(ref)])),
      }),
      inject: [IdentityService, BLOB_STORE],
    },
    // Launch kill switches: corridor / الرجعة switches refuse new holds and request posts.
    { provide: ROUTES_CONTROLS, useExisting: ControlsService },
    // Garage mode "اتصل": the same masked-call bridge as in-order chat (dev: the rider's own number, logged).
    {
      provide: ROUTES_CALLS,
      useFactory: (identity: IdentityService): RoutesCallPort => callBridgeFor(identity),
      inject: [IdentityService],
    },
    RoutesWriter,
    RequestBoardService,
    DeparturesService,
    DemandService,
    RoutesRpc,
    RoutesDeparturesPort,
    RoutesScheduler,
    // W3 / NTF-14: the Console's way out of a dead departure; the auto-cancel switch is off by default.
    { provide: GARAGE_WATCH_RULES, useFactory: () => garageWatchRulesFromEnv() },
    { provide: DEPARTURES_AUDIT, useExisting: AuditLogService },
    DeparturesStaffService,
  ],
  exports: [RoutesRpc, DeparturesService, DeparturesStaffService, RequestBoardService, RoutesDeparturesPort, RoutesScheduler],
})
export class RoutesModule implements OnModuleInit {
  constructor(private readonly controls: ControlsService) {}

  /** The console's corridor switches name and validate the corridors this module serves. */
  onModuleInit(): void {
    this.controls.registerCorridors(INTERCITY_NETWORK.corridors.map((c) => ({ id: c.id, name_ar: c.nameAr })));
  }
}
