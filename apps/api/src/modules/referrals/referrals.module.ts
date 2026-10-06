import { randomInt } from 'node:crypto';
import { Module } from '@nestjs/common';
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { LedgerModule, LedgerService } from '../ledger/index.js';
import { InMemoryReferralsRepository, PrismaReferralsRepository, REFERRALS_REPOSITORY, type ReferralsRepository } from './referrals.repository.js';
import { REFERRAL_LEDGER, REFERRAL_NAMES, REFERRAL_RANDOM, REFERRAL_RULES, ReferralsService, type RandomInt, type ReferralLedgerPort, type ReferralNamesPort } from './referrals.service.js';

/**
 * Invite as a gift (joy g2). Owns `invite_codes` and `referrals` (Prisma with DATABASE_URL, in memory
 * otherwise). First names through identity (logged vault reads), the inviter's paid lines and the rule
 * from the ledger. The orders module binds its placed-order count and reads `referrerOf` for the
 * closed-order fact (it imports this module, never the other way round).
 */
@Module({
  imports: [IdentityModule, LedgerModule],
  providers: [
    {
      provide: REFERRALS_REPOSITORY,
      useFactory: (prisma: PrismaService): ReferralsRepository => (prisma.configured ? new PrismaReferralsRepository(prisma) : new InMemoryReferralsRepository()),
      inject: [PrismaService],
    },
    { provide: REFERRAL_NAMES, useFactory: (identity: IdentityService): ReferralNamesPort => ({ firstNamesFor: (ids, accessor, purpose) => identity.firstNamesFor(ids, accessor, purpose) }), inject: [IdentityService] },
    { provide: REFERRAL_LEDGER, useFactory: (ledger: LedgerService): ReferralLedgerPort => ({ eventsFor: (account) => ledger.eventsFor(account) }), inject: [LedgerService] },
    // The ledger's own rules (one city until config serves them per city, like the ledger module).
    { provide: REFERRAL_RULES, useValue: AZIZIYAH_MONEY_RULES },
    { provide: REFERRAL_RANDOM, useValue: ((n: number) => randomInt(n)) satisfies RandomInt },
    ReferralsService,
  ],
  exports: [ReferralsService],
})
export class ReferralsModule {}
