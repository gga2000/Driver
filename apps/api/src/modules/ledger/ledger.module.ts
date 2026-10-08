import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { AZIZIYAH_MONEY_RULES, type MoneyRules } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory } from '../../shared/queue.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService, ROLE_READER, type RoleReader } from '../identity/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { ScoringModule, ScoringService } from '../scoring/index.js';
import { AdjustmentService } from './adjustments.service.js';
import { CAP_PROFILE_RESOLVER, CapsService, IdentityScoringCapProfiles } from './caps.js';
import { EventsServiceLedgerBus, type LedgerEventBus } from './events.adapter.js';
import { EventsShiftActivity, SHIFT_ACTIVITY, ShiftGuaranteeService } from './guarantee.js';
import { LedgerIncidents } from './incidents.js';
import { CustomerWalletService, WALLET_HOUSEHOLDS, WALLET_PEOPLE, type WalletHouseholds } from './customer-wallet.js';
import { LedgerFacade } from './ledger.facade.js';
import { LedgerService } from './ledger.service.js';
import { registerLedgerSubscribers } from './ledger.subscribers.js';
import { MerchantCashService } from './merchant-cash.service.js';
import { InMemoryMerchantSettingsRepository, PrismaMerchantSettingsRepository } from './merchant-settings.repository.js';
import { NIGHTLY_QUEUE, NightlyJob } from './nightly.job.js';
import { PostingService } from './posting.service.js';
import { SupportCreditService } from './support-credit.js';
import { PrismaLedgerBalanceStore, PrismaLedgerRepository, type LedgerEventDelegate, type RawSqlRunner } from './prisma.repository.js';
import { InMemoryLedgerRepository } from './repository.js';
import { CAPS_PORT, LEDGER_EVENTS, LEDGER_INCIDENTS, LEDGER_REPOSITORY, MERCHANT_SETTINGS_REPOSITORY, MONEY_RULES } from './tokens.js';

/**
 * Wiring: Prisma repositories when DATABASE_URL is set, in-memory twins otherwise; Aziziyah money
 * rules until config serves them per city; subscribers registered on boot; the 02:00 nightly close
 * scheduled on BullMQ when REDIS_URL is set (the Console can always run it by hand).
 */
@Module({
  imports: [EventsModule, IdentityModule, ScoringModule, OrgsModule],
  providers: [
    {
      provide: LEDGER_REPOSITORY,
      useFactory: (prisma: PrismaService) =>
        prisma.configured
          ? new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate, new PrismaLedgerBalanceStore(prisma.prisma as unknown as RawSqlRunner))
          : new InMemoryLedgerRepository(),
      inject: [PrismaService],
    },
    {
      provide: MERCHANT_SETTINGS_REPOSITORY,
      useFactory: (prisma: PrismaService) => (prisma.configured ? new PrismaMerchantSettingsRepository(prisma) : new InMemoryMerchantSettingsRepository()),
      inject: [PrismaService],
    },
    { provide: MONEY_RULES, useValue: AZIZIYAH_MONEY_RULES },
    { provide: LEDGER_EVENTS, useFactory: (events: EventsService) => new EventsServiceLedgerBus(events), inject: [EventsService] },
    { provide: LEDGER_INCIDENTS, useFactory: (bus: LedgerEventBus, clock: Clock) => new LedgerIncidents(bus, clock), inject: [LEDGER_EVENTS, CLOCK] },
    // Caps by role (G-80): role from identity's narrow role port, tier from the driver's scorecard (bronze without one).
    {
      provide: CAP_PROFILE_RESOLVER,
      useFactory: (roles: RoleReader, scoring: ScoringService, clock: Clock, rules: MoneyRules) => new IdentityScoringCapProfiles(roles, scoring, clock, rules),
      inject: [ROLE_READER, ScoringService, CLOCK, MONEY_RULES],
    },
    LedgerService,
    CapsService,
    { provide: CAPS_PORT, useExisting: CapsService },
    MerchantCashService,
    PostingService,
    AdjustmentService,
    // G-91 shift guarantee: activity from the driver's own trip events; posted on the Sunday run.
    { provide: SHIFT_ACTIVITY, useFactory: (events: EventsService) => new EventsShiftActivity(events), inject: [EventsService] },
    ShiftGuaranteeService,
    NightlyJob,
    LedgerFacade,
    // Customer wallet (customer spec §9): own phone hash for pending points, household from orgs.
    { provide: WALLET_PEOPLE, useExisting: IdentityService },
    {
      provide: WALLET_HOUSEHOLDS,
      useFactory: (orgs: OrgsService): WalletHouseholds => ({
        householdOf: async (personId) => {
          const home = (await orgs.householdsOf(personId))[0];
          const me = home?.members.find((m) => m.personId === personId);
          return home && me ? { id: home.id, name: home.name, role: me.role } : null;
        },
      }),
      inject: [OrgsService],
    },
    CustomerWalletService,
    SupportCreditService,
  ],
  exports: [LedgerService, CapsService, CAPS_PORT, MONEY_RULES, MerchantCashService, PostingService, AdjustmentService, ShiftGuaranteeService, NightlyJob, LedgerFacade, CustomerWalletService, SupportCreditService],
})
export class LedgerModule implements OnModuleInit {
  private readonly logger = new Logger(LedgerModule.name);

  constructor(
    @Inject(LEDGER_EVENTS) private readonly bus: LedgerEventBus,
    private readonly posting: PostingService,
    private readonly merchantCash: MerchantCashService,
    private readonly nightly: NightlyJob,
    private readonly queues: BullMqQueueFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    registerLedgerSubscribers(this.bus, this.posting, this.merchantCash);
    if (!this.queues.configured) return;
    try {
      const queue = this.queues.queue<{ day: string }>(NIGHTLY_QUEUE);
      this.nightly.attach(queue);
      const at = await this.nightly.schedule(queue);
      this.logger.log(`nightly close scheduled for ${at.toISOString()}`);
    } catch (err) {
      this.logger.warn(`nightly close not scheduled: ${(err as Error).message}`);
    }
  }
}
