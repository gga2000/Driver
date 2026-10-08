import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { EventOtpAlerts, EventsServiceAdapter, IDENTITY_EVENTS, type IdentityEventEmitter } from './events.adapter.js';
import { AuthCache, InProcessDropBus, RedisDropBus, authCacheTtlMsFromEnv, cachedIdentityRepository } from './auth-cache.js';
import { IDENTITY_REPOSITORY, PrismaIdentityRepository, type IdentityRepository } from './identity.repository.js';
import { IdentityService, OTP_REQUEST_GUARD, OTP_WHATSAPP, PHONE_PEPPER } from './identity.service.js';
import { whatsAppPortFromEnv } from '../../shared/messaging/whatsapp.js';
import { InMemoryIdentityRepository } from './memory.repository.js';
import { OtpGuard, otpGuardConfigFromEnv } from './rate-limit.js';
import { WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { ROLE_READER } from './role-reader.js';
import { SessionService, phonePepperFromEnv, sessionConfigFromEnv } from './session.service.js';
import { smsPortFromEnv } from '../../shared/messaging/sms.js';
import { SMS_PROVIDER } from './sms/provider.js';

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; SMS port
 * from SMS_PROVIDER (`shared/messaging/sms.ts`); JWT keys from JWT_SECRET/JWT_KID; phone pepper from PHONE_HASH_PEPPER
 * (falls back to JWT_SECRET so a dev box needs one secret). With NODE_ENV=production both secrets
 * are mandatory (≥ 32 chars, no placeholders) and a missing one stops the boot.
 */
@Module({
  imports: [EventsModule],
  providers: [
    // Sessions and roles kept in memory for up to 30 s (AUTH_CACHE_TTL_SEC, 0 = off); any change
    // to them drops the entry on every API machine over Redis pub/sub when REDIS_URL is set.
    {
      provide: AuthCache,
      useFactory: (clock: Clock) => {
        const url = process.env['REDIS_URL'];
        const ttlMs = authCacheTtlMsFromEnv();
        const bus = url && ttlMs > 0 ? new RedisDropBus(new Redis(url, { maxRetriesPerRequest: 3 }), new Redis(url, { maxRetriesPerRequest: null })) : new InProcessDropBus();
        return new AuthCache(clock, ttlMs, bus);
      },
      inject: [CLOCK],
    },
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: (prisma: PrismaService, cache: AuthCache): IdentityRepository =>
        cachedIdentityRepository(prisma.configured ? new PrismaIdentityRepository(prisma) : new InMemoryIdentityRepository(), cache),
      inject: [PrismaService, AuthCache],
    },
    { provide: IDENTITY_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    // OTP codes go through the shared SmsPort: SMS_PROVIDER=dev (default, codes in the terminal and
    // identity.devLastOtp) | http (generic gateway, SMS_HTTP_*) | twilio (SMS_TWILIO_*).
    { provide: SMS_PROVIDER, useFactory: () => smsPortFromEnv() },
    // "ما وصلك؟ دزلي على واتساب": login codes over WhatsApp (template `otp_login`), same provider choice
    // as notify (WHATSAPP_PROVIDER=dev → the API terminal + identity.devLastOtp; meta → Cloud API).
    { provide: OTP_WHATSAPP, useFactory: () => whatsAppPortFromEnv() },
    { provide: PHONE_PEPPER, useFactory: () => phonePepperFromEnv() },
    {
      provide: SessionService,
      useFactory: (repo: IdentityRepository, clock: Clock) => new SessionService(repo, clock, sessionConfigFromEnv()),
      inject: [IDENTITY_REPOSITORY, CLOCK],
    },
    // The one OTP guard (audit SEC-04/05): limits per number, device and signed-in sender, the IP
    // rule alert-only, the daily SMS budget; counted in the shared window counter (Redis across pods
    // when REDIS_URL is set). Settings: OTP_RATE_LIMIT_*, OTP_SMS_DAILY_BUDGET, OTP_GUARD_MODE_*.
    {
      provide: OTP_REQUEST_GUARD,
      useFactory: (counter: WindowCounter, events: IdentityEventEmitter, clock: Clock) => new OtpGuard(counter, new EventOtpAlerts(events, clock), otpGuardConfigFromEnv()),
      inject: [WINDOW_COUNTER, IDENTITY_EVENTS, CLOCK],
    },
    IdentityService,
    { provide: ROLE_READER, useExisting: IdentityService },
  ],
  exports: [IdentityService, ROLE_READER],
})
export class IdentityModule implements OnModuleDestroy {
  constructor(@Inject(AuthCache) private readonly cache: AuthCache) {}

  async onModuleDestroy(): Promise<void> {
    await this.cache.close();
  }
}
