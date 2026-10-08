import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { NotifyModule } from '../notify/index.js';
import {
  InMemoryOnCallRepository,
  ON_CALL_REPOSITORY,
  PrismaOnCallRepository,
  type OnCallRepository,
} from './on-call.repository.js';
import {
  ON_CALL_CONFIG,
  ON_CALL_PORT,
  OnCallService,
  type OnCallConfig,
} from './on-call.service.js';

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * On call (Console E1, CON-02 and G0-9). Owns `on_call_shifts` and `alert_ladders` (Prisma with
 * DATABASE_URL, in memory otherwise). Hears the SOS events through the outbox; names through identity
 * (logged vault reads); pages through notify; audits roster changes through controls. Exports
 * `ON_CALL_PORT` for the safety module's first page. Does not import safety (safety imports this).
 *
 * Env: CONSOLE_BASE_URL (the link in the WhatsApp), ON_CALL_TICK_MS (default 5000; 0 turns the
 * ladder sweep off).
 */
@Module({
  imports: [ControlsModule, EventsModule, IdentityModule, NotifyModule],
  providers: [
    {
      provide: ON_CALL_REPOSITORY,
      useFactory: (prisma: PrismaService): OnCallRepository =>
        prisma.configured ? new PrismaOnCallRepository(prisma) : new InMemoryOnCallRepository(),
      inject: [PrismaService],
    },
    {
      provide: ON_CALL_CONFIG,
      useFactory: (): OnCallConfig => ({
        consoleBase: process.env['CONSOLE_BASE_URL'] ?? 'https://console.driver.iq',
        tickMs: envInt('ON_CALL_TICK_MS', 5_000),
      }),
    },
    OnCallService,
    { provide: ON_CALL_PORT, useExisting: OnCallService },
  ],
  exports: [OnCallService, ON_CALL_PORT],
})
export class OnCallModule {}
