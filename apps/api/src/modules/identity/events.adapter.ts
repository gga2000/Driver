import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';
import type { Clock } from '../../shared/clock.js';
import type { OtpAlert, OtpAlertSink } from './rate-limit.js';

/** The event an OTP guard alert writes: one row ops alerting reads (rule, counts, carrier; never a number or IP). */
export const OTP_ALERT_EVENT = 'security.otp_alert';

/**
 * Identity's only path to the event log: a direct call to the transactional
 * `EventsService.emit(tx, event, aggregate)`, so the event and its outbox row commit with the
 * identity rows written in the same `tx`. The interface exists so unit tests can record instead.
 */
export interface IdentityEventEmitter {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
}

export class EventsServiceAdapter implements IdentityEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(tx, event, aggregate);
  }
}

/** Test double: keeps every emitted event in order. */
export class RecordingEventEmitter implements IdentityEventEmitter {
  readonly events: Array<Omit<Event, 'id' | 'recordedAt' | 'aggregate'> & { aggregate: { name: string; id: string } }> = [];
  private seq = 0;

  async emit(_tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    this.events.push({ ...event, aggregate });
    this.seq += 1;
    return { ...event, id: `ev_${this.seq}`, recordedAt: event.occurredAt };
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }

  last(type: string) {
    return [...this.events].reverse().find((e) => e.type === type);
  }
}

export const IDENTITY_EVENTS = Symbol('IDENTITY_EVENTS');

/** OTP guard alerts as `security.otp_alert` events, committed on their own (no caller transaction). */
export class EventOtpAlerts implements OtpAlertSink {
  constructor(
    private readonly events: IdentityEventEmitter,
    private readonly clock: Clock,
  ) {}

  async raise(alert: OtpAlert): Promise<void> {
    await this.events.emit(undefined, { actorId: 'system', type: OTP_ALERT_EVENT, occurredAt: this.clock.now(), payload: { ...alert } }, { name: 'security', id: 'otp' });
  }
}
