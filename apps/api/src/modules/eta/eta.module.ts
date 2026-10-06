import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule, ConfigService } from '../config/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { ZoneResolver } from '../places/index.js';
import { ETA_CORRECTION, EtaService, RoutingModule } from '../routing/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { ETA_CORRECTIONS_REPOSITORY, InMemoryEtaCorrectionsRepository, PrismaEtaCorrectionsRepository, type EtaCorrectionsRepository } from './eta-corrections.repository.js';
import { EtaLearner } from './eta-learner.js';
import { ETA_ZONES, LearnedEtaCorrection, zoneLocator, type ZoneLocator } from './learned-eta-correction.js';

/**
 * The one ETA's learned correction (maps program f7, spec §5.4): Postgres with DATABASE_URL, memory
 * otherwise; the `eta:learn-legs` subscriber feeds it from finished legs.
 *
 * Global, exporting only `ETA_CORRECTION`: the routing module's `EtaService` takes it as an optional
 * port, so routing — imported by nearly every module — imports nothing, and this module (which needs
 * trips, events and routing itself) is never imported by them. Without this module every ETA is the
 * router's own.
 */
@Global()
@Module({
  imports: [ConfigModule, EventsModule, TripsModule, RoutingModule],
  providers: [
    {
      provide: ETA_CORRECTIONS_REPOSITORY,
      useFactory: (prisma: PrismaService): EtaCorrectionsRepository => (prisma.configured ? new PrismaEtaCorrectionsRepository(prisma) : new InMemoryEtaCorrectionsRepository()),
      inject: [PrismaService],
    },
    { provide: ETA_ZONES, useFactory: (config: ConfigService): ZoneLocator => zoneLocator(new ZoneResolver(), () => config.cityIds()), inject: [ConfigService] },
    {
      provide: LearnedEtaCorrection,
      useFactory: (repo: EtaCorrectionsRepository, zones: ZoneLocator, clock: Clock) => new LearnedEtaCorrection(repo, zones, clock),
      inject: [ETA_CORRECTIONS_REPOSITORY, ETA_ZONES, CLOCK],
    },
    { provide: ETA_CORRECTION, useExisting: LearnedEtaCorrection },
    {
      provide: EtaLearner,
      useFactory: (trips: TripsService, events: EventsService, eta: EtaService, repo: EtaCorrectionsRepository, zones: ZoneLocator, learnt: LearnedEtaCorrection) =>
        new EtaLearner(trips, events, eta, repo, zones, learnt),
      inject: [TripsService, EventsService, EtaService, ETA_CORRECTIONS_REPOSITORY, ETA_ZONES, LearnedEtaCorrection],
    },
  ],
  exports: [ETA_CORRECTION],
})
export class EtaModule implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(EtaLearner) private readonly learner: EtaLearner,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.learner.register(this.events);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
