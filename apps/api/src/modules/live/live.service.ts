import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  DriverError,
  LIVE_RULES,
  type Actor,
  type LiveBusEvent,
  type LiveEvent,
  type LivePort,
  type LiveStreamRequest,
  type LiveToken,
  type LiveWatchRequest,
  type SessionClaims,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { LIVE_BUS, type LiveBus } from './live.bus.js';
import type { StreamTokens } from './live.tokens.js';

export const LIVE_TOKENS = Symbol('LIVE_TOKENS');
/** The session check open streams re-run (identity's `assertSessionLive`). */
export const LIVE_SESSIONS = Symbol('LIVE_SESSIONS');
export interface LiveSessionsPort {
  assertSessionLive(claims: Pick<SessionClaims, 'sub' | 'sid' | 'did'>): Promise<void>;
}

/** Events queued for one slow client before its stream is ended (it reconnects and resyncs). */
export const LIVE_QUEUE_MAX = 256;

/**
 * `ctx.live`: stream tokens and the per-connection event streams of `live.*`. A stream:
 *
 *  1. runs the scope check of the matching query (refused → FORBIDDEN, nothing streamed);
 *  2. listens to its channels on the bus and, once they are really subscribed, says `hello`;
 *  3. forwards bus events (filtered) until the client goes away;
 *  4. re-runs the scope check and the session check every `recheckMs`, and ends with
 *     `session_expired` (401) when the token it was opened with expires.
 */
@Injectable()
export class LiveService implements LivePort, OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  private open = 0;
  /** Ends every open stream (shutdown: the HTTP server can close; clients reconnect elsewhere). */
  private readonly enders = new Set<() => void>();

  constructor(
    @Inject(LIVE_BUS) private readonly bus: LiveBus,
    @Inject(LIVE_TOKENS) private readonly tokens: StreamTokens,
    @Inject(LIVE_SESSIONS) private readonly sessions: LiveSessionsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleDestroy(): void {
    for (const end of [...this.enders]) end();
  }

  /** Streams open on this instance (diagnostics). */
  openStreams(): number {
    return this.open;
  }

  token(_actor: Actor, claims: SessionClaims): Promise<LiveToken> {
    return this.tokens.issue(claims);
  }

  async authenticate(streamToken: string): Promise<SessionClaims> {
    const claims = await this.tokens.verify(streamToken);
    await this.sessions.assertSessionLive(claims);
    return claims;
  }

  async *stream(req: LiveStreamRequest): AsyncGenerator<LiveEvent, void, unknown> {
    if (req.signal?.aborted) return;
    await req.check();

    const queue: LiveBusEvent[] = [];
    let overflow = false;
    let wake: (() => void) | null = null;
    const poke = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const listener = (event: LiveBusEvent) => {
      if (req.filter && !req.filter(event)) return;
      if (queue.length >= LIVE_QUEUE_MAX) overflow = true;
      else queue.push(event);
      poke();
    };
    const subs = req.channels.map((c) => this.bus.subscribe(c, listener));
    const onAbort = () => poke();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let ended = false;
    const end = () => {
      ended = true;
      poke();
    };
    this.enders.add(end);
    this.open += 1;
    try {
      await Promise.all(subs.map((s) => s.ready));
      yield { type: 'hello', channels: [...req.channels], serverNow: this.clock.now() };
      const expiresAtMs = req.claims.exp * 1000;
      let nextCheckMs = Date.now() + LIVE_RULES.recheckMs;
      for (;;) {
        if (req.signal?.aborted || ended) return;
        if (overflow) {
          this.logger.warn(
            `live stream on ${req.channels.join(',')} fell ${LIVE_QUEUE_MAX} events behind; ending it (the client resyncs)`,
          );
          return;
        }
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        const untilExpiry = expiresAtMs - this.clock.now().getTime();
        if (untilExpiry <= 0) throw new DriverError('session_expired');
        const untilCheck = nextCheckMs - Date.now();
        if (untilCheck <= 0) {
          await req.check();
          await this.sessions.assertSessionLive(req.claims);
          nextCheckMs = Date.now() + LIVE_RULES.recheckMs;
          continue;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(1, Math.min(untilCheck, untilExpiry)));
          timer.unref?.();
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
    } finally {
      this.open -= 1;
      this.enders.delete(end);
      req.signal?.removeEventListener('abort', onAbort);
      for (const s of subs) s.unsubscribe();
    }
  }

  /**
   * Wake-ups for a public stream that builds its own payload (`live.share`): once listening, then
   * after events on `channels` (a burst inside `minGapMs` is one wake-up) or after `everyMs` of quiet.
   * No event content leaves here, so there is nothing to scope per event; the caller re-checks its
   * credential on every read.
   */
  async *watch(req: LiveWatchRequest): AsyncGenerator<void, void, unknown> {
    if (req.signal?.aborted) return;
    let moved = false;
    let wake: (() => void) | null = null;
    const poke = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const subs = req.channels.map((c) =>
      this.bus.subscribe(c, () => {
        moved = true;
        poke();
      }),
    );
    const onAbort = () => poke();
    req.signal?.addEventListener('abort', onAbort, { once: true });
    let ended = false;
    const end = () => {
      ended = true;
      poke();
    };
    this.enders.add(end);
    this.open += 1;
    try {
      await Promise.all(subs.map((s) => s.ready));
      yield;
      let last = Date.now();
      for (;;) {
        if (req.signal?.aborted || ended) return;
        const now = Date.now();
        const due = moved ? last + req.minGapMs : last + req.everyMs;
        if (due <= now) {
          moved = false;
          last = now;
          yield;
          continue;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, due - now);
          timer.unref?.();
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
    } finally {
      this.open -= 1;
      this.enders.delete(end);
      req.signal?.removeEventListener('abort', onAbort);
      for (const s of subs) s.unsubscribe();
    }
  }
}
