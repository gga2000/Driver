import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { LiveEvent, type LiveBusEvent } from '@driver/contracts';

export type LiveListener = (event: LiveBusEvent) => void;

/**
 * Pub/sub for live events between the outbox subscribers that publish them and the open SSE
 * streams that forward them. Fire-and-forget: a lost message costs freshness only (clients resync
 * on reconnect and keep a slow safety refetch), so nothing here is durable or retried.
 */
export interface LiveBus {
  publish(channel: string, event: LiveBusEvent): Promise<void>;
  /**
   * Listens to one channel on this instance. `ready` resolves once the channel is really being
   * received (Redis SUBSCRIBE acknowledged), so a stream says `hello` only when nothing can slip by.
   */
  subscribe(channel: string, listener: LiveListener): LiveSubscription;
  /** Channels with at least one local listener (diagnostics, tests). */
  channels(): string[];
  /**
   * True when publishing cannot reach anyone: an in-process bus with no open stream (the simulator,
   * tests). Publishers skip their lookups then. A shared bus is never idle (other instances listen).
   */
  idle(): boolean;
  close(): Promise<void>;
}

export interface LiveSubscription {
  ready: Promise<void>;
  unsubscribe(): void;
}

export const LIVE_BUS = Symbol('LIVE_BUS');

/** Local listeners per channel, shared by both buses. */
class Listeners {
  private readonly byChannel = new Map<string, Set<LiveListener>>();
  private readonly logger = new Logger('LiveBus');

  /** Adds; true when this is the channel's first local listener. */
  add(channel: string, listener: LiveListener): boolean {
    let set = this.byChannel.get(channel);
    const first = !set;
    if (!set) this.byChannel.set(channel, (set = new Set()));
    set.add(listener);
    return first;
  }

  /** Removes; true when the channel has no local listener left. */
  remove(channel: string, listener: LiveListener): boolean {
    const set = this.byChannel.get(channel);
    if (!set) return false;
    set.delete(listener);
    if (set.size > 0) return false;
    this.byChannel.delete(channel);
    return true;
  }

  deliver(channel: string, event: LiveBusEvent): void {
    for (const l of [...(this.byChannel.get(channel) ?? [])]) {
      try {
        l(event);
      } catch (err) {
        this.logger.warn(`listener on ${channel} threw: ${(err as Error).message}`);
      }
    }
  }

  channels(): string[] {
    return [...this.byChannel.keys()];
  }
}

/** One API process (tests, the simulator, a dev box without REDIS_URL): delivery is synchronous. */
export class InMemoryLiveBus implements LiveBus {
  private readonly listeners = new Listeners();
  readonly published: Array<{ channel: string; event: LiveBusEvent }> = [];
  /** Keep a log of what was published (tests); off in production wiring. */
  constructor(private readonly record = false) {}

  async publish(channel: string, event: LiveBusEvent): Promise<void> {
    if (this.record) this.published.push({ channel, event });
    this.listeners.deliver(channel, event);
  }

  subscribe(channel: string, listener: LiveListener): LiveSubscription {
    this.listeners.add(channel, listener);
    return {
      ready: Promise.resolve(),
      unsubscribe: () => void this.listeners.remove(channel, listener),
    };
  }

  channels(): string[] {
    return this.listeners.channels();
  }

  idle(): boolean {
    return !this.record && this.listeners.channels().length === 0;
  }

  async close(): Promise<void> {}
}

/**
 * Redis pub/sub across API instances: `PUBLISH driver:live:<channel>` on one connection; a second
 * connection (subscriber mode) `SUBSCRIBE`s a channel when its first local stream opens and
 * `UNSUBSCRIBE`s when the last one closes. Payloads are the superjson-free JSON of the event; the
 * receiver re-parses them with the `LiveEvent` schema (dates revive).
 */
export class RedisLiveBus implements LiveBus {
  static readonly PREFIX = 'driver:live:';
  private readonly listeners = new Listeners();
  private readonly logger = new Logger('RedisLiveBus');
  /** The SUBSCRIBE acknowledgement per locally listened channel. */
  private readonly acks = new Map<string, Promise<void>>();

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {
    sub.on('message', (raw: string, message: string) => {
      if (!raw.startsWith(RedisLiveBus.PREFIX)) return;
      let event: LiveBusEvent;
      try {
        event = LiveEvent.parse(JSON.parse(message)) as LiveBusEvent;
      } catch (err) {
        this.logger.warn(`dropped a malformed live event on ${raw}: ${(err as Error).message}`);
        return;
      }
      this.listeners.deliver(raw.slice(RedisLiveBus.PREFIX.length), event);
    });
  }

  async publish(channel: string, event: LiveBusEvent): Promise<void> {
    await this.pub.publish(RedisLiveBus.PREFIX + channel, JSON.stringify(event));
  }

  subscribe(channel: string, listener: LiveListener): LiveSubscription {
    if (this.listeners.add(channel, listener)) {
      const ack = this.sub.subscribe(RedisLiveBus.PREFIX + channel).then(
        () => undefined,
        (err: unknown) => {
          this.logger.warn(`subscribe ${channel}: ${(err as Error).message}`);
          throw err;
        },
      );
      this.acks.set(channel, ack);
    }
    let done = false;
    return {
      ready: this.acks.get(channel) ?? Promise.resolve(),
      unsubscribe: () => {
        if (done) return;
        done = true;
        if (this.listeners.remove(channel, listener)) {
          this.acks.delete(channel);
          this.sub
            .unsubscribe(RedisLiveBus.PREFIX + channel)
            .catch((err: unknown) =>
              this.logger.warn(`unsubscribe ${channel}: ${(err as Error).message}`),
            );
        }
      },
    };
  }

  channels(): string[] {
    return this.listeners.channels();
  }

  idle(): boolean {
    return false;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.sub.quit(), this.pub.quit()]);
  }
}
