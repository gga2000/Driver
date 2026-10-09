import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONSOLE_WATCH_RULES,
  type Actor,
  type ConsolePresentInput,
  type ConsoleWatch,
  type ConsoleWatchKind,
} from '@driver/contracts';
import { CITY_UTC_OFFSET_MIN } from '@driver/i18n';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { IdentityService } from '../identity/index.js';
import { NotifyService } from '../notify/index.js';
import {
  CONSOLE_WATCH_REPOSITORY,
  type ConsoleWatchRepository,
  type PresenceRecord,
} from './console-watch.repository.js';
import { ON_CALL_REPOSITORY, type OnCallRepository } from './on-call.repository.js';

export interface ConsoleWatchConfig {
  /** The cities whose Console is watched. */
  cities: readonly string[];
  /** The Console origin, for the link in the message. */
  consoleBase: string;
}
export const CONSOLE_WATCH_CONFIG = Symbol('CONSOLE_WATCH_CONFIG');

const HOUR = 3_600_000;
const TEMPLATE: Record<ConsoleWatchKind, 'console_unwatched_alert' | 'console_live_down_alert'> = {
  unwatched: 'console_unwatched_alert',
  live_down: 'console_live_down_alert',
};
/** How long the live updates must have been stopped on a tab ("connecting" for that long counts). */
const down = (t: PresenceRecord) => t.live === 'fallback' || t.live === 'connecting';

/**
 * The Console watching itself (E1 step 3, Ali 2026-10-08). Every open staff screen says "I'm here"
 * every 30 s with the state of its live updates (`present`). The on-call sweep calls `sweep()`:
 *
 * - `unwatched`: during working hours (06:00 to 02:00 city time, or any hour while someone is on call
 *   on the SOS desk) no screen has said so for 5 minutes. Counted from the start of the hours, so the
 *   morning's first page comes at 06:05 when nobody opened the Console.
 * - `live_down`: every screen that uses live updates has had them stopped for a minute.
 *
 * Either opens once (a unique open key, so two job machines never page twice), tells the people on
 * call on the SOS desk (rank 1 and 2; the admins when nobody is on call) by push and WhatsApp, and
 * closes by itself when the problem ends. A new gap opens a new alert and pages again.
 */
@Injectable()
export class ConsoleWatchService {
  private readonly logger = new Logger(ConsoleWatchService.name);
  private lastDrop = 0;

  constructor(
    @Inject(CONSOLE_WATCH_REPOSITORY) private readonly repo: ConsoleWatchRepository,
    @Inject(ON_CALL_REPOSITORY) private readonly roster: OnCallRepository,
    @Inject(CONSOLE_WATCH_CONFIG) private readonly config: ConsoleWatchConfig,
    private readonly identity: IdentityService,
    private readonly notify: NotifyService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async present(actor: Actor, input: ConsolePresentInput): Promise<ConsoleWatch> {
    await this.repo.touch(
      { cityId: input.cityId, tabId: input.tabId, personId: actor.personId, live: input.live },
      this.clock.now(),
    );
    return { cityId: input.cityId, open: await this.repo.openFor(input.cityId) };
  }

  /** One pass for every watched city; returns the alerts it opened. */
  async sweep(): Promise<ConsoleWatchKind[]> {
    const now = this.clock.now();
    const opened: ConsoleWatchKind[] = [];
    for (const cityId of this.config.cities) {
      const open = new Set((await this.repo.openFor(cityId)).map((a) => a.kind));
      const tabs = await this.repo.presentSince(
        cityId,
        new Date(now.getTime() - CONSOLE_WATCH_RULES.presentForSec * 1000),
      );

      // Nobody watching.
      const from = await this.watchFrom(cityId, now);
      const last = await this.repo.lastSeen(cityId);
      const gapSince = from && (!last || last.getTime() < from.getTime()) ? from : last;
      const unwatchedFor =
        from && tabs.length === 0 && gapSince ? now.getTime() - gapSince.getTime() : 0;
      if (await this.settle(cityId, 'unwatched', open, unwatchedFor >= CONSOLE_WATCH_RULES.unwatchedAfterSec * 1000, unwatchedFor, now))
        opened.push('unwatched');

      // Live updates down on every screen that uses them.
      const streaming = tabs.filter((t) => t.live !== 'stopped');
      const downFor =
        streaming.length > 0 && streaming.every(down)
          ? now.getTime() - Math.max(...streaming.map((t) => t.liveSince.getTime()))
          : 0;
      if (await this.settle(cityId, 'live_down', open, downFor >= CONSOLE_WATCH_RULES.liveDownAfterSec * 1000, downFor, now))
        opened.push('live_down');
    }
    if (now.getTime() - this.lastDrop >= HOUR) {
      this.lastDrop = now.getTime();
      await this.repo.dropBefore(
        new Date(now.getTime() - CONSOLE_WATCH_RULES.keepPresenceHours * HOUR),
      );
    }
    return opened;
  }

  /**
   * When the current watch began, or null when nobody has to be watching now: the start of today's
   * hours (06:00 city time; yesterday's 06:00 between midnight and 02:00), else the start of the
   * earliest SOS on-call shift running now.
   */
  private async watchFrom(cityId: string, now: Date): Promise<Date | null> {
    const shift = CITY_UTC_OFFSET_MIN * 60_000;
    const local = now.getTime() + shift;
    const hour = Math.floor(local / HOUR) % 24;
    const { watchFromHour, watchToHour } = CONSOLE_WATCH_RULES;
    if (hour >= watchFromHour || hour < watchToHour) {
      const dayStart = Math.floor(local / (24 * HOUR)) * 24 * HOUR;
      const start = dayStart + watchFromHour * HOUR - (hour < watchToHour ? 24 * HOUR : 0);
      return new Date(start - shift);
    }
    const onCall = await this.roster.onCallAt(cityId, 'sos', now);
    if (onCall.length === 0) return null;
    return new Date(Math.min(...onCall.map((s) => s.startsAt.getTime())));
  }

  /** Opens and pages, or closes, one kind; true when this call opened it. */
  private async settle(
    cityId: string,
    kind: ConsoleWatchKind,
    open: ReadonlySet<ConsoleWatchKind>,
    wrong: boolean,
    forMs: number,
    now: Date,
  ): Promise<boolean> {
    if (!wrong) {
      if (open.has(kind) && (await this.repo.close(cityId, kind, now)))
        this.logger.log(`${cityId}: ${kind} cleared`);
      return false;
    }
    if (open.has(kind)) return false;
    const to = await this.whoToTell(cityId, now);
    const minutes = `${Math.max(1, Math.floor(forMs / 60_000))} دقيقة`;
    const link = this.config.consoleBase.replace(/\/$/, '');
    return this.uow.run(async (tx) => {
      const alert = await this.repo.open(cityId, kind, now, tx);
      if (!alert) return false;
      for (const personId of to)
        await this.notify.dispatch(
          {
            eventId: `${alert.id}:page`,
            template: TEMPLATE[kind],
            to: personId,
            params: { minutes, link },
            data: { watchAlertId: alert.id },
          },
          tx,
        );
      await this.repo.setPaged(alert.id, to.length, tx);
      this.logger.warn(`${cityId}: ${kind} for ${minutes}, told ${to.length}`);
      return true;
    });
  }

  private async whoToTell(cityId: string, now: Date): Promise<string[]> {
    const onCall = (await this.roster.onCallAt(cityId, 'sos', now)).map((s) => s.personId);
    if (onCall.length > 0) return [...new Set(onCall)];
    const admins = await this.identity.roster({ kinds: ['admin'], limit: 50 });
    return admins.rows.filter((r) => !r.frozen).map((r) => r.personId);
  }
}
