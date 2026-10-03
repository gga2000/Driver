import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { EventsServiceAdapter, IDENTITY_EVENTS } from './events.adapter.js';
import { IDENTITY_REPOSITORY, PrismaIdentityRepository, type IdentityRepository } from './identity.repository.js';
import { IdentityService, PHONE_PEPPER } from './identity.service.js';
import { InMemoryIdentityRepository } from './memory.repository.js';
import { ROLE_READER } from './role-reader.js';
import { SessionService, phonePepperFromEnv, sessionConfigFromEnv } from './session.service.js';
import { FakeSmsProvider } from './sms/fake.provider.js';
import { GatewaySmsProvider, smsProviderFromEnv } from './sms/gateway.provider.js';
import { SMS_PROVIDER } from './sms/provider.js';

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; SMS provider
 * from SMS_PROVIDER; JWT keys from JWT_SECRET/JWT_KID; phone pepper from PHONE_HASH_PEPPER
 * (falls back to JWT_SECRET so a dev box needs one secret). With NODE_ENV=production both secrets
 * are mandatory (≥ 32 chars, no placeholders) and a missing one stops the boot.
 */
@Module({
  imports: [EventsModule],
  providers: [
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: (prisma: PrismaService): IdentityRepository => (prisma.configured ? new PrismaIdentityRepository(prisma) : new InMemoryIdentityRepository()),
      inject: [PrismaService],
    },
    { provide: IDENTITY_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    {
      provide: SMS_PROVIDER,
      useFactory: () =>
        smsProviderFromEnv() === 'gateway' ? new GatewaySmsProvider({ url: process.env['SMS_GATEWAY_URL'], apiKey: process.env['SMS_GATEWAY_KEY'] }) : new FakeSmsProvider(),
    },
    { provide: PHONE_PEPPER, useFactory: () => phonePepperFromEnv() },
    {
      provide: SessionService,
      useFactory: (repo: IdentityRepository, clock: Clock) => new SessionService(repo, clock, sessionConfigFromEnv()),
      inject: [IDENTITY_REPOSITORY, CLOCK],
    },
    IdentityService,
    { provide: ROLE_READER, useExisting: IdentityService },
  ],
  exports: [IdentityService, ROLE_READER],
})
export class IdentityModule {}
