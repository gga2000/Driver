import { SystemClock, type Clock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import type { Queue } from '../../shared/queue.js';
import { ContradictionDetector, CONTRADICTION_SUBSCRIBER } from './contradiction.detector.js';
import { EventsService, type TripOrderDetachments } from './events.service.js';
import { InMemoryEventsRepository } from './memory.repository.js';
import { OutboxPublisher, type OutboxPublisherOptions, type OutboxTick } from './outbox.publisher.js';
import { SubscriberRegistry } from './subscriber.registry.js';

export interface InMemoryEventsOptions {
  clock?: Clock;
  uow?: UnitOfWork;
  /** Queue mode (a BullMQ stand-in such as `InMemoryQueue`); sync drain-after-commit when omitted. */
  queue?: Queue<OutboxTick> | null;
  tripOrders?: TripOrderDetachments | null;
  /** Register the contradiction detector (default true, as the module does). */
  contradictions?: boolean;
  publisher?: OutboxPublisherOptions;
}

/**
 * The events module on in-memory everything, wired as `EventsModule` wires it: for unit tests,
 * the simulator and other modules' harnesses. No timers are started.
 */
export function createInMemoryEvents(opts: InMemoryEventsOptions = {}) {
  const clock = opts.clock ?? new SystemClock();
  const uow = opts.uow ?? new UnitOfWork(new NoDatabaseRunner());
  const repo = new InMemoryEventsRepository();
  const registry = new SubscriberRegistry();
  const publisher = new OutboxPublisher(repo, registry, uow, clock, opts.queue ?? null, opts.publisher);
  const events = new EventsService(repo, registry, publisher, clock, uow);
  events.useTripOrderLookup(opts.tripOrders ?? null);
  const detector = new ContradictionDetector(repo, events, clock);
  if (opts.contradictions !== false) registry.subscribe(CONTRADICTION_SUBSCRIBER, '*', (e, ctx) => detector.check(e, ctx.tx).then(() => undefined));
  if (opts.queue) publisher.start({ interval: false });
  return { events, repo, registry, publisher, uow, clock, detector };
}
